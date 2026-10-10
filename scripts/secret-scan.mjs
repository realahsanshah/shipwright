#!/usr/bin/env node
// Scans the branch's changes (net diff since the merge-base, uncommitted, and
// untracked) and the added lines of every commit on the branch (so a secret
// committed and later removed is still caught) for credentials. Prints
// file:line and rule only, never the value. File identity comes from
// `--name-status`, never from diff headers.
// Usage: node secret-scan.mjs [--base <ref>]   (run from the repo root)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isSecretPath } from '../hooks/pre-tool-guard.mjs';

export const RULES = [
  { id: 'private-key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'stripe-live-key', re: /\b[sr]k_live_[0-9A-Za-z]{24,}\b/ },
  { id: 'anthropic-api-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  // The name may carry a prefix (DB_PASSWORD, AWS_SECRET_ACCESS_KEY). Value: quoted (8+) or unquoted (16+).
  { id: 'generic-assignment', re: /(?<![A-Za-z0-9])(?:[A-Za-z0-9]*[_-])?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*(?:["']([^"'\s]{8,})["']|([^\s"'#,]{16,}))/i },
];
// A generic-assignment value is a placeholder only when the WHOLE value matches.
const PLACEHOLDER = /^(?:x+|\*+|changeme|change_me|example|placeholder|dummy|redacted|your[_-][a-z_-]*|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\})$/i;
// An unquoted value that looks like code (a call, an index, a dotted name, a $VAR) is not a secret.
const CODE_LIKE = /[()[\]{};]|^\$[A-Za-z_]\w*$|^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const ALLOW = 'shipwright:allow-secret';
const MAX_UNTRACKED_BYTES = 1024 * 1024;

export function scanLines(file, lines) {
  const findings = [];
  for (const { line, text } of lines) {
    if (text.includes(ALLOW)) continue;
    for (const rule of RULES) {
      const re = new RegExp(rule.re.source, rule.re.flags + 'g');
      let hit = false;
      for (const m of text.matchAll(re)) {
        if (rule.id === 'generic-assignment') {
          const value = m[1] ?? m[2];
          if (PLACEHOLDER.test(value)) continue;
          if (m[1] === undefined && CODE_LIKE.test(value)) continue;
        }
        hit = true;
        break;
      }
      if (hit) findings.push({ file, line, rule: rule.id });
    }
  }
  return findings;
}

// Scans one file's unified diff. The file name is supplied by the caller; every
// line outside a hunk body (headers, "Binary files differ") is ignored, and hunk
// bodies are consumed by their declared counts so "+++ ..." content is content.
export function scanFileDiff(file, diffText) {
  return scanLines(file, addedLines(diffText));
}

function addedLines(diffText) {
  const added = [];
  const lines = diffText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const hunk = lines[i].match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    let oldRem = hunk[1] === undefined ? 1 : Number(hunk[1]);
    let newRem = hunk[3] === undefined ? 1 : Number(hunk[3]);
    let lineNo = Number(hunk[2]);
    while ((oldRem > 0 || newRem > 0) && i + 1 < lines.length) {
      const raw = lines[i + 1];
      if (raw.startsWith('\\')) { i += 1; continue; }
      if (raw.startsWith('+') && newRem > 0) { added.push({ line: lineNo, text: raw.slice(1) }); lineNo += 1; newRem -= 1; }
      else if (raw.startsWith('-') && oldRem > 0) oldRem -= 1;
      else if (raw.startsWith(' ') && oldRem > 0 && newRem > 0) { lineNo += 1; oldRem -= 1; newRem -= 1; }
      else break;
      i += 1;
    }
  }
  return added;
}

// Lines of the working-tree file that carry the allow marker (empty when the file is gone).
function allowedLines(cwd, file) {
  try {
    const full = path.join(cwd, file);
    if (fs.statSync(full).size > MAX_UNTRACKED_BYTES) return [];
    return fs.readFileSync(full, 'utf8').split(/\r?\n/).filter((t) => t.includes(ALLOW));
  } catch {
    return [];
  }
}

function git(args, cwd) {
  const r = spawnSync('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error((r.stderr || r.error?.message || 'git failed').trim());
  return r.stdout;
}

function defaultBase(cwd) {
  for (const ref of ['origin/HEAD', 'main', 'master']) {
    try { git(['rev-parse', '--verify', '--quiet', ref], cwd); return ref; } catch { /* try next */ }
  }
  throw new Error('no --base given and none of origin/HEAD, main, master exists');
}

// Every non-merge commit in <mergeBase>..HEAD: scan its added lines and flag the
// secret files it adds. Findings carry the commit's short SHA. A hit whose line
// is still in the working tree with the allow marker added later counts as
// acknowledged (the marker cannot be added to history).
export function scanHistory(mergeBase, cwd) {
  const findings = [];
  const seen = new Set();
  const add = (f) => {
    const key = [f.file, f.line, f.rule, f.commit].join('\0');
    if (!seen.has(key)) { seen.add(key); findings.push(f); }
  };
  const commits = git(['log', '--no-merges', '--format=%H %h', `${mergeBase}..HEAD`], cwd).split('\n').filter(Boolean);
  for (const entry of commits) {
    const [sha, short] = entry.trim().split(' ');
    const ns = git(['show', '--name-status', '-z', '--no-renames', '--format=', sha], cwd).replace(/^\n+/, '').split('\0');
    for (let i = 0; i + 1 < ns.length; i += 2) {
      const status = ns[i].trim()[0];
      const file = ns[i + 1];
      if (status === 'D') continue;
      if (status === 'A' && isSecretPath(file, '.')) add({ file, line: 0, rule: 'secret-file', commit: short });
      const lines = addedLines(git(['show', '-U0', '--no-color', '--no-ext-diff', '--format=', sha, '--', file], cwd));
      const hits = scanLines(file, lines);
      if (hits.length === 0) continue;
      const allowed = allowedLines(cwd, file);
      for (const f of hits) {
        const text = lines.find((l) => l.line === f.line).text.trim();
        if (allowed.some((t) => t.includes(text))) continue;
        add({ ...f, commit: short });
      }
    }
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base');
  const cwd = process.cwd();
  let findings;
  let fileCount;
  let largeSkipped = 0;
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd);
    const base = baseIdx >= 0 ? args[baseIdx + 1] : defaultBase(cwd);
    if (!base) throw new Error('--base needs a ref');
    if (base.startsWith('-')) throw new Error('--base must be a ref, not an option (it starts with "-")');
    const mergeBase = git(['merge-base', base, 'HEAD'], cwd).trim();
    const ns = git(['diff', '--name-status', '-z', '--no-renames', mergeBase], cwd).split('\0');
    const changed = [];
    for (let i = 0; i + 1 < ns.length; i += 2) {
      const status = ns[i][0];
      if (status === 'D') continue;
      changed.push({ status, file: ns[i + 1] });
    }
    findings = [];
    for (const { status, file } of changed) {
      if (status === 'A' && isSecretPath(file, '.')) findings.push({ file, line: 0, rule: 'secret-file' });
      const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', mergeBase, '--', file], cwd);
      findings.push(...scanFileDiff(file, diff));
    }
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], cwd).split('\0').filter(Boolean);
    for (const file of untracked) {
      if (isSecretPath(file, '.')) findings.push({ file, line: 0, rule: 'secret-file' });
      let text = '';
      try {
        if (fs.statSync(path.join(cwd, file)).size > MAX_UNTRACKED_BYTES) { largeSkipped += 1; continue; }
        text = fs.readFileSync(path.join(cwd, file), 'utf8');
      } catch { continue; }
      if (text.includes('\0')) continue;
      findings.push(...scanLines(file, text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }))));
    }
    // A net finding that a commit already explains (same file, line, rule) is shown once, with its commit.
    const history = scanHistory(mergeBase, cwd);
    const key = (f) => [f.file, f.line, f.rule].join('\0');
    const inHistory = new Set(history.map(key));
    findings = [...findings.filter((f) => !inHistory.has(key(f))), ...history];
    fileCount = changed.length + untracked.length;
  } catch (err) {
    process.stderr.write(`secret-scan: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (findings.length === 0) {
    const skipped = largeSkipped ? `, ${largeSkipped} large file${largeSkipped === 1 ? '' : 's'} skipped` : '';
    process.stdout.write(`secret-scan: clean (${fileCount} files scanned${skipped})\n`);
    return;
  }
  process.stdout.write(`secret-scan: ${findings.length} finding(s)\n${findings.map((f) => `  - ${f.file}:${f.line} ${f.rule}${f.commit ? ` (commit ${f.commit})` : ''}`).join('\n')}\n`);
  process.exitCode = 1;
}

function isMain() {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) main();

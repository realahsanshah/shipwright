#!/usr/bin/env node
// Scans the branch's changes (committed since the merge-base, uncommitted, and
// untracked) for credentials. Prints file:line and rule only, never the value.
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
  { id: 'generic-assignment', re: /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i },
];
const PLACEHOLDER = /^(?:x+|\*+|changeme|change_me|example|placeholder|dummy|redacted|your[_-].*)$|[<>{}$]/i;
const ALLOW = 'shipwright:allow-secret';

export function scanLines(file, lines) {
  const findings = [];
  for (const { line, text } of lines) {
    if (text.includes(ALLOW)) continue;
    for (const rule of RULES) {
      const m = text.match(rule.re);
      if (!m) continue;
      if (rule.id === 'generic-assignment' && PLACEHOLDER.test(m[1])) continue;
      findings.push({ file, line, rule: rule.id });
    }
  }
  return findings;
}

export function scanDiff(diffText) {
  const findings = [];
  let file = null;
  let isNew = false;
  let lineNo = 0;
  let added = [];
  const flush = () => {
    if (file === null) return;
    if (isNew && isSecretPath(file, '.')) findings.push({ file, line: 0, rule: 'secret-file' });
    findings.push(...scanLines(file, added));
    added = [];
  };
  for (const raw of diffText.split(/\r?\n/)) {
    if (raw.startsWith('diff --git ')) { flush(); file = null; isNew = false; continue; }
    if (raw.startsWith('new file mode')) { isNew = true; continue; }
    if (raw.startsWith('--- ')) { if (raw === '--- /dev/null') isNew = true; continue; }
    if (raw.startsWith('+++ ')) { file = raw === '+++ /dev/null' ? null : raw.slice(4).replace(/^b\//, ''); continue; }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (file === null) continue;
    if (raw.startsWith('+')) { added.push({ line: lineNo, text: raw.slice(1) }); lineNo += 1; }
    else if (raw.startsWith(' ')) lineNo += 1;
  }
  flush();
  return findings;
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error((r.stderr || r.error?.message || 'git failed').trim());
  return r.stdout;
}

function defaultBase(cwd) {
  for (const ref of ['origin/HEAD', 'main', 'master']) {
    try { git(['rev-parse', '--verify', '--quiet', ref], cwd); return ref; } catch { /* try next */ }
  }
  throw new Error('no --base given and none of origin/HEAD, main, master exists');
}

function main() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base');
  const cwd = process.cwd();
  let findings;
  let fileCount;
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd);
    const base = baseIdx >= 0 ? args[baseIdx + 1] : defaultBase(cwd);
    if (!base) throw new Error('--base needs a ref');
    const mergeBase = git(['merge-base', base, 'HEAD'], cwd).trim();
    const diff = git(['diff', '--unified=0', '--no-color', '--no-ext-diff', mergeBase], cwd);
    findings = scanDiff(diff);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], cwd).split('\0').filter(Boolean);
    for (const file of untracked) {
      if (isSecretPath(file, '.')) findings.push({ file, line: 0, rule: 'secret-file' });
      let text = '';
      try { text = fs.readFileSync(path.join(cwd, file), 'utf8'); } catch { continue; }
      if (text.includes('\0')) continue;
      findings.push(...scanLines(file, text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }))));
    }
    fileCount = new Set([...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]).concat(untracked)).size;
  } catch (err) {
    process.stderr.write(`secret-scan: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (findings.length === 0) {
    process.stdout.write(`secret-scan: clean (${fileCount} files scanned)\n`);
    return;
  }
  process.stdout.write(`secret-scan: ${findings.length} finding(s)\n${findings.map((f) => `  - ${f.file}:${f.line} ${f.rule}`).join('\n')}\n`);
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

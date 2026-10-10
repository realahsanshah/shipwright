#!/usr/bin/env node
// PreToolUse guard: blocks secret files (read or write, via file tools, Grep and shell
// commands), edits to the project's danger zones, and destructive commands.
// Exit 2 blocks; stderr is the reason. Exit 1 is a non-blocking internal error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix, projectRelative, matchesAny } from './lib/paths.mjs';

// Secret groups. A path is secret when it matches a group's globs and none of that group's
// exceptions (templates and public keys stay readable). `shellLoose` marks the groups whose
// bare dotted tokens (jq's `.data.key`) are not treated as files when they appear in a shell command.
export const SECRET_GROUPS = [
  { globs: ['**/.env*'], exceptions: ['**/.env*.example', '**/.env*.sample', '**/.env*.template'] },
  { globs: ['**/.ssh/id_*'], exceptions: ['**/.ssh/id_*.pub'] },
  { globs: ['**/.dev.vars*'], exceptions: ['**/.dev.vars*.example'] },
  { globs: ['**/*.tfvars'], exceptions: ['**/*.tfvars.example'] },
  { globs: ['**/*.pem', '**/*.key'], exceptions: [], shellLoose: true },
  {
    globs: [
      '**/*.p12', '**/*.pfx',
      '**/secrets/**', '**/*.tfstate', '**/*.tfstate.backup',
      '**/.aws/credentials', '**/.aws/sso/cache/**',
      '**/.config/gcloud/**', '**/AppData/Roaming/gcloud/**',
      '**/.azure/**', '**/.kube/config',
      '**/.config/gh/hosts.yml', '**/AppData/Roaming/GitHub CLI/hosts.yml',
      '**/.git-credentials', '**/.netrc', '**/_netrc',
      '**/.docker/config.json',
      '**/.wrangler/config/**',
    ],
    exceptions: [],
  },
];

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// A destructive command must start a shell segment: after a separator, an opening
// bracket or quote, a keyword, then optional env assignments and sudo/env wrappers.
const CMD_PREFIX = String.raw`(?:^|[;&|\n(\x60'"{]\s*|\b(?:then|do|else)\s+)(?:(?:sudo|env)\s+|[A-Za-z_]\w*=\S*\s+)*`;
const GIT = String.raw`git(?:\.exe)?\s+(?:(?:-C|-c)\s+\S+\s+|--git-dir=\S+\s+|--work-tree=\S+\s+)*`;
const TERRAFORM = String.raw`terraform(?:\.exe)?\s+`;
const DANGEROUS_COMMANDS = [
  {
    rule: 'git push --force',
    pattern: new RegExp(`${CMD_PREFIX}${GIT}push\\b[^;&|\\n]*(?:\\s--force(?![-\\w])|\\s-[a-zA-Z]*f[a-zA-Z]*\\b|\\s\\+\\S)`),
  },
  { rule: 'terraform destroy', pattern: new RegExp(`${CMD_PREFIX}${TERRAFORM}(?:-chdir=\\S+\\s+)?destroy\\b`) },
  { rule: 'terraform apply -destroy', pattern: new RegExp(`${CMD_PREFIX}${TERRAFORM}(?:-chdir=\\S+\\s+)?apply\\b[^;&|\\n]*\\s-destroy\\b`) },
  { rule: 'kubectl delete namespace', pattern: new RegExp(`${CMD_PREFIX}kubectl(?:\\.exe)?\\b[^;&|\\n]*\\sdelete\\s+(?:namespaces?|ns)\\b`) },
];

// Tokens: double-quoted, single-quoted, or bare. The matched group decides the value.
const TOKEN = /"([^"]*)"|'([^']*)'|([^\s;|&<>()`"']+)/g;

export function readDangerZones(projectDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8');
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+danger zones\s*$/i.test(l));
  if (start === -1) return [];
  const zones = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    const m = line.match(/^\s*[-*]\s+`([^`]+)`/);
    if (m) {
      const glob = m[1].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
      if (!glob) continue;
      if (glob.endsWith('/')) zones.push(`${glob}**`);
      else if (/[*?]/.test(glob)) zones.push(glob);
      else zones.push(glob, `${glob}/**`); // a bare path protects itself and everything below
    }
  }
  return zones;
}

// True when a path (relative to projectDir, or absolute) is a secret file.
export function isSecretPath(p, projectDir) {
  return secretHit(p, projectDir, false);
}

function secretHit(p, projectDir, shellToken) {
  const abs = toPosix(path.resolve(projectDir, p));
  return SECRET_GROUPS.some((g) => {
    if (shellToken && g.shellLoose && /^\.[^/\\]*$/.test(p)) return false;
    return matchesAny(abs, g.globs) && !matchesAny(abs, g.exceptions);
  });
}

const SECRET_REASON = 'secret files are never read or edited by Claude. '
  + 'Work with a reference (e.g. account_ref) and let scripts or CI resolve the value.';

export function checkFile(toolName, filePath, projectDir) {
  if (isSecretPath(filePath, projectDir)) {
    return `${toolName} on ${filePath} blocked: ${SECRET_REASON}`;
  }
  if (!WRITE_TOOLS.has(toolName)) return null;
  const rel = projectRelative(filePath, projectDir);
  if (rel === null) return null;
  const zone = readDangerZones(projectDir).find((z) => matchesAny(rel, [z]));
  if (!zone) return null;
  return `${toolName} on ${rel} blocked: it matches danger zone \`${zone}\` in CLAUDE.md. `
    + 'Ask the engineer to make this change, or to remove the zone if it is wrong.';
}

export function checkCommand(command) {
  const hit = DANGEROUS_COMMANDS.find((d) => d.pattern.test(command));
  return hit ? `Command blocked: \`${hit.rule}\` is never run by Claude in this kit. If it is really needed, the engineer runs it.` : null;
}

// Shell commands that name a secret file as an argument (cat .env, cp .env.example .env, ...).
export function checkShellSecrets(command, projectDir) {
  const tokens = [];
  for (const m of command.matchAll(TOKEN)) tokens.push(m[1] ?? m[2] ?? m[3]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-m' || t === '--message') {
      i++; // the next token is a commit message, not a path
      continue;
    }
    let candidate = t;
    if (t.startsWith('-')) {
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      candidate = t.slice(eq + 1);
    }
    if (!candidate) continue;
    const p = candidate.startsWith('~/') ? path.join(os.homedir(), candidate.slice(2)) : candidate;
    if (secretHit(p, projectDir, true)) {
      return `Command blocked: it references secret file ${candidate}. `
        + 'Claude never reads secret values; work with references (account_ref) instead.';
    }
  }
  return null;
}

// Grep: block a secret target path, or a glob that would match secret files.
// Each `*` is replaced with `x` so `.env*` tests as `.envx` and `*.pem` as `x.pem`.
function checkGrep(toolInput, projectDir) {
  const p = toolInput.path;
  if (typeof p === 'string' && p && isSecretPath(p, projectDir)) {
    return `Grep on ${p} blocked: ${SECRET_REASON}`;
  }
  const g = toolInput.glob;
  if (typeof g === 'string' && g && isSecretPath(g.replace(/\*/g, 'x'), projectDir)) {
    return `Grep with glob ${g} blocked: ${SECRET_REASON}`;
  }
  return null;
}

export function decide(input, projectDir) {
  const tool = input.tool_name;
  const toolInput = input.tool_input ?? {};
  if (FILE_TOOLS.has(tool)) {
    const p = toolInput.file_path ?? toolInput.notebook_path;
    return typeof p === 'string' && p ? checkFile(tool, p, projectDir) : null;
  }
  if (tool === 'Grep') return checkGrep(toolInput, projectDir);
  if (SHELL_TOOLS.has(tool) && typeof toolInput.command === 'string') {
    return checkCommand(toolInput.command) ?? checkShellSecrets(toolInput.command, projectDir);
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('expected a JSON object');
    }
  } catch (err) {
    // Exit 1 is non-blocking: a broken guard must not brick the session.
    process.stderr.write(`pre-tool-guard: could not parse hook input (${err.message}); allowing the call.\n`);
    process.exit(1);
  }
  let reason;
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    reason = decide(input, projectDir);
  } catch (err) {
    process.stderr.write(`pre-tool-guard: internal error (${err.message}); allowing the call.\n`);
    process.exit(1);
  }
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

function isMain() {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) main();

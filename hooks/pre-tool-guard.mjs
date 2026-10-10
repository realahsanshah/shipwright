#!/usr/bin/env node
// PreToolUse guard: blocks secret files (read or write), edits to the project's
// danger zones, and destructive commands. Exit 2 blocks; stderr is the reason.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toPosix, projectRelative, matchesAny } from './lib/paths.mjs';

export const SECRET_GLOBS = [
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx',
  '**/secrets/**', '**/*.tfstate', '**/*.tfstate.backup',
  '**/.aws/credentials', '**/.config/gcloud/**', '**/.azure/**', '**/.kube/config',
];
// Committed templates with no values; /onboard reads them to learn required env vars.
export const SECRET_EXCEPTIONS = ['**/.env.example', '**/.env.sample', '**/.env.template'];

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// Each pattern is anchored to the start of a shell segment so quoted mentions in echo/notes pass.
const SEGMENT_START = String.raw`(?:^|[;&|\n(]\s*)`;
const DANGEROUS_COMMANDS = [
  { rule: 'git push --force', pattern: new RegExp(`${SEGMENT_START}git\\s+push\\b[^;&|\\n]*\\s(?:--force(?![-\\w])|-f\\b)`) },
  { rule: 'terraform destroy', pattern: new RegExp(`${SEGMENT_START}terraform\\s+(?:-chdir=\\S+\\s+)?destroy\\b`) },
  { rule: 'terraform apply -destroy', pattern: new RegExp(`${SEGMENT_START}terraform\\s+(?:-chdir=\\S+\\s+)?apply\\b[^;&|\\n]*\\s-destroy\\b`) },
  { rule: 'kubectl delete namespace', pattern: new RegExp(`${SEGMENT_START}kubectl\\b[^;&|\\n]*\\sdelete\\s+(?:namespaces?|ns)\\b`) },
];

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
      const glob = m[1].trim().replace(/^\.\//, '');
      zones.push(glob.endsWith('/') ? `${glob}**` : glob);
    }
  }
  return zones;
}

export function checkFile(toolName, filePath, projectDir) {
  const abs = toPosix(path.resolve(projectDir, filePath));
  if (matchesAny(abs, SECRET_GLOBS) && !matchesAny(abs, SECRET_EXCEPTIONS)) {
    return `${toolName} on ${filePath} blocked: secret files are never read or edited by Claude. `
      + 'Work with a reference (e.g. account_ref) and let scripts or CI resolve the value.';
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

export function decide(input, projectDir) {
  const tool = input.tool_name;
  const toolInput = input.tool_input ?? {};
  if (FILE_TOOLS.has(tool)) {
    const p = toolInput.file_path ?? toolInput.notebook_path;
    return typeof p === 'string' && p ? checkFile(tool, p, projectDir) : null;
  }
  if (SHELL_TOOLS.has(tool) && typeof toolInput.command === 'string') return checkCommand(toolInput.command);
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (err) {
    // Exit 1 is non-blocking: a broken guard must not brick the session.
    process.stderr.write(`pre-tool-guard: could not parse hook input (${err.message}); allowing the call.\n`);
    process.exit(1);
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const reason = decide(input, projectDir);
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

#!/usr/bin/env node
// PostToolUse: after Claude edits a file, run the project's own formatter and
// linter on it. Silent on success; problems go back to Claude via exit 2.
// Opt out with SHIPWRIGHT_FORMAT_ON_EDIT=0.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectRelative, matchesAny } from './lib/paths.mjs';
import { isSecretPath, readDangerZones } from './pre-tool-guard.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const PRETTIER_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.css', '.scss', '.less', '.md', '.mdx', '.yaml', '.yml', '.html', '.vue', '.graphql']);
const ESLINT_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue']);
const PYTHON_EXT = new Set(['.py', '.pyi']);
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|out|coverage|\.venv|venv|__pycache__|\.delivery)(\/|$)/;
const TOOL_TIMEOUT_MS = 25000;
const MAX_FEEDBACK_LINES = 60;

export function localBin(projectDir, name, exists = fs.existsSync) {
  const base = path.join(projectDir, 'node_modules', '.bin', name);
  const candidates = process.platform === 'win32' ? [`${base}.cmd`, base] : [base];
  return candidates.find((c) => exists(c)) ?? null;
}

export function onPath(name, env = process.env, exists = fs.existsSync) {
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

export function planTools(relPath, projectDir, find = { localBin, onPath }) {
  const ext = path.extname(relPath).toLowerCase();
  const tools = [];
  if (PRETTIER_EXT.has(ext)) {
    const bin = find.localBin(projectDir, 'prettier');
    if (bin) tools.push({ kind: 'format', name: 'prettier', cmd: bin, args: ['--write', relPath] });
  }
  if (ESLINT_EXT.has(ext)) {
    const bin = find.localBin(projectDir, 'eslint');
    if (bin) tools.push({ kind: 'lint', name: 'eslint', cmd: bin, args: [relPath] });
  }
  if (PYTHON_EXT.has(ext)) {
    const bin = find.onPath('ruff');
    if (bin) {
      tools.push({ kind: 'format', name: 'ruff format', cmd: bin, args: ['format', relPath] });
      tools.push({ kind: 'lint', name: 'ruff check', cmd: bin, args: ['check', relPath] });
    }
  }
  return tools;
}

export function shouldSkip(relPath, projectDir) {
  if (relPath === null || SKIP_DIRS.test(relPath)) return true;
  if (isSecretPath(relPath, projectDir)) return true;
  return readDangerZones(projectDir).some((zone) => matchesAny(relPath, [zone]));
}

// .cmd shims need a shell on Windows (Node refuses to spawn them directly), so quote everything.
export function runTool(tool, projectDir) {
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(tool.cmd);
  const r = useShell
    ? spawnSync([tool.cmd, ...tool.args].map((a) => `"${a}"`).join(' '), { cwd: projectDir, encoding: 'utf8', shell: true, timeout: TOOL_TIMEOUT_MS })
    : spawnSync(tool.cmd, tool.args, { cwd: projectDir, encoding: 'utf8', timeout: TOOL_TIMEOUT_MS });
  if (r.error?.code === 'ETIMEDOUT') return { ok: true, output: '' }; // a slow tool must not block editing
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, output };
}

function main() {
  if (process.env.SHIPWRIGHT_FORMAT_ON_EDIT === '0') process.exit(0);
  let feedback = null;
  try {
    let input;
    try {
      input = JSON.parse(fs.readFileSync(0, 'utf8'));
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('expected a JSON object');
      }
    } catch (err) {
      process.stderr.write(`post-edit-format: could not parse hook input (${err.message}).\n`);
      process.exit(1);
    }
    const filePath = input.tool_input?.file_path;
    if (!EDIT_TOOLS.has(input.tool_name) || typeof filePath !== 'string' || !filePath) process.exit(0);
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const rel = projectRelative(filePath, projectDir);
    if (shouldSkip(rel, projectDir)) process.exit(0);
    const outputs = [];
    let lintFailed = false;
    for (const tool of planTools(rel, projectDir)) {
      const r = runTool(tool, projectDir);
      if (r.ok) continue;
      if (tool.kind === 'format') outputs.push(`format failed (${tool.name})${r.output ? `:\n${r.output}` : ''}`);
      else {
        lintFailed = true;
        outputs.push(r.output || `${tool.name} reported errors`);
      }
    }
    if (outputs.length) {
      const head = lintFailed ? `lint errors in ${rel}` : `format failed in ${rel}`;
      const body = outputs.join('\n\n').split(/\r?\n/).slice(0, MAX_FEEDBACK_LINES).join('\n');
      feedback = `post-edit-format: ${head}\n${body}\n`;
    }
  } catch (err) {
    process.stderr.write(`post-edit-format: internal error (${err.message}).\n`);
    process.exit(1);
  }
  if (feedback) {
    process.stderr.write(feedback);
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

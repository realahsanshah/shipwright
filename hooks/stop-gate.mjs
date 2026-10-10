#!/usr/bin/env node
// Stop hook: while the active ticket's latest /verify failed and attempts remain,
// refuse to let Claude finish (exit 2; stderr tells it why). Narrow on purpose so
// it never traps a session that has moved on.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVerifyReport, MAX_ATTEMPTS } from '../scripts/lib/delivery-docs.mjs';

const TICKET_ID = /^(?!.*\.\.)[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$/;

export function gitBranch(projectDir) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectDir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function decideStop(input, projectDir, currentBranch = gitBranch) {
  if (input.stop_hook_active === true) return null;
  let id;
  try {
    id = fs.readFileSync(path.join(projectDir, '.delivery', 'active'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0].trim();
  } catch {
    return null;
  }
  if (!TICKET_ID.test(id)) return null;
  if (currentBranch(projectDir) !== `feat/${id}`) return null;
  let text;
  try {
    text = fs.readFileSync(path.join(projectDir, '.delivery', id, 'verify-report.md'), 'utf8');
  } catch {
    return null;
  }
  const report = parseVerifyReport(text);
  if (report.status !== 'FAIL') return null;
  const attempts = report.attempts ?? 1;
  if (attempts >= MAX_ATTEMPTS) return null;
  return `Verify failed for ${id} (attempt ${attempts} of ${MAX_ATTEMPTS}). Fix what .delivery/${id}/verify-report.md lists and rerun /verify. `
    + 'If you cannot make progress, explain why to the engineer and stop.';
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('expected a JSON object');
    }
  } catch (err) {
    process.stderr.write(`stop-gate: could not parse hook input (${err.message}); allowing stop.\n`);
    process.exit(1);
  }
  let reason;
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    reason = decideStop(input, projectDir);
  } catch (err) {
    process.stderr.write(`stop-gate: internal error (${err.message}); allowing stop.\n`);
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

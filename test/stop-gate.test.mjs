import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decideStop } from '../hooks/stop-gate.mjs';

const hook = fileURLToPath(new URL('../hooks/stop-gate.mjs', import.meta.url));
const dirs = [];

function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix} `));
  dirs.push(d);
  return d;
}

function project({ active = 'HC-1', report } = {}) {
  const d = tmp('stop gate');
  if (active !== null) {
    fs.mkdirSync(path.join(d, '.delivery'), { recursive: true });
    fs.writeFileSync(path.join(d, '.delivery', 'active'), `${active}\n`);
  }
  if (report !== undefined) {
    fs.mkdirSync(path.join(d, '.delivery', 'HC-1'), { recursive: true });
    fs.writeFileSync(path.join(d, '.delivery', 'HC-1', 'verify-report.md'), report);
  }
  return d;
}

const FAIL1 = '# Verify report: HC-1\n\nStatus: FAIL\nAttempts: 1\n';
const onFeat = () => 'feat/HC-1';

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('blocks on a failed verify with attempts left', () => {
  const msg = decideStop({ stop_hook_active: false }, project({ report: FAIL1 }), onFeat);
  assert.ok(msg);
  assert.match(msg, /HC-1/);
  assert.match(msg, /attempt 1 of 3/);
  assert.match(msg, /verify-report\.md/);
});

test('does not block when stop_hook_active', () => {
  assert.equal(decideStop({ stop_hook_active: true }, project({ report: FAIL1 }), onFeat), null);
});

test('does not block off the feature branch or with unknown branch', () => {
  const d = project({ report: FAIL1 });
  assert.equal(decideStop({}, d, () => 'main'), null);
  assert.equal(decideStop({}, d, () => null), null);
});

test('does not block without a valid active ticket', () => {
  assert.equal(decideStop({}, project({ active: null, report: FAIL1 }), onFeat), null);
  assert.equal(decideStop({}, project({ active: '../x', report: FAIL1 }), () => 'feat/../x'), null);
});

test('does not block on missing, PASS or unparsable reports', () => {
  assert.equal(decideStop({}, project(), onFeat), null);
  assert.equal(decideStop({}, project({ report: '# r\n\nStatus: PASS\nAttempts: 1\n' }), onFeat), null);
  assert.equal(decideStop({}, project({ report: '# r\n\nno status here\n' }), onFeat), null);
});

test('attempt limits', () => {
  assert.equal(decideStop({}, project({ report: '# r\n\nStatus: FAIL\nAttempts: 3\n' }), onFeat), null);
  const msg = decideStop({}, project({ report: '# r\n\nStatus: FAIL\n' }), onFeat);
  assert.match(msg, /attempt 1 of 3/);
});

function gitRepo() {
  const d = tmp('stop gate repo');
  const g = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  assert.equal(g('init', '-b', 'feat/HC-1').status, 0);
  assert.equal(g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init').status, 0);
  return d;
}

function run(input, dir) {
  return spawnSync(process.execPath, [hook], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
}

test('process: exits 2 with the reason on stderr', () => {
  const d = gitRepo();
  fs.mkdirSync(path.join(d, '.delivery', 'HC-1'), { recursive: true });
  fs.writeFileSync(path.join(d, '.delivery', 'active'), 'HC-1\n');
  fs.writeFileSync(path.join(d, '.delivery', 'HC-1', 'verify-report.md'), FAIL1);
  const r = run('{"stop_hook_active": false}', d);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /verify-report\.md/);
});

test('process: malformed stdin exits 1', () => {
  const r = run('not json', gitRepo());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stop-gate: could not parse hook input/);
});

test('process: no .delivery exits 0', () => {
  const r = run('{}', gitRepo());
  assert.equal(r.status, 0, r.stderr);
});

test('process: SHIPWRIGHT_STOP_GATE=0 opts out even when it would block', () => {
  const d = gitRepo();
  fs.mkdirSync(path.join(d, '.delivery', 'HC-1'), { recursive: true });
  fs.writeFileSync(path.join(d, '.delivery', 'active'), 'HC-1\n');
  fs.writeFileSync(path.join(d, '.delivery', 'HC-1', 'verify-report.md'), FAIL1);
  const r = spawnSync(process.execPath, [hook], {
    input: '{"stop_hook_active": false}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: d, SHIPWRIGHT_STOP_GATE: '0' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

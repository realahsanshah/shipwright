import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { specText } from './helpers/delivery-fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check cli '));
const write = (name, text) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, text);
  return f;
};
const run = (script, ...args) => spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' });

test('check-spec: valid spec exits 0', () => {
  const r = run('check-spec.mjs', write('spec.md', specText()));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ok: /);
});

test('check-spec: draft exits 1', () => {
  const r = run('check-spec.mjs', write('draft.md', specText({ approved: false })));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^failed: /);
  assert.match(r.stdout, /^ {2}- spec is not approved/m);
});

test('check-spec: usage and missing file exit 2', () => {
  assert.equal(run('check-spec.mjs').status, 2);
  assert.equal(run('check-spec.mjs', path.join(tmp, 'nope.md')).status, 2);
});

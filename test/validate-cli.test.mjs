import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const fixture = (n) => fileURLToPath(new URL(`./fixtures/tickets/${n}`, import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipwright validate '));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('valid ticket exits 0', () => {
  const r = run('ticket', fixture('valid-doc-example.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^valid: /);
});

test('invalid ticket exits 1 and lists errors', () => {
  const r = run('ticket', fixture('invalid-missing-and-bad-enum.json'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^invalid: /);
  assert.match(r.stdout, /  - \/: missing required property "title"/);
});

test('UTF-8 BOM and CRLF are accepted (path with spaces)', () => {
  const body = fs.readFileSync(fixture('valid-doc-example.json'), 'utf8').replace(/\n/g, '\r\n');
  const file = path.join(tmp, 'bom ticket.json');
  fs.writeFileSync(file, '\uFEFF' + body);
  const r = run('ticket', file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('usage, unknown schema, unreadable file, bad JSON exit 2', () => {
  assert.equal(run().status, 2);
  assert.equal(run('ticket').status, 2);
  const unknown = run('nope', fixture('valid-doc-example.json'));
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown schema "nope"; available: ticket/);
  assert.equal(run('../schemas/ticket', fixture('valid-doc-example.json')).status, 2);
  assert.equal(run('ticket', path.join(tmp, 'missing.json')).status, 2);
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, '{ not json');
  const r = run('ticket', bad);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
});

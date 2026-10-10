import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { specText, planText, buildLogText, verifyReportText, reviewText, prDescriptionText } from './helpers/delivery-fixtures.mjs';
import { parsePlan, parseSpec } from '../scripts/lib/delivery-docs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check cli '));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write =(name, text) => {
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

test('check-plan: valid exits 0, invalid exits 1, usage exits 2', () => {
  const spec = write('spec2.md', specText());
  const good = run('check-plan.mjs', spec, write('plan.md', planText()));
  assert.equal(good.status, 0);
  assert.match(good.stdout, /^ok: /);
  const bad = run('check-plan.mjs', spec, write('bad-plan.md', planText({ steps: '' })));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^failed: /);
  assert.equal(run('check-plan.mjs', spec).status, 2);
});

test('check-build: valid exits 0, invalid exits 1, usage exits 2', () => {
  const plan = parsePlan(planText());
  const planFile = write('plan3.md', planText());
  const good = run('check-build.mjs', planFile, write('build-log.md', buildLogText(plan)));
  assert.equal(good.status, 0);
  assert.match(good.stdout, /^ok: /);
  const bad = run('check-build.mjs', planFile, write('bad-log.md', buildLogText(plan, { 1: { Status: 'BLOCKED' } })));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^failed: /);
  assert.equal(run('check-build.mjs', planFile).status, 2);
});

test('check-verify: PASS exits 0, consistent FAIL exits 1, inconsistent exits 1, usage exits 2', () => {
  const spec = parseSpec(specText());
  const specFile = write('spec4.md', specText());
  const good = run('check-verify.mjs', specFile, write('verify-report.md', verifyReportText(spec)));
  assert.equal(good.status, 0);
  assert.match(good.stdout, /^ok: /);
  const failed = run('check-verify.mjs', specFile, write('fail-report.md', verifyReportText(spec, { status: 'FAIL', attempts: 2, checks: { tests: { result: 'FAIL' } } })));
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^failed: /);
  assert.match(failed.stdout, /Status: FAIL \(attempt 2 of 3\)/);
  const bad = run('check-verify.mjs', specFile, write('bad-report.md', verifyReportText(spec, { checks: { lint: null } })));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /missing check "lint"/);
  assert.equal(run('check-verify.mjs', specFile).status, 2);
});

test('check-review: valid exits 0, FAIL verify and stale commits exit 1, usage exits 2', () => {
  const spec = parseSpec(specText());
  const specFile = write('spec5.md', specText());
  const verifyFile = write('verify5.md', verifyReportText(spec));
  const reviewFile = write('review5.md', reviewText());
  const prFile = write('pr5.md', prDescriptionText(spec));
  const good = run('check-review.mjs', specFile, verifyFile, reviewFile, prFile);
  assert.equal(good.status, 0, good.stdout);
  assert.match(good.stdout, /^ok: /);
  assert.equal(run('check-review.mjs', specFile, verifyFile, reviewFile, prFile, '--head', '9e05129').status, 0);

  const failedVerify = write('verify5-fail.md', verifyReportText(spec, { status: 'FAIL', checks: { tests: { result: 'FAIL' } } }));
  const failed = run('check-review.mjs', specFile, failedVerify, reviewFile, prFile);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^ {2}- verify: /m);

  const stale = run('check-review.mjs', specFile, verifyFile, reviewFile, prFile, '--head', 'deadbee');
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /verify-report Commit .* is stale/);
  assert.match(stale.stdout, /review Commit .* is stale/);

  assert.equal(run('check-review.mjs', specFile, verifyFile, reviewFile).status, 2);
  assert.equal(run('check-review.mjs', specFile, verifyFile, reviewFile, prFile, '--head').status, 2);
});

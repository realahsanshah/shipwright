import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, checkSpec, SPEC_SECTIONS, parsePlan, checkPlan, parseBuildLog, checkBuild, parseVerifyReport, checkVerify, parseReview, checkReview, parsePrDescription, checkPrDescription, sameCommit } from '../scripts/lib/delivery-docs.mjs';
import { specText, planText, buildLogText, verifyReportText, reviewText, prDescriptionText } from './helpers/delivery-fixtures.mjs';

test('valid spec parses and passes', () => {
  const s = parseSpec(specText());
  assert.equal(s.approved, true);
  assert.equal(s.approver, 'Ahsan Shah');
  assert.equal(s.approvedOn, '2026-10-10');
  assert.deepEqual(s.acIds, ['AC-1', 'AC-2']);
  assert.deepEqual(checkSpec(s), []);
});

test('draft and missing status', () => {
  assert.match(checkSpec(parseSpec(specText({ approved: false })))[0], /not approved/);
  const noStatus = specText().replace(/^Status:.*\n/m, '');
  assert.match(checkSpec(parseSpec(noStatus)).join('\n'), /no Status: line/);
});

test('missing sections and order', () => {
  for (const name of SPEC_SECTIONS) {
    const text = specText().replace(new RegExp(`^## ${name}$`, 'm'), '### gone');
    assert.ok(checkSpec(parseSpec(text)).includes(`missing section "## ${name}"`), name);
  }
  const swapped = specText().replace('## Risks', '## TMP').replace('## Edge cases', '## Risks').replace('## TMP', '## Edge cases');
  assert.match(checkSpec(parseSpec(swapped)).join('\n'), /out of order/);
});

test('open questions and gate result', () => {
  assert.match(checkSpec(parseSpec(specText({ openQuestions: '- Who owns this?' }))).join('\n'), /open questions remain/);
  assert.ok(checkSpec(parseSpec(specText({ extraSections: '\n## Gate result\nFAIL\n' }))).length > 0);
});

test('acceptance criteria rules', () => {
  assert.match(checkSpec(parseSpec(specText({ acs: [] }))).join('\n'), /no acceptance criteria/);
  assert.match(checkSpec(parseSpec(specText({ acs: ['AC-1', 'AC-1'] }))).join('\n'), /numbered twice/);
});

test('AC line variants', () => {
  for (const line of ['- AC-1: x', '* AC-1: x', '1. AC-1: x', '**AC-1**: x', '- **AC-1** x']) {
    const text = specText().replace(/^- AC-1: .*$/m, line);
    assert.deepEqual(parseSpec(text).acIds, ['AC-1', 'AC-2'], line);
  }
  const prose = specText().replace(/^- AC-1: .*$/m, 'See AC-1 above');
  assert.deepEqual(parseSpec(prose).acIds, ['AC-2']);
});

test('headings inside fences are ignored', () => {
  const text = specText({ extraSections: '\n```\n## Fake\n```\n' });
  assert.ok(!parseSpec(text).order.includes('Fake'));
});

test('CRLF and BOM are tolerated', () => {
  const lf = parseSpec(specText());
  const crlf = parseSpec('\uFEFF' + specText().replace(/\n/g, '\r\n'));
  assert.deepEqual(crlf, lf);
  assert.deepEqual(checkSpec(crlf), []);
});

const TEMPLATE_PLAN = `# Plan: HC-142 Export appointments to CSV

Spec: .delivery/HC-142/spec.md (approved by Ahsan Shah on 2026-10-10)

## Steps

### Step 1: CSV serializer for appointments
- Covers: AC-2, AC-5
- Files: \`api/services/csv_export.py (new)\`, \`api/tests/test_csv_export.py (new)\`
- Test: \`api/tests/test_csv_export.py::test_columns_and_escaping\` — header row and formula-prefix escaping
- Depends on: none

### Step 2: Export endpoint honours filters
- Covers: AC-1, AC-3, AC-4
- Files: \`api/routes/appointments.py\`, \`api/tests/test_export_endpoint.py (new)\`
- Test: \`api/tests/test_export_endpoint.py::test_export_respects_filters\` — filtered rows only, 403 for non-admin
- Depends on: Step 1
`;
const FIVE = ['AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5'];
const spec2 = parseSpec(specText());
const planErrors = (steps, spec = spec2) => checkPlan(spec, parsePlan(planText({ spec, steps }))).join('\n');
const step = (n, { covers = 'AC-1', files = '`a.js`', test = '`a.test.js`', extra = '' } = {}) =>
  `### Step ${n}: Do ${n}\n${covers === null ? '' : `- Covers: ${covers}\n`}${files === null ? '' : `- Files: ${files}\n`}${test === null ? '' : `- Test: ${test}\n`}${extra}`;

test('plan template parses and passes', () => {
  const spec = parseSpec(specText({ acs: FIVE }));
  const plan = parsePlan(TEMPLATE_PLAN);
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps[0].covers, ['AC-2', 'AC-5']);
  assert.deepEqual(plan.steps[0].files, ['api/services/csv_export.py (new)', 'api/tests/test_csv_export.py (new)']);
  assert.deepEqual(plan.steps[1].dependsOn, [1]);
  assert.deepEqual(checkPlan(spec, plan), []);
});

test('generated plan passes', () => {
  assert.deepEqual(checkPlan(spec2, parsePlan(planText())), []);
});

test('draft spec gives spec: errors', () => {
  const draft = parseSpec(specText({ approved: false }));
  const errs = checkPlan(draft, parsePlan(planText({ spec: spec2 })));
  assert.ok(errs.some((e) => e.startsWith('spec: ')));
});

test('stale Spec: line', () => {
  const other = { ...spec2, approver: 'Someone Else' };
  assert.match(checkPlan(spec2, parsePlan(planText({ spec: other }))).join('\n'), /does not match the current spec approval/);
  const later = { ...spec2, approvedOn: '2026-10-11' };
  assert.match(checkPlan(spec2, parsePlan(planText({ spec: later }))).join('\n'), /does not match the current spec approval/);
});

test('step numbering', () => {
  assert.match(checkPlan(spec2, parsePlan(planText({ steps: '' }))).join('\n'), /no "### Step N/);
  assert.match(planErrors(`${step(1, { covers: 'AC-1' })}\n${step(3, { covers: 'AC-2' })}`), /numbered 1, 2, 3/);
});

test('missing fields are step-specific', () => {
  assert.match(planErrors(`${step(1, { covers: null })}\n${step(2, { covers: 'AC-1, AC-2' })}`), /Step 1: missing "- Covers:"/);
  assert.match(planErrors(step(1, { covers: 'AC-1, AC-2', files: null })), /Step 1: missing "- Files:"/);
  assert.match(planErrors(step(1, { covers: 'AC-1, AC-2', test: null })), /Step 1: missing "- Test:"/);
});

test('coverage rules', () => {
  assert.match(planErrors(step(1, { covers: 'AC-1, AC-2, AC-9' })), /not in the spec/);
  assert.ok(planErrors(step(1, { covers: 'AC-1' })).includes('AC-2 is not covered by any step'));
});

test('Test: none rules', () => {
  assert.match(planErrors(step(1, { covers: 'AC-1, AC-2', test: 'none (config)' })), /needs a real test/);
  const ok = `${step(1, { covers: 'none', test: 'none (adds dependency)' })}\n${step(2, { covers: 'AC-1, AC-2' })}`;
  assert.equal(planErrors(ok), '');
});

test('Depends on must name earlier steps', () => {
  const s = step(1, { covers: 'AC-1, AC-2', extra: '- Depends on: Step 2\n' });
  assert.match(planErrors(s), /not an earlier step/);
});

test('field keys are case-insensitive and fences are ignored', () => {
  const lower = '### Step 1: Do it\n- covers: AC-1, AC-2\n- files: `a.js`\n- test: `a.test.js`\n';
  assert.equal(planErrors(lower), '');
  const fenced = `${step(1, { covers: 'AC-1' })}\n\`\`\`\n### Step 2: Fake\n- Covers: AC-2\n\`\`\`\n`;
  const plan = parsePlan(planText({ steps: fenced }));
  assert.equal(plan.steps.length, 1);
  assert.ok(checkPlan(spec2, plan).includes('AC-2 is not covered by any step'));
});

test('plan tolerates CRLF and BOM', () => {
  const text = '\uFEFF' + planText().replace(/\n/g, '\r\n');
  assert.deepEqual(checkPlan(spec2, parsePlan(text)), []);
});

const CONTRACT_PLAN = `# Plan: HC-142 Export appointments to CSV

Spec: .delivery/HC-142/spec.md (approved by Ahsan Shah on 2026-10-10)

## Steps

### Step 1: CSV serializer for appointments
- Covers: AC-2, AC-5
- Files: \`api/services/csv_export.py (new)\`
- Test: \`api/tests/test_csv_export.py::test_columns_and_escaping\` — header row
- Depends on: none
`;
const CONTRACT_LOG = `# Build log: HC-142

## Step 1: CSV serializer for appointments
- Status: DONE
- Commit: 3f9c2ab
- RED: \`pytest api/tests/test_csv_export.py\` — 2 failed (ImportError: csv_export)
- GREEN: \`pytest api/tests/test_csv_export.py\` — 2 passed
- Attempts: 1
`;
const plan2 = parsePlan(planText());
const buildErrors = (overrides, text) => checkBuild(plan2, parseBuildLog(text ?? buildLogText(plan2, overrides))).join('\n');

test('contract build-log template passes against its plan', () => {
  const log = parseBuildLog(CONTRACT_LOG);
  assert.equal(log.steps[0].status, 'DONE');
  assert.equal(log.steps[0].attempts, 1);
  assert.deepEqual(checkBuild(parsePlan(CONTRACT_PLAN), log), []);
});

test('valid build log passes; missing step entry fails', () => {
  assert.equal(buildErrors({}), '');
  const one = buildLogText(parsePlan(planText({ steps: '### Step 1: Implement AC-1\n- Covers: AC-1, AC-2\n- Files: `a.js`\n- Test: `a.test.js`\n' })));
  assert.ok(checkBuild(plan2, parseBuildLog(one)).includes('Step 2: no entry in build log'));
});

test('status, commit, GREEN and RED rules', () => {
  assert.match(buildErrors({ 1: { Status: 'BLOCKED' } }), /not DONE/);
  assert.match(buildErrors({ 1: { Commit: 'abc' } }), /commit SHA/);
  assert.match(buildErrors({ 1: { Commit: null } }), /commit SHA/);
  assert.match(buildErrors({ 1: { GREEN: null } }), /GREEN/);
  assert.match(buildErrors({ 1: { RED: null } }), /RED/);
  const noTest = planText({ steps: '### Step 1: Dep\n- Covers: none\n- Files: `package.json`\n- Test: none (adds dependency)\n' });
  const p = parsePlan(noTest);
  assert.deepEqual(checkBuild(p, parseBuildLog(buildLogText(p, { 1: { RED: null } }))), []);
});

test('unknown and duplicate steps', () => {
  const extra = `${buildLogText(plan2)}\n## Step 9: Ghost\n- Status: DONE\n`;
  assert.match(buildErrors({}, extra), /not in the plan/);
  const dupe = `${buildLogText(plan2)}\n## Step 1: Again\n- Status: DONE\n`;
  assert.match(buildErrors({}, dupe), /more than once/);
});

test('build log keys are case-insensitive; CRLF and BOM accepted', () => {
  const lower = buildLogText(plan2).replace(/^- Status:/gm, '- status:').replace(/^- GREEN:/gm, '- green:');
  assert.equal(buildErrors({}, lower), '');
  const crlf = '\uFEFF' + buildLogText(plan2).replace(/\n/g, '\r\n');
  assert.equal(buildErrors({}, crlf), '');
});

const CONTRACT_REPORT = `# Verify report: HC-142

Status: PASS
Attempts: 1
Commit: 9e05129

## Checks

| Check | Command | Result | Notes |
|---|---|---|---|
| tests | \`npm test\` | PASS | 56 passed |
| lint | \`npm run lint\` | PASS | |
| types | \`npx tsc --noEmit\` | PASS | |
| build | \`npm run build\` | PASS | |
| dependency audit | \`npm audit --audit-level=high\` | PASS | 0 high |
| secret scan | \`node "<plugin>/scripts/secret-scan.mjs" --base main\` | PASS | clean |
| coverage | \`npm run coverage\` | SKIP | no coverage command in CLAUDE.md |

## Acceptance criteria evidence

| AC | Evidence | Result |
|---|---|---|
| AC-1 | \`api/tests/test_export_endpoint.py::test_export_respects_filters\` passed | PASS |
`;
const vSpec1 = parseSpec(specText({ acs: ['AC-1'] }));
const vSpec2 = parseSpec(specText());
const verifyErrors = (opts, spec = vSpec2, text) => checkVerify(spec, parseVerifyReport(text ?? verifyReportText(spec, opts))).errors.join('\n');

test('contract verify-report template passes against its spec', () => {
  const report = parseVerifyReport(CONTRACT_REPORT);
  assert.equal(report.status, 'PASS');
  assert.equal(report.attempts, 1);
  assert.equal(report.commit, '9e05129');
  assert.equal(report.checks.length, 7);
  assert.equal(report.checks[0].name, 'tests');
  assert.deepEqual(checkVerify(vSpec1, report), { errors: [], outcome: 'PASS' });
});

test('valid verify report passes', () => {
  assert.equal(verifyErrors({}), '');
});

test('backticked Commit value is accepted', () => {
  assert.equal(verifyErrors({ commit: '`9e05129`' }), '');
});

test('required checks: missing and duplicate', () => {
  for (const name of ['tests', 'lint', 'types', 'build', 'dependency audit', 'secret scan', 'coverage']) {
    assert.ok(verifyErrors({ checks: { [name]: null } }).includes(`missing check "${name}"`), name);
  }
  const dupe = verifyReportText(vSpec2).replace('| lint |', '| lint | `x` | PASS | |\n| lint |');
  assert.match(verifyErrors({}, vSpec2, dupe), /more than once/);
});

test('SKIP rules and commands', () => {
  assert.match(verifyErrors({ checks: { tests: { result: 'SKIP', notes: 'no' } } }), /can never be skipped/);
  assert.match(verifyErrors({ checks: { 'secret scan': { result: 'SKIP', notes: 'no' } } }), /can never be skipped/);
  assert.match(verifyErrors({ checks: { lint: { result: 'SKIP' } } }), /needs a reason/);
  assert.equal(verifyErrors({ checks: { lint: { result: 'SKIP', notes: 'no linter', command: '' } } }), '');
  assert.match(verifyErrors({ checks: { lint: { command: '' } } }), /missing command/);
});

test('acceptance criteria evidence rules', () => {
  assert.ok(verifyErrors({ evidence: ['| AC-1 | `t` passed | PASS |'] }).includes('AC-2: no evidence row'));
  assert.match(verifyErrors({ evidence: ['| AC-1 |  | PASS |', '| AC-2 | `t` | PASS |'] }), /evidence is empty/);
  assert.match(verifyErrors({ evidence: ['| AC-1 | `t` | PASS |', '| AC-2 | `t` | PASS |', '| AC-9 | `t` | PASS |'] }), /not in the spec/);
});

test('Status must agree with the rows', () => {
  assert.match(verifyErrors({ checks: { lint: { result: 'FAIL' } } }), /says Status: PASS but/);
  assert.match(verifyErrors({ status: 'FAIL' }), /says Status: FAIL but/);
});

test('missing Status, Attempts and Commit', () => {
  assert.match(verifyErrors({ status: '' }), /Status: PASS/);
  assert.match(verifyErrors({ attempts: null }), /Attempts/);
  assert.match(verifyErrors({ commit: '' }), /Commit/);
});

test('consistent FAIL report has no errors and outcome FAIL', () => {
  const report = parseVerifyReport(verifyReportText(vSpec2, { status: 'FAIL', attempts: 2, checks: { tests: { result: 'FAIL' } } }));
  assert.deepEqual(checkVerify(vSpec2, report), { errors: [], outcome: 'FAIL' });
});

test('escaped pipes, alignment separators, BOM and CRLF', () => {
  const piped = verifyReportText(vSpec2).replace('`run tests`', '`a \\| b`');
  assert.equal(parseVerifyReport(piped).checks[0].command, '`a | b`');
  const aligned = verifyReportText(vSpec2).replace('|---|---|---|---|', '|:---:|:---|---:|---|');
  assert.equal(verifyErrors({}, vSpec2, aligned), '');
  assert.equal(parseVerifyReport(aligned).checks.length, 7);
  const crlf = '\uFEFF' + verifyReportText(vSpec2).replace(/\n/g, '\r\n');
  assert.equal(verifyErrors({}, vSpec2, crlf), '');
});

test('build-log title must match the current plan step title (stale build after replan)', () => {
  const stale = buildLogText(plan2).replace('## Step 2: Implement AC-2', '## Step 2: Old title from the previous plan');
  assert.ok(buildErrors({}, stale).includes('Step 2: build-log title "Old title from the previous plan" does not match plan step title "Implement AC-2"'));
  const padded = buildLogText(plan2).replace('## Step 1: Implement AC-1', '## Step 1:   Implement AC-1   ');
  assert.equal(buildErrors({}, padded), '');
});

test('evidence AC cell may be bold or backticked', () => {
  const bold = verifyReportText(vSpec2).replace('| AC-1 |', '| **AC-1** |').replace('| AC-2 |', '| `AC-2` |');
  const report = parseVerifyReport(bold);
  assert.deepEqual(report.evidence.map((e) => e.ac), ['AC-1', 'AC-2']);
  assert.equal(verifyErrors({}, vSpec2, bold), '');
});

test('a plan with a "## Gate result" section from a failed /plan run fails check-plan', () => {
  const failed = `${planText()}\n## Gate result\n\nFAIL: planner blocked (spec contradicts itself).\n`;
  assert.ok(checkPlan(spec2, parsePlan(failed)).some((e) => /Gate result/.test(e)));
  const stub = '# Plan: HC-142\n\n## Gate result\n\nFAIL: planner blocked.\n';
  assert.ok(checkPlan(spec2, parsePlan(stub)).some((e) => /Gate result/.test(e)));
});

// --- review.md and pr-description.md ---
const spec1 = parseSpec(specText({ acs: ['AC-1'] }));
const reviewErrors = (text) => checkReview(parseReview(text));
const prErrors = (text, spec = spec2) => checkPrDescription(spec, parsePrDescription(text));

test('contract templates pass as given', () => {
  assert.deepEqual(reviewErrors(reviewText()), []);
  const template = `# Export appointments to CSV (HC-142)

Closes: https://jira.example.com/browse/HC-142

## Summary

Admins can export the filtered appointments list as CSV.

## Acceptance criteria

| AC | Evidence |
|---|---|
| AC-1 | \`api/tests/test_export_endpoint.py::test_export_respects_filters\` passed |

## Test plan

- \`npm test\`: 56 passed

## Risks

None.

## Notes for CLAUDE.md

None.
`;
  assert.deepEqual(prErrors(template, spec1), []);
  assert.deepEqual(prErrors(prDescriptionText(spec2)), []);
});

test('review preamble lines are each required', () => {
  assert.ok(reviewErrors(reviewText({ commit: null })).some((e) => /Commit/.test(e)));
  assert.ok(reviewErrors(reviewText({ status: null })).some((e) => /Status/.test(e)));
  assert.ok(reviewErrors(reviewText({ mode: null })).some((e) => /Mode/.test(e)));
  assert.ok(reviewErrors(reviewText({ mode: 'fleet' })).some((e) => /Mode/.test(e)));
});

test('review sections and verdicts', () => {
  const noSecurity = reviewText().replace('## Security review', '### Security review');
  assert.ok(reviewErrors(noSecurity).includes('missing section "## Security review"'));
  const noVerdict = reviewText({ security: 'None.' });
  assert.ok(reviewErrors(noVerdict).some((e) => /Security review: missing "Verdict/.test(e)));
  const oddVerdict = reviewText({ security: 'Verdict: MAYBE\n\nNone.' });
  assert.ok(reviewErrors(oddVerdict).some((e) => /Security review: missing "Verdict/.test(e)));
});

test('review verdict must agree with its findings and the status', () => {
  const passWithBlocking = reviewText({ code: 'Verdict: PASS\n\n- [blocking] a.js:1 — bad → fix' });
  assert.match(reviewErrors(passWithBlocking).join('\n'), /says PASS but has a blocking finding/);
  const blockingWithout = reviewText({ code: 'Verdict: BLOCKING\n\n- [non-blocking] a.js:1 — nit → fix' });
  assert.match(reviewErrors(blockingWithout).join('\n'), /says BLOCKING but/);
  const passStatusBlocked = reviewText({ code: 'Verdict: BLOCKING\n\n- [blocking] a.js:1 — bad → fix' });
  assert.match(reviewErrors(passStatusBlocked).join('\n'), /Status: PASS but a reviewer is BLOCKING/);
  assert.match(reviewErrors(reviewText({ status: 'FAIL' })).join('\n'), /Status: FAIL but both reviewers PASS/);
  const consistentFail = reviewText({ status: 'FAIL', code: 'Verdict: BLOCKING\n\n- [blocking] a.js:1 — bad → fix' });
  assert.match(reviewErrors(consistentFail).join('\n'), /review status is FAIL/);
});

test('"None." is an empty findings list and CRLF/BOM parse', () => {
  const review = parseReview(reviewText());
  assert.deepEqual(review.sections.get('Security review').findings, []);
  assert.equal(review.sections.get('Code review').findings[0].severity, 'non-blocking');
  assert.equal(review.commit, '9e05129');
  assert.deepEqual(reviewErrors('\uFEFF' + reviewText().replace(/\n/g, '\r\n')), []);
});

test('pr-description: title, Closes and sections are each required', () => {
  assert.ok(prErrors(prDescriptionText(spec2, { title: null })).some((e) => /# <title>/.test(e)));
  assert.ok(prErrors(prDescriptionText(spec2, { closes: null })).some((e) => /Closes/.test(e)));
  for (const name of ['Summary', 'Acceptance criteria', 'Test plan', 'Risks', 'Notes for CLAUDE.md']) {
    const text = prDescriptionText(spec2).replace(new RegExp(`^## ${name}$`, 'm'), '### gone');
    assert.ok(prErrors(text).includes(`missing section "## ${name}"`), name);
  }
});

test('pr-description: AC rows', () => {
  assert.ok(prErrors(prDescriptionText(spec2, { rows: ['| AC-1 | passed |'] })).includes('AC-2: no row in Acceptance criteria'));
  assert.ok(prErrors(prDescriptionText(spec2, { rows: ['| AC-1 | passed |', '| AC-2 |  |'] })).includes('AC-2: evidence is empty'));
  assert.ok(prErrors(prDescriptionText(spec2, { rows: ['| AC-1 | x |', '| AC-2 | x |', '| AC-9 | x |'] })).some((e) => /AC-9, which is not in the spec/.test(e)));
  assert.deepEqual(prErrors(prDescriptionText(spec2, { rows: ['| **AC-1** | ok |', '| `AC-2` | ok |'] })), []);
});

test('sameCommit compares by prefix, case-insensitively', () => {
  assert.equal(sameCommit('9e05129', '9e05129abcdef0123'), true);
  assert.equal(sameCommit('ABC1234', 'abc1234'), true);
  assert.equal(sameCommit('9e05129', '1111111'), false);
  assert.equal(sameCommit(null, '9e05129'), false);
});

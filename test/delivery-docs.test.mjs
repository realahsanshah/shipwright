import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, checkSpec, SPEC_SECTIONS, parsePlan, checkPlan, parseBuildLog, checkBuild } from '../scripts/lib/delivery-docs.mjs';
import { specText, planText, buildLogText } from './helpers/delivery-fixtures.mjs';

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

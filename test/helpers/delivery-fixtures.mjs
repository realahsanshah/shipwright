// Builders for valid delivery artifacts. Later tasks extend this file.
import { parseSpec } from '../../scripts/lib/delivery-docs.mjs';

export function specText({ approved = true, acs = ['AC-1', 'AC-2'], openQuestions = 'None.', extraSections = '' } = {}) {
  const status = approved ? 'Status: approved by Ahsan Shah on 2026-10-10' : 'Status: draft';
  return `# Spec: HC-142 Export appointments to CSV

${status}

## Summary
Admins can export appointments to CSV.

## Acceptance criteria
${acs.map((id) => `- ${id}: ${id} behaves as described`).join('\n')}

## Affected areas
- api/routes/appointments.py

## Data changes and migrations
None.

## Edge cases
- Empty result set.

## Test plan
- Unit and endpoint tests.

## Risks
- Large exports.

## Open questions
${openQuestions}
${extraSections}`;
}

// One step per AC with a valid Spec: line, unless `steps` supplies raw step Markdown.
export function planText({ spec = parseSpec(specText()), steps } = {}) {
  const body = steps ?? spec.acIds.map((id, i) => `### Step ${i + 1}: Implement ${id}
- Covers: ${id}
- Files: \`src/${id.toLowerCase()}.js (new)\`
- Test: \`test/${id.toLowerCase()}.test.js\` — ${id} behaves as described
- Depends on: ${i === 0 ? 'none' : `Step ${i}`}
`).join('\n');
  return `# Plan: HC-142 Export appointments to CSV

Spec: .delivery/HC-142/spec.md (approved by ${spec.approver} on ${spec.approvedOn})

## Steps

${body}`;
}

// A DONE entry per plan step; `overrides` maps step number to field overrides (null drops a field).
export function buildLogText(plan, overrides = {}) {
  const entries = plan.steps.map((s) => {
    const f = { Status: 'DONE', Commit: '3f9c2ab', RED: '`npm test` — 1 failed', GREEN: '`npm test` — 1 passed', Attempts: '1', ...(overrides[s.n] ?? {}) };
    const lines = Object.entries(f).filter(([, v]) => v !== null).map(([k, v]) => `- ${k}: ${v}`);
    return `## Step ${s.n}: ${s.title}\n${lines.join('\n')}\n`;
  });
  return `# Build log: HC-142\n\n${entries.join('\n')}`;
}

// A passing verify report. `checks` maps a check name to field overrides (null drops the row);
// `evidence` replaces the evidence rows when given (an array of raw table-row strings).
export function verifyReportText(spec, { status = 'PASS', attempts = 1, commit = '9e05129', checks = {}, evidence } = {}) {
  const names = ['tests', 'lint', 'types', 'build', 'dependency audit', 'secret scan', 'coverage'];
  const rows = names.filter((n) => checks[n] !== null).map((n) => {
    const c = { command: `\`run ${n}\``, result: 'PASS', notes: '', ...(checks[n] ?? {}) };
    return `| ${n} | ${c.command} | ${c.result} | ${c.notes} |`;
  });
  const ev = evidence ?? spec.acIds.map((id) => `| ${id} | \`test/${id.toLowerCase()}.test.js\` passed | PASS |`);
  const head = [status && `Status: ${status}`, attempts !== null && `Attempts: ${attempts}`, commit && `Commit: ${commit}`].filter(Boolean).join('\n');
  return `# Verify report: HC-142

${head}

## Checks

| Check | Command | Result | Notes |
|---|---|---|---|
${rows.join('\n')}

## Acceptance criteria evidence

| AC | Evidence | Result |
|---|---|---|
${ev.join('\n')}
`;
}

// A passing review.md. Preamble fields take null to drop the line; `code` and `security` replace the section bodies.
export function reviewText({ commit = '9e05129', status = 'PASS', mode = 'agents', code, security } = {}) {
  const head = [['Commit', commit], ['Status', status], ['Mode', mode]]
    .filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `# Review: HC-142

${head}

## Code review

${code ?? `Verdict: PASS

- [non-blocking] api/routes/appointments.py:42 — \`rows2\` is unclear → rename to \`filtered_rows\``}

## Security review

${security ?? `Verdict: PASS

None.`}
`;
}

// A valid pr-description.md with one evidence row per spec AC. `rows` replaces the table rows (raw strings).
export function prDescriptionText(spec, { title = '# Export appointments to CSV (HC-142)', closes = 'Closes: https://jira.example.com/browse/HC-142', rows } = {}) {
  const table = rows ?? spec.acIds.map((id) => `| ${id} | \`test/${id.toLowerCase()}.test.js\` passed |`);
  return `${title ? `${title}\n\n` : ''}${closes ? `${closes}\n\n` : ''}## Summary

Admins can export the filtered appointments list as CSV.

## Acceptance criteria

| AC | Evidence |
|---|---|
${table.join('\n')}

## Test plan

- \`npm test\`: 56 passed

## Risks

None.

## Notes for CLAUDE.md

None.
`;
}

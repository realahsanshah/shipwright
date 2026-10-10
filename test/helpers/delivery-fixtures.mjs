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

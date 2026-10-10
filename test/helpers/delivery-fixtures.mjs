// Builders for valid delivery artifacts. Later tasks extend this file.

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

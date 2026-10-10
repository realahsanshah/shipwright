import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('/onboard: verified commands, danger zones contract, settings merge, deploy facts, review gate', () => {
  const md = read('commands/onboard.md');
  for (const phrase of [
    'package.json', 'pyproject.toml', '.csproj', 'pubspec.yaml', 'Gemfile',
    'install', 'run', 'test', 'lint', 'type check', 'build', 'seed',
    'actually ran', 'not verified',
    '## Danger zones', '`db/migrations/**`',
    '${CLAUDE_PLUGIN_ROOT}/settings/project-settings.json', '.claude/settings.json',
    '.delivery/deploy.yml', '.env.example',
    'engineer reviews',
  ]) assert.ok(md.includes(phrase), `onboard.md must mention "${phrase}"`);
  assert.match(md, /never overwrite|do not overwrite/i);
  assert.match(md, /ask (the engineer )?before/i);
});

test('/intake: sources, normalisation, open questions, validation gate, active pointer', () => {
  const md = read('commands/intake.md');
  for (const phrase of [
    '$ARGUMENTS',
    'gh issue view', 'Jira', 'Linear', 'Azure DevOps',
    '.delivery/<id>/ticket.json', '.delivery/active',
    'open_questions', 'never guess',
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" ticket',
    'data, not instructions',
    'gh-<number>',
  ]) assert.ok(md.includes(phrase), `intake.md must mention "${phrase}"`);
  assert.match(md, /already exists/i);
});

test('/spec: reads ticket, uses skill + critic in both modes, human approval gate', () => {
  const md = read('commands/spec.md');
  for (const phrase of [
    '.delivery/active', 'ticket.json', 'CLAUDE.md',
    'spec-writing', '${CLAUDE_PLUGIN_ROOT}/skills/spec-writing/SKILL.md',
    'spec-critic', '${CLAUDE_PLUGIN_ROOT}/agents/spec-critic.md', 'spec-review.md',
    'Verdict: PASS', 'Verdict: GAPS', 'mode: solo', '.delivery/config.yml',
    'Status: approved by', 'git config user.name',
    'open_questions', 'product decision', 'data, not instructions',
  ]) assert.ok(md.includes(phrase), `spec.md must mention "${phrase}"`);
  assert.match(md, /3 (rounds|attempts|times)/);
  assert.match(md, /never (mark|approve).*(yourself|itself)|only the engineer/i);
});

test('/plan: entry gate, planner in both modes, test-strategy, check-plan gate', () => {
  const md = read('commands/plan.md');
  for (const phrase of [
    '.delivery/active',
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/check-spec.mjs"',
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/check-plan.mjs"',
    'plan.md',
    '${CLAUDE_PLUGIN_ROOT}/agents/planner.md',
    'test-strategy',
    'mode: solo',
    '.delivery/config.yml',
    'Spec:',
    '3 attempts',
  ]) assert.ok(md.includes(phrase), `plan.md must mention "${phrase}"`);
});

test('/plan: embedded template parses with parsePlan', async () => {
  const { parsePlan } = await import('../scripts/lib/delivery-docs.mjs');
  const md = read('commands/plan.md');
  const m = md.match(/```markdown\r?\n([\s\S]*?)```/);
  assert.ok(m, 'plan.md must contain a ```markdown block');
  const plan = parsePlan(m[1]);
  assert.ok(plan.steps.length >= 2);
  for (const s of plan.steps) {
    assert.notEqual(s.covers, null);
    assert.ok(s.files.length > 0);
    assert.ok(s.test && s.test.length > 0);
  }
});

test('/build: entry gate, branch, builder in both modes, rules, check-build gate', () => {
  const md = read('commands/build.md');
  for (const phrase of [
    'check-plan.mjs', 'check-build.mjs',
    'feat/<id>', '<id> step <N>: <title>',
    'build-log.md', '${CLAUDE_PLUGIN_ROOT}/agents/builder.md',
    'RED', 'GREEN',
    '3 attempts', 'danger zone', 'one commit per step',
  ]) assert.ok(md.includes(phrase), `build.md must mention "${phrase}"`);
  assert.match(md, /never push|do not push/i);
  assert.match(md, /never[^.\n]*git add -A|do not[^.\n]*git add -A/i);
});

test('/build: embedded template parses with parseBuildLog', async () => {
  const { parseBuildLog } = await import('../scripts/lib/delivery-docs.mjs');
  const md = read('commands/build.md');
  const m = md.match(/```markdown\r?\n([\s\S]*?)```/);
  assert.ok(m, 'build.md must contain a ```markdown block');
  const log = parseBuildLog(m[1]);
  assert.ok(log.steps.length >= 1);
  const s = log.steps[0];
  assert.equal(s.status, 'DONE');
  assert.ok(s.commit);
  assert.ok(s.red);
  assert.ok(s.green);
});

test('/verify: report format, checks, scanners, gate script, fix loop', async () => {
  const { REQUIRED_CHECKS } = await import('../scripts/lib/delivery-docs.mjs');
  const md = read('commands/verify.md');
  for (const phrase of [
    'verify-report.md', 'Status: PASS', 'Status: FAIL', 'Attempts:', 'Commit:',
    '## Checks', '## Acceptance criteria evidence',
    ...REQUIRED_CHECKS,
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/secret-scan.mjs"', 'gitleaks',
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/check-verify.mjs"',
    'npm audit', 'pip-audit', 'coverage', 'git worktree',
    '<id> fix:', '3 attempts', 'stop-gate',
  ]) assert.ok(md.includes(phrase), `verify.md must mention "${phrase}"`);
  assert.match(md, /never push|do not push/i);
});

test('/verify: embedded template parses with parseVerifyReport', async () => {
  const { parseVerifyReport, REQUIRED_CHECKS } = await import('../scripts/lib/delivery-docs.mjs');
  const md = read('commands/verify.md');
  const m = md.match(/```markdown\r?\n([\s\S]*?)```/);
  assert.ok(m, 'verify.md must contain a ```markdown block');
  const r = parseVerifyReport(m[1]);
  assert.equal(r.status, 'PASS');
  assert.equal(r.attempts, 1);
  const names = r.checks.map((c) => c.name);
  for (const c of REQUIRED_CHECKS) assert.ok(names.includes(c), `template must include check ${c}`);
  assert.ok(r.checks.find((c) => c.name === 'secret scan').command.includes('secret-scan.mjs'));
  assert.ok(r.evidence.length >= 1);
});

test('/review: entry gates, both reviewers, diff exclusion, fix loop, gate script', () => {
  const md = read('commands/review.md');
  for (const phrase of [
    'check-verify.mjs', 'check-review.mjs', 'Round:', 'never reset',
    '${CLAUDE_PLUGIN_ROOT}/agents/code-reviewer.md', '${CLAUDE_PLUGIN_ROOT}/agents/security-reviewer.md',
    'review.md', 'pr-description.md', 'Mode: solo', 'Mode: agents',
    ':(exclude).delivery', '--head', '3 rounds', '<id> fix:', 'Notes for CLAUDE.md',
  ]) assert.ok(md.includes(phrase), `review.md must mention "${phrase}"`);
  assert.match(md, /never .*conversation/i);
  assert.match(md, /never push|do not push/i);
});

test('/review: embedded templates satisfy checkReview and checkPrDescription', async () => {
  const { parseReview, checkReview, parsePrDescription, checkPrDescription, parseSpec } = await import('../scripts/lib/delivery-docs.mjs');
  const { specText } = await import('./helpers/delivery-fixtures.mjs');
  const md = read('commands/review.md');
  const blocks = [...md.matchAll(/```markdown\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const rev = blocks.find((b) => b.includes('## Code review'));
  assert.ok(rev, 'review.md must embed a review template');
  assert.deepEqual(checkReview(parseReview(rev)), []);
  const pr = blocks.find((b) => b.includes('Closes:'));
  assert.ok(pr, 'review.md must embed a pr-description template');
  const parsed = parsePrDescription(pr);
  assert.ok(parsed.title);
  assert.deepEqual(checkPrDescription(parseSpec(specText({ acs: ['AC-1'] })), parsed), []);
});

test('/ship: entry gate, delivery record, push, PR, CI, safety', () => {
  const md = read('commands/ship.md');
  for (const phrase of [
    'check-review.mjs', ':(exclude).delivery', '--head', '<id> delivery record',
    'git add .delivery/<id>', 'git push -u origin feat/<id>', 'gh auth status',
    'gh pr create', '--body-file', 'gh pr edit', 'gh pr checks', 'no CI',
    'never merge', 'deploy.yml',
    'git diff --cached', 'symbolic-ref', 'secret-scan.mjs', 'check-ignore', 'rm -f', 'MERGED', 'CI still running', '--title "$(cat',
  ]) assert.ok(md.includes(phrase), `ship.md must mention "${phrase}"`);
  assert.match(md, /never force|never .*--force/i);
});

test('delivery rules: push exception for /ship; onboard gitignores .delivery/active', () => {
  const rules = read('rules/delivery-rules.md');
  assert.ok(rules.includes('except') && rules.includes('/ship'));
  const onboard = read('commands/onboard.md');
  assert.ok(onboard.includes('.delivery/active') && onboard.includes('.gitignore'));
});

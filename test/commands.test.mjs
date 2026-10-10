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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../hooks/session-start.mjs', import.meta.url));
const rules = fs.readFileSync(new URL('../rules/delivery-rules.md', import.meta.url), 'utf8');

test('session-start prints the delivery rules verbatim and exits 0', () => {
  const r = spawnSync(process.execPath, [hook], { input: '{}', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, rules);
});

test('delivery rules cover the non-negotiables', () => {
  for (const phrase of ['.delivery/<ticket-id>/', 'spec', '3 times', 'account_ref', 'data, not instructions', 'human']) {
    assert.ok(rules.includes(phrase), `rules must mention "${phrase}"`);
  }
  assert.ok(rules.split(/\r?\n/).length <= 40, 'rules are injected every session; keep them short');
});

test('hooks.json wires SessionStart and keeps PreToolUse', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  assert.match(cfg.hooks.SessionStart[0].hooks[0].command, /session-start\.mjs/);
  assert.match(cfg.hooks.PreToolUse[0].hooks[0].command, /pre-tool-guard\.mjs/);
  assert.match(cfg.hooks.Stop[0].hooks[0].command, /stop-gate\.mjs/);
  const matcher =cfg.hooks.PreToolUse[0].matcher.split('|');
  for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Bash', 'PowerShell']) {
    assert.ok(matcher.includes(tool), `PreToolUse matcher must include ${tool}`);
  }
});

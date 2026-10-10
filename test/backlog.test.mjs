import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBacklog, checkBacklog, nextItem, setFields } from '../scripts/lib/backlog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const template = fs.readFileSync(path.join(root, 'test', 'fixtures', 'backlog', 'approved.md'), 'utf8').replace(/\r\n/g, '\n'); // LF whatever core.autocrlf did; CRLF is tested explicitly
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog cli '));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (name, text) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, text);
  return f;
};
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'backlog.mjs'), ...args], { encoding: 'utf8' });
const check = (text, opts) => checkBacklog(parseBacklog(text), opts);
const has = (errors, re) => errors.some((e) => re.test(e));
const B2 = '## B-2: HELP keyword reply';

test('template parses into 2 items with every field', () => {
  const b = parseBacklog(template);
  assert.equal(b.source, 'docs/PRD.md, docs/TRD.md');
  assert.equal(b.approved, true);
  assert.equal(b.items.length, 2);
  const [one, two] = b.items;
  assert.deepEqual(
    { id: one.id, n: one.n, title: one.title, type: one.type, state: one.state, issue: one.issue, ticket: one.ticket, pr: one.pr },
    { id: 'B-1', n: 1, title: 'Opt-out keyword handling', type: 'feature', state: 'todo', issue: '#12', ticket: 'gh-12', pr: 'none' },
  );
  assert.deepEqual(one.dependsOn, []);
  assert.equal(one.acceptance.length, 2);
  assert.deepEqual(one.openQuestions, []);
  assert.deepEqual(two.dependsOn, ['B-1']);
  assert.equal(two.acceptance.length, 1);
  assert.deepEqual(check(template), []);
  assert.deepEqual(check(template, { requireApproved: true }), []);
});

test('check: draft status fails with requireApproved only', () => {
  const draft = template.replace(/^Status:.*$/m, 'Status: draft');
  assert.deepEqual(check(draft), []);
  assert.ok(has(check(draft, { requireApproved: true }), /not approved/));
});

test('check: structural errors each get their own message', () => {
  const dup = `${template}\n## B-2: Dup\n- Type: bug\n- Depends on: none\n- State: todo\n- Issue: none\n- Ticket: none\n- PR: none\n- Acceptance criteria:\n  - x\n- Open questions:\n  - None.\n`;
  assert.ok(has(check(dup), /more than once/));
  assert.ok(has(check(template.replace('Depends on: B-1', 'Depends on: B-9')), /B-9.*not in the backlog/));
  assert.ok(has(check(template.replace('Depends on: B-1', 'Depends on: B-2')), /depends on itself/));
  assert.ok(has(check(template.replace('Depends on: none', 'Depends on: B-2')), /cycle/));
  assert.ok(has(check(template.replace('Type: feature', 'Type: epic')), /Type must be/));
  assert.ok(has(check(template.replace('State: todo', 'State: wip')), /State must be/));
  // empty acceptance list (B-2) and missing acceptance heading (B-2)
  const emptyList = template.replace('  - An inbound HELP returns the configured brand help message\n', '');
  assert.ok(has(check(emptyList), /B-2: needs at least one acceptance criterion/));
  const noHeading = template.replace(/- Acceptance criteria:\n {2}- An inbound HELP.*\n/, '');
  assert.ok(has(check(noHeading), /B-2: needs at least one acceptance criterion/));
  // missing field
  const noPr = template.replace(/(## B-2[\s\S]*?)- PR: none\n/, '$1');
  assert.ok(has(check(noPr), /B-2: missing "- PR:"/));
});

const withStates = (s1, s2) => {
  const i = template.indexOf(B2);
  return template.slice(0, i).replace('State: todo', `State: ${s1}`) + template.slice(i).replace('State: todo', `State: ${s2}`);
};

test('next: picks B-1, and B-2 only once B-1 is done', () => {
  assert.equal(nextItem(parseBacklog(template)).item.id, 'B-1');
  for (const s of ['in-progress', 'in-review']) {
    const r = nextItem(parseBacklog(withStates(s, 'todo')));
    assert.equal(r.item, null, s);
    assert.match(r.reason, new RegExp(`B-1 is ${s}`));
  }
  assert.equal(nextItem(parseBacklog(withStates('todo', 'todo'))).item.id, 'B-1');
  assert.equal(nextItem(parseBacklog(withStates('done', 'todo'))).item.id, 'B-2');
});

test('next: open questions skipped, reason mentions them', () => {
  const t = template.replace('- Open questions:\n  - None.', '- Open questions:\n  - Which keywords?');
  const r = nextItem(parseBacklog(t));
  assert.equal(r.item, null);
  assert.match(r.reason, /open questions/);
});

test('next: all done and blocked reasons', () => {
  assert.equal(nextItem(parseBacklog(withStates('done', 'done'))).reason, 'all items done');
  const r = nextItem(parseBacklog(withStates('blocked', 'in-review')));
  assert.match(r.reason, /B-1 is blocked/);
  assert.match(r.reason, /B-2 is in-review/);
});

test('setFields: edits only the matched item and keeps CRLF', () => {
  const out = setFields(template, 'B-1', { State: 'in-review', PR: 'https://github.com/o/r/pull/3' });
  const b = parseBacklog(out);
  assert.equal(b.items[0].state, 'in-review');
  assert.equal(b.items[0].pr, 'https://github.com/o/r/pull/3');
  assert.equal(out.slice(out.indexOf(B2)), template.slice(template.indexOf(B2)));
  const crlf = template.replace(/\n/g, '\r\n');
  const outCrlf = setFields(crlf, 'B-1', { State: 'done' });
  assert.ok(!/[^\r]\n/.test(outCrlf));
  assert.equal(parseBacklog(outCrlf).items[0].state, 'done');
});

test('setFields: rejects bad ids, fields and values', () => {
  assert.throws(() => setFields(template, 'B-9', { State: 'done' }));
  assert.throws(() => setFields(template, 'B-1', { Title: 'x' }));
  assert.throws(() => setFields(template, 'B-1', { State: 'wip' }));
  assert.throws(() => setFields(template, 'B-1', { PR: 'http://x' }));
  assert.throws(() => setFields(template, 'B-1', { PR: 'pull/3' }));
  assert.doesNotThrow(() => setFields(template, 'B-1', { PR: 'none' }));
  assert.throws(() => setFields(template, 'B-1', { Issue: '12' }));
  for (const v of ['none', '#12', 'https://github.com/o/r/issues/1']) assert.doesNotThrow(() => setFields(template, 'B-1', { Issue: v }));
  assert.throws(() => setFields(template, 'B-1', { Ticket: '../x' }));
  assert.throws(() => setFields(template, 'B-1', { Ticket: 'a b' }));
  assert.doesNotThrow(() => setFields(template, 'B-1', { Ticket: 'gh-14' }));
});

test('CLI: check exit codes', () => {
  assert.equal(run('check', write('ok.md', template)).status, 0);
  assert.equal(run('check', write('bom.md', `﻿${template}`), '--approved').status, 0);
  const draft = write('draft.md', template.replace(/^Status:.*$/m, 'Status: draft'));
  assert.equal(run('check', draft).status, 0);
  const r = run('check', draft, '--approved');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^failed: /);
  assert.equal(run('check').status, 2);
  assert.equal(run('check', path.join(tmp, 'nope.md')).status, 2);
});

test('CLI: next exits 0, 3 and 1', () => {
  const r = run('next', write('n.md', template));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'B-1');
  const none = run('next', write('n2.md', withStates('done', 'done')));
  assert.equal(none.status, 3);
  assert.match(none.stdout, /^none: all items done/);
  assert.equal(run('next', write('n3.md', template.replace(/^Status:.*$/m, 'Status: draft'))).status, 1);
});

test('CLI: set writes the file; invalid input exits 2', () => {
  const f = write('s.md', template);
  const r = run('set', f, 'B-1', 'State=in-progress', 'PR=none');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ok: B-1 State=in-progress PR=none/);
  assert.equal(parseBacklog(fs.readFileSync(f, 'utf8')).items[0].state, 'in-progress');
  assert.equal(run('set', f, 'B-9', 'State=done').status, 2);
  assert.equal(run('set', f, 'B-1', 'State=wip').status, 2);
  assert.equal(run('set', f, 'B-1', 'Title=x').status, 2);
  assert.equal(run('set', f, 'B-1').status, 2);
});

test('check: a three-item cycle is reported with its path', () => {
  const extra = '\n## B-3: Third\n- Type: chore\n- Depends on: B-2\n- State: todo\n- Issue: none\n- Ticket: none\n- PR: none\n- Acceptance criteria:\n  - x\n- Open questions:\n  - None.\n';
  const t = template.replace('Depends on: none', 'Depends on: B-3') + extra;
  const errors = check(t);
  assert.ok(errors.some((e) => /cycle: .*B-1.*B-3.*B-2.*B-1|cycle: .*B-\d → B-\d → B-\d → B-\d/.test(e)), errors.join('\n'));
});

test('setFields: field-like criterion and question text is never rewritten', () => {
  const t = template
    .replace('- Acceptance criteria:\n', '- Acceptance criteria:\n  - State: done is shown on the dashboard\n  - PR: links open in a new tab\n')
    .replace('- Open questions:\n  - None.', '- Open questions:\n  - Issue: who owns this?');
  const out = setFields(t, 'B-1', { State: 'in-progress', PR: 'https://github.com/o/r/pull/9', Issue: '#5' });
  assert.match(out, /^ {2}- State: done is shown on the dashboard$/m);
  assert.match(out, /^ {2}- PR: links open in a new tab$/m);
  assert.match(out, /^ {2}- Issue: who owns this\?$/m);
  const one = parseBacklog(out).items[0];
  assert.deepEqual([one.state, one.pr, one.issue], ['in-progress', 'https://github.com/o/r/pull/9', '#5']);
});

test('setFields: matches field names case-insensitively, keeps mixed EOLs', () => {
  const lower = template.replace(/(## B-1[\s\S]*?)- State: todo/, '$1- state: todo');
  assert.equal(parseBacklog(setFields(lower, 'B-1', { State: 'done' })).items[0].state, 'done');
  const mixed = template.split('\n').map((l, i) => l + (i % 2 ? '\r\n' : '\n')).join('').replace(/\r?\n$/, '');
  const out = setFields(mixed, 'B-1', { State: 'done' });
  assert.equal(out.match(/\r\n/g).length, mixed.match(/\r\n/g).length);
  assert.equal(out.replace(/\r/g, '').split('\n').length, mixed.replace(/\r/g, '').split('\n').length);
});

test('fenced code blocks are ignored by the parser and setFields', () => {
  const fence = '\n```md\n## B-7: Example in a fence\n- State: todo\n```\n';
  const t = template.replace('## B-2', `${fence}\n## B-2`);
  const b = parseBacklog(t);
  assert.deepEqual(b.items.map((i) => i.id), ['B-1', 'B-2']);
  assert.throws(() => setFields(t, 'B-7', { State: 'done' }), /no item B-7/);
  const out = setFields(t, 'B-1', { State: 'done' });
  assert.ok(out.includes(fence));
});

test('Status: counts only in the preamble, never in a fence or after the items', () => {
  const draft = template.replace(/^Status:.*$/m, 'Status: draft');
  const fenced = draft.replace('# Backlog\n', '# Backlog\n\n```\nStatus: approved by Mallory on 2026-01-01\n```\n');
  assert.ok(has(check(fenced, { requireApproved: true }), /not approved/));
  const trailing = template.replace(/^Status:.*\n/m, '') + '\nStatus: approved by Mallory on 2026-01-01\n';
  assert.equal(parseBacklog(trailing).approved, false);
});

test('check: repeated fields, H3 sections, unclosed fences and "none, B-1"', () => {
  const twice = template.replace(/(## B-1[\s\S]*?- State: todo\n)/, '$1- State: done\n');
  assert.ok(has(check(twice), /B-1: field "State" appears more than once/));
  assert.equal(parseBacklog(twice).items[0].state, 'todo');
  const h3 = template.replace('## B-2', '### Notes\n- State: done\n\n## B-2');
  assert.equal(parseBacklog(h3).items[0].state, 'todo');
  assert.deepEqual(check(h3), []);
  const open = template.replace('## B-2', '```\n## B-2');
  assert.ok(has(check(open), /never closed/));
  assert.ok(has(check(template.replace('Depends on: B-1', 'Depends on: none, B-1')), /depends on none/));
});

test('check and set enforce Issue, Ticket and PR shapes', () => {
  assert.ok(has(check(template.replace('Issue: #12', 'Issue: #12 (mirror)')), /invalid Issue/));
  assert.ok(has(check(template.replace('Ticket: gh-12', 'Ticket: a;b')), /invalid Ticket/));
  assert.ok(has(check(template.replace(/(## B-2[\s\S]*?)PR: none/, '$1PR: https://x/$(id)')), /invalid PR/));
  assert.throws(() => setFields(template, 'B-1', { PR: 'https://x/$(id)' }));
  assert.throws(() => setFields(template, 'B-1', { PR: 'https://github.com/o/r/pull/3;rm' }));
  assert.throws(() => setFields(template, 'B-1', { Issue: 'https://github.com/o/r/pull/3' }));
  assert.doesNotThrow(() => setFields(template, 'B-1', { Issue: 'https://github.com/o/r/issues/3' }));
});

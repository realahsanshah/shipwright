import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, checkSpec, SPEC_SECTIONS } from '../scripts/lib/delivery-docs.mjs';
import { specText } from './helpers/delivery-fixtures.mjs';

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

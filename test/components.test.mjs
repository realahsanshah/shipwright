import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './helpers/frontmatter.mjs';
import { SPEC_SECTIONS } from '../scripts/lib/delivery-docs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const list = (dir, filter) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter(filter) : []);

const commands = list('commands', (f) => f.endsWith('.md')).map((f) => `commands/${f}`);
const agents = list('agents', (f) => f.endsWith('.md')).map((f) => `agents/${f}`);
const skills = list('skills', (d) => fs.existsSync(path.join(root, 'skills', d, 'SKILL.md'))).map((d) => `skills/${d}/SKILL.md`);


for (const file of commands) {
  test(`${file}: description and a Gate section`, () => {
    const fm = parseFrontmatter(read(file));
    assert.ok(fm?.data.description, 'frontmatter description required');
    assert.match(fm.body, /^## Gate\b/m);
  });
}

for (const file of skills) {
  test(`${file}: name matches folder, description, Gate section, short`, () => {
    const fm = parseFrontmatter(read(file));
    assert.equal(fm?.data.name, path.basename(path.dirname(file)));
    assert.ok(fm.data.description);
    assert.match(fm.body, /^## Gate\b/m);
    assert.ok(fm.body.split(/\r?\n/).length <= 80, 'keep SKILL.md short; move reference material next to it');
  });
}

for (const file of agents) {
  test(`${file}: name matches file, description, verdict contract`, () => {
    const fm = parseFrontmatter(read(file));
    assert.equal(fm?.data.name, path.basename(file, '.md'));
    assert.ok(fm.data.description);
    assert.match(fm.body, /Verdict: /);
  });
}

test('every ${CLAUDE_PLUGIN_ROOT}/ path referenced in markdown exists', () => {
  for (const file of [...commands, ...agents, ...skills]) {
    for (const [, rel] of read(file).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(root, rel)), `${file} references missing ${rel}`);
    }
  }
});

test('spec-writing skill and spec-critic agent exist and share the spec section contract', () => {
  assert.ok(skills.includes('skills/spec-writing/SKILL.md'));
  assert.ok(agents.includes('agents/spec-critic.md'));
  const skill = read('skills/spec-writing/SKILL.md');
  for (const name of SPEC_SECTIONS) {
    const s = `## ${name}`;
    assert.ok(skill.includes(s), `spec-writing must list ${s}`);
  }
  assert.ok(skill.includes('AC-1'));
  assert.ok(skill.includes('${CLAUDE_PLUGIN_ROOT}/skills/spec-writing/examples.md'));
  const critic = read('agents/spec-critic.md');
  assert.match(critic, /^Verdict: PASS$/m);
  assert.match(critic, /^Verdict: GAPS$/m);
  for (const c of ['untestable', 'ambiguous', 'missing-edge-case', 'unmapped-criterion', 'scope', 'product-decision', 'missing-section', 'open-question']) {
    assert.ok(critic.includes(`[${c}]`), `spec-critic must define category ${c}`);
  }
  const fm = parseFrontmatter(critic);
  assert.ok(fm.data.tools && !/\b(Edit|Write|Bash)\b/.test(fm.data.tools), 'spec-critic is read-only');
});

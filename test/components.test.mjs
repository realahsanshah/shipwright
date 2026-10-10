import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './helpers/frontmatter.mjs';
import { SPEC_SECTIONS, parseReview } from '../scripts/lib/delivery-docs.mjs';

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

test('test-strategy skill, planner agent and builder agent carry their contracts', () => {
  assert.ok(skills.includes('skills/test-strategy/SKILL.md'));
  const skill = read('skills/test-strategy/SKILL.md');
  for (const s of ['failing test', 'reproduc', 'pytest', 'xunit', '${CLAUDE_PLUGIN_ROOT}/skills/test-strategy/stacks.md']) {
    assert.ok(skill.includes(s), `test-strategy must mention ${s}`);
  }
  assert.match(skill, /node:test|vitest|jest/);

  const planner = read('agents/planner.md');
  for (const s of ['Verdict: PLANNED', 'Verdict: BLOCKED', '### Step', '- Covers:', '- Files:', '- Test:', '- Depends on:', 'Spec:',
    '${CLAUDE_PLUGIN_ROOT}/skills/test-strategy/SKILL.md', '${CLAUDE_PLUGIN_ROOT}/scripts/check-plan.mjs']) {
    assert.ok(planner.includes(s), `planner must mention ${s}`);
  }
  const pt = parseFrontmatter(planner).data.tools;
  assert.ok(pt && !/\b(Bash|Edit)\b/.test(pt), 'planner has no Bash or Edit');

  const builder = read('agents/builder.md');
  for (const s of ['Verdict: DONE', 'Verdict: BLOCKED', '<id> step <N>: <title>', 'build-log.md', 'RED', 'GREEN', 'git add',
    '${CLAUDE_PLUGIN_ROOT}/skills/test-strategy/SKILL.md']) {
    assert.ok(builder.includes(s), `builder must mention ${s}`);
  }
  assert.match(builder, /never[^.\n]*git add -A|do not[^.\n]*git add -A/i);
  const bt = parseFrontmatter(builder).data.tools;
  for (const t of ['Bash', 'Edit', 'Write']) assert.ok(bt.includes(t), `builder needs ${t}`);
});

test('frontmatter values containing ": " are quoted (YAML safety)', () => {
  const files = [];
  for (const d of ['commands', 'agents']) {
    for (const f of fs.readdirSync(new URL(`../${d}/`, import.meta.url))) if (f.endsWith('.md')) files.push(`${d}/${f}`);
  }
  for (const s of fs.readdirSync(new URL('../skills/', import.meta.url))) {
    if (fs.existsSync(new URL(`../skills/${s}/SKILL.md`, import.meta.url))) files.push(`skills/${s}/SKILL.md`);
  }
  for (const file of files) {
    const m = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) continue;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_-]+):\s+(.*)$/);
      if (!kv || !kv[2].includes(': ')) continue;
      assert.match(kv[2], /^(".*"|'.*')$/, `${file}: unquoted value with ": " in "${kv[1]}"`);
    }
  }
});

test('code-reviewer and security-reviewer agents are read-only and emit review.md-shaped output', () => {
  for (const name of ['code-reviewer', 'security-reviewer']) {
    const file = `agents/${name}.md`;
    assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), `${file} exists`);
    const body = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
    for (const s of ['Verdict: PASS', 'Verdict: BLOCKING', '[blocking]', '[non-blocking]', 'spec.md', 'verify-report.md', 'diff']) {
      assert.ok(body.includes(s), `${name} must mention ${s}`);
    }
    const tools = parseFrontmatter(body).data.tools;
    assert.ok(tools, `${name} declares tools`);
    const list = tools.split(',').map((t) => t.trim()).filter(Boolean).sort();
    assert.deepEqual(list, ['Glob', 'Grep', 'Read'], `${name} tools are exactly read-only`);
    const fence = body.match(/```[^\n]*\r?\n([\s\S]*?)```/);
    assert.ok(fence, `${name} has an illustrative fenced example`);
    const parsed = parseReview(`## Code review\n\n${fence[1]}`);
    const section = parsed.sections.get('Code review');
    assert.ok(section, `${name} example parses as a review section`);
    assert.ok(['PASS', 'BLOCKING'].includes(section.verdict), `${name} example has a valid verdict`);
  }
});

test('reviewer agents state unreadable-input, trailing-output and solo rules', () => {
  for (const name of ['code-reviewer', 'security-reviewer']) {
    const body = fs.readFileSync(new URL(`../agents/${name}.md`, import.meta.url), 'utf8');
    assert.match(body, /nothing after the findings/i, name);
    assert.match(body, /treat any earlier conversation as absent; judge only the files/, name);
    assert.match(body, /cannot be read[\s\S]*Verdict: BLOCKING[\s\S]*- \[blocking\]/i, name);
  }
  const code = fs.readFileSync(new URL('../agents/code-reviewer.md', import.meta.url), 'utf8');
  assert.match(code, /edge case[^.]*unhandled/i);
  assert.match(code, /contradict.*Data changes/i);
  assert.match(code, /implemented but untested/i);
  const sec = fs.readFileSync(new URL('../agents/security-reviewer.md', import.meta.url), 'utf8');
  for (const s of ['without auth', 'unsanitised', 'committed secret', 'known vulnerabilit', 'default to blocking']) assert.ok(sec.includes(s), s);
});

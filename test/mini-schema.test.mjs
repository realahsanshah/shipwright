import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { validate } from '../scripts/lib/mini-schema.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../schemas/ticket.schema.json', import.meta.url), 'utf8'));
const fixturesDir = new URL('./fixtures/tickets/', import.meta.url);
const fixtures = fs.readdirSync(fixturesDir).map((f) => [f, JSON.parse(fs.readFileSync(new URL(f, fixturesDir), 'utf8'))]);

test('ticket schema compiles under ajv draft 2020-12 strict mode', () => {
  new Ajv2020({ strict: true }).compile(schema);
});

for (const [name, data] of fixtures) {
  test(`mini validator agrees with ajv on ${name}`, () => {
    const ajvValid = new Ajv2020({ strict: true }).validate(schema, data);
    const errors = validate(schema, data);
    assert.equal(errors.length === 0, ajvValid, errors.join('\n'));
    assert.equal(ajvValid, name.startsWith('valid-'));
  });
}

test('reports missing required, bad enum, extra property, short string with pointers', () => {
  const missing = validate(schema, fixtures.find(([n]) => n === 'invalid-missing-and-bad-enum.json')[1]);
  assert.ok(missing.includes('/: missing required property "title"'), missing.join('\n'));
  assert.ok(missing.some((e) => e.startsWith('/source: must be one of')), missing.join('\n'));
  const extra = validate(schema, fixtures.find(([n]) => n === 'invalid-extra-and-empty-criterion.json')[1]);
  assert.ok(extra.includes('/priority: is not allowed'), extra.join('\n'));
  assert.ok(extra.includes('/acceptance_criteria/0: must have length >= 1'), extra.join('\n'));
});

test('rejects ids that are unsafe as folder or branch names', () => {
  const base = { source: 'text', flow: 'task', type: 'chore', title: 't', description: '', acceptance_criteria: [], open_questions: [] };
  for (const id of ['../etc', 'a/b', 'a..b', '-x', 'x.', '', 'a b']) {
    assert.ok(validate(schema, { ...base, id }).length > 0, `expected ${JSON.stringify(id)} to be rejected`);
  }
  for (const id of ['HC-142', 'gh-17', 'local-20261010-export_csv', 'a', 'v1.2']) {
    assert.deepEqual(validate(schema, { ...base, id }), [], `expected ${id} to be accepted`);
  }
});

test('type checks distinguish array, null, integer', () => {
  assert.deepEqual(validate({ type: 'integer' }, 3), []);
  assert.deepEqual(validate({ type: 'integer' }, 3.5), ['/: must be integer']);
  assert.deepEqual(validate({ type: 'number' }, 3), []);
  assert.deepEqual(validate({ type: 'object' }, []), ['/: must be object']);
  assert.deepEqual(validate({ type: 'object' }, null), ['/: must be object']);
  assert.deepEqual(validate({ type: ['string', 'null'] }, null), []);
});

test('throws on unsupported keywords anywhere in the schema, even unvisited branches', () => {
  assert.throws(() => validate({ type: 'object', properties: { a: { oneOf: [] } } }, {}), /unsupported schema keyword "oneOf" at \/properties\/a/);
});

test('base_branch must be a safe ref name; mini validator and ajv agree', () => {
  const base = fixtures.find(([n]) => n === 'valid-minimal-bug.json')[1];
  const cases = { main: true, 'release/2.1': true, 'feat/a_b-c.d': true, '-x': false, '--upload-pack=x': false, 'a..b': false, 'a b': false, 'a;b': false, '': false };
  for (const [value, ok] of Object.entries(cases)) {
    const data = { ...base, base_branch: value };
    assert.equal(new Ajv2020({ strict: true }).validate(schema, data), ok, `ajv ${value}`);
    assert.equal(validate(schema, data).length === 0, ok, `mini ${value}`);
  }
});

#!/usr/bin/env node
// Usage: node validate.mjs <schema-name> <file>
// Exit 0 valid, 1 invalid (errors on stdout), 2 usage or input error (stderr).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './lib/mini-schema.mjs';

const schemasDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const available = fs.readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).map((f) => f.replace('.schema.json', ''));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [name, file] = process.argv.slice(2);
if (!name || !file) fail('usage: node validate.mjs <schema-name> <file>');
if (!available.includes(name)) fail(`unknown schema "${name}"; available: ${available.join(', ')}`);

let text;
try {
  text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
} catch (err) {
  fail(`cannot read ${file}: ${err.message}`);
}

let data;
try {
  data = JSON.parse(text);
} catch (err) {
  fail(`${file} is not valid JSON: ${err.message}`);
}

const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, `${name}.schema.json`), 'utf8'));
const errors = validate(schema, data);
if (errors.length === 0) {
  process.stdout.write(`valid: ${file} matches ${name}\n`);
  process.exit(0);
}
process.stdout.write(`invalid: ${file}\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
process.exit(1);

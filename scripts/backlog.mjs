#!/usr/bin/env node
// Usage: node backlog.mjs check <file> [--approved] | next <file> | set <file> <id> <Field>=<value>...
import fs from 'node:fs';
import { readText, usageError, emit } from './lib/cli.mjs';
import { parseBacklog, checkBacklog, nextItem, setFields } from './lib/backlog.mjs';

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file) usageError('usage: node backlog.mjs check <file> [--approved] | next <file> | set <file> <id> <Field>=<value>...');
const text = readText(file);
if (cmd === 'check') {
  emit(file, 'is a valid backlog', checkBacklog(parseBacklog(text), { requireApproved: rest.includes('--approved') }));
} else if (cmd === 'next') {
  const backlog = parseBacklog(text);
  const errors = checkBacklog(backlog, { requireApproved: true });
  if (errors.length) emit(file, '', errors);
  else {
    const { item, reason } = nextItem(backlog);
    process.stdout.write(item ? `${item.id}\n` : `none: ${reason}\n`);
    process.exitCode = item ? 0 : 3;
  }
} else if (cmd === 'set') {
  const [id, ...pairs] = rest;
  if (!id || pairs.length === 0) usageError('usage: node backlog.mjs set <file> <id> <Field>=<value>...');
  const updates = {};
  for (const p of pairs) {
    const eq = p.indexOf('=');
    if (eq < 1) usageError(`bad assignment "${p}" (expected Field=value)`);
    updates[p.slice(0, eq)] = p.slice(eq + 1);
  }
  try {
    fs.writeFileSync(file, setFields(fs.readFileSync(file, 'utf8'), id, updates));
  } catch (err) {
    usageError(`set failed: ${err.message}`);
  }
  process.stdout.write(`ok: ${id} ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
} else {
  usageError(`unknown command "${cmd}" (check, next, set)`);
}

#!/usr/bin/env node
// SessionStart: stdout is added to Claude's context, so print the kit's global rules.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const rulesPath = fileURLToPath(new URL('../rules/delivery-rules.md', import.meta.url));
try {
  process.stdout.write(fs.readFileSync(rulesPath, 'utf8'));
} catch (err) {
  process.stderr.write(`session-start: could not read delivery rules: ${err.message}\n`);
  process.exit(1);
}

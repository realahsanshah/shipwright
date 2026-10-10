#!/usr/bin/env node
// Usage: node check-spec.mjs <spec.md>   — gate for "may /plan start?"
import { readText, usageError, emit } from './lib/cli.mjs';
import { parseSpec, checkSpec } from './lib/delivery-docs.mjs';

const [specFile] = process.argv.slice(2);
if (!specFile) usageError('usage: node check-spec.mjs <spec.md>');
emit(specFile, 'is approved and complete', checkSpec(parseSpec(readText(specFile))));

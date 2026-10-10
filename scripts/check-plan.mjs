#!/usr/bin/env node
// Usage: node check-plan.mjs <spec.md> <plan.md>   — the /plan gate, and /build's entry check.
import { readText, usageError, emit } from './lib/cli.mjs';
import { parseSpec, parsePlan, checkPlan } from './lib/delivery-docs.mjs';

const [specFile, planFile] = process.argv.slice(2);
if (!specFile || !planFile) usageError('usage: node check-plan.mjs <spec.md> <plan.md>');
emit(planFile, 'covers every acceptance criterion', checkPlan(parseSpec(readText(specFile)), parsePlan(readText(planFile))));

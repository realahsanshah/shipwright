#!/usr/bin/env node
// Usage: node check-verify.mjs <spec.md> <verify-report.md>   — the /verify gate.
import { readText, usageError, emit } from './lib/cli.mjs';
import { parseSpec, parseVerifyReport, checkVerify, MAX_ATTEMPTS } from './lib/delivery-docs.mjs';

const [specFile, reportFile] = process.argv.slice(2);
if (!specFile || !reportFile) usageError('usage: node check-verify.mjs <spec.md> <verify-report.md>');
const report = parseVerifyReport(readText(reportFile));
const { errors, outcome } = checkVerify(parseSpec(readText(specFile)), report);
const reasons = errors.length > 0 || outcome === 'PASS' ? errors : [`Status: FAIL (attempt ${report.attempts} of ${MAX_ATTEMPTS})`];
emit(reportFile, 'passes: every check green and every criterion has evidence', reasons);

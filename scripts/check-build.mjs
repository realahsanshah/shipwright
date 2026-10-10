#!/usr/bin/env node
// Usage: node check-build.mjs <plan.md> <build-log.md>   — the /build gate.
import { readText, usageError, emit } from './lib/cli.mjs';
import { parsePlan, parseBuildLog, checkBuild } from './lib/delivery-docs.mjs';

const [planFile, logFile] = process.argv.slice(2);
if (!planFile || !logFile) usageError('usage: node check-build.mjs <plan.md> <build-log.md>');
emit(logFile, 'has a DONE, committed entry for every plan step', checkBuild(parsePlan(readText(planFile)), parseBuildLog(readText(logFile))));

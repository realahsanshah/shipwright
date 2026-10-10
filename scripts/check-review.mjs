#!/usr/bin/env node
// Usage: node check-review.mjs <spec.md> <verify-report.md> <review.md> <pr-description.md> [--head <sha>]
// The /review gate and /ship's entry check.
import { readText, usageError, emit } from './lib/cli.mjs';
import {
  parseSpec, parseVerifyReport, checkVerify, parseReview, checkReview,
  parsePrDescription, checkPrDescription, sameCommit,
} from './lib/delivery-docs.mjs';

const args = process.argv.slice(2);
const headIdx = args.indexOf('--head');
const head = headIdx >= 0 ? args[headIdx + 1] : null;
if (headIdx >= 0 && (!head || head.startsWith('-'))) usageError('--head needs a commit sha');
if (head !== null && !/^[0-9a-f]{7,40}$/i.test(head)) usageError('--head must be a commit sha (7 to 40 hex characters)');
const files = headIdx >= 0 ? args.filter((_, i) => i !== headIdx && i !== headIdx + 1) : args;
const [specFile, verifyFile, reviewFile, prFile] = files;
if (!specFile || !verifyFile || !reviewFile || !prFile) {
  usageError('usage: node check-review.mjs <spec.md> <verify-report.md> <review.md> <pr-description.md> [--head <sha>]');
}
const spec = parseSpec(readText(specFile));
const verify = parseVerifyReport(readText(verifyFile));
const review = parseReview(readText(reviewFile));
const pr = parsePrDescription(readText(prFile));
const { errors: verifyErrors, outcome } = checkVerify(spec, verify);
const errors = [
  ...verifyErrors.map((e) => `verify: ${e}`),
  ...(outcome === 'PASS' ? [] : verifyErrors.length ? [] : ['verify: Status is FAIL']),
  ...checkReview(review).map((e) => `review: ${e}`),
  ...checkPrDescription(spec, pr).map((e) => `pr-description: ${e}`),
];
if (head) {
  if (!sameCommit(verify.commit, head)) errors.push(`verify-report Commit ${verify.commit} is stale (last code commit is ${head}); rerun /verify`);
  if (!sameCommit(review.commit, head)) errors.push(`review Commit ${review.commit} is stale (last code commit is ${head}); rerun /review`);
}
emit(reviewFile, 'ready to ship', errors);

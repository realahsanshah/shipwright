import fs from 'node:fs';

// Shared plumbing for the check-* CLIs: exit 0 pass, 1 gate failure, 2 usage or input error.
export function usageError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    return usageError(`cannot read ${file}: ${err.message}`);
  }
}

// exitCode rather than exit() so piped stdout is flushed.
export function emit(file, label, errors) {
  if (errors.length === 0) {
    process.stdout.write(`ok: ${file} ${label}\n`);
    process.exitCode = 0;
    return;
  }
  process.stdout.write(`failed: ${file}\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exitCode = 1;
}

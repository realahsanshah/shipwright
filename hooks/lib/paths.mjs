import path from 'node:path';

export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

// Project-relative posix path, or null when filePath is outside projectDir (or is projectDir).
export function projectRelative(filePath, projectDir) {
  const root = path.resolve(projectDir);
  const rel = path.relative(root, path.resolve(root, filePath));
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

// Case-insensitive: Windows and macOS file systems are, and a guard should not be bypassed by `.ENV`.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const dirPrefix = glob[i + 2] === '/';
      re += dirPrefix ? '(?:.*/)?' : '.*';
      i += dirPrefix ? 2 : 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

export function matchesAny(p, globs) {
  return globs.some((g) => globToRegExp(g).test(p));
}

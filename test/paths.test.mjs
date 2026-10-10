import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { toPosix, projectRelative, globToRegExp, matchesAny } from '../hooks/lib/paths.mjs';

const proj = path.join(os.tmpdir(), 'Some Client Proj');

test('toPosix converts backslashes', () => {
  assert.equal(toPosix('E:\\a b\\c.txt'), 'E:/a b/c.txt');
});

test('projectRelative returns posix path inside, null outside', () => {
  assert.equal(projectRelative(path.join(proj, 'src', 'a.ts'), proj), 'src/a.ts');
  assert.equal(projectRelative('src/a.ts', proj), 'src/a.ts');
  assert.equal(projectRelative(path.join(proj, '..', 'other', 'a.ts'), proj), null);
  assert.equal(projectRelative(proj, proj), null);
  assert.equal(projectRelative(path.join(proj, '..foo'), proj), '..foo');
});

test('globToRegExp semantics', () => {
  assert.ok(globToRegExp('**/.env').test('.env'));
  assert.ok(globToRegExp('**/.env').test('E:/x y/proj/.env'));
  assert.ok(globToRegExp('**/.env').test('a/.ENV'));
  assert.ok(!globToRegExp('**/.env').test('a/.envrc'));
  assert.ok(globToRegExp('**/secrets/**').test('secrets/a'));
  assert.ok(globToRegExp('**/secrets/**').test('x/secrets/a/b'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/?.ts').test('src/a.ts'));
  assert.ok(globToRegExp('db/migrations/**').test('db/migrations/001.sql'));
  assert.ok(!globToRegExp('a.b').test('aXb'));
  assert.ok(matchesAny('x/key.pem', ['**/*.key', '**/*.pem']));
});

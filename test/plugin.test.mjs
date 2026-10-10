import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseFrontmatter } from './helpers/frontmatter.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('manifest has kebab-case name, description, semver version, author', () => {
  assert.match(manifest.name, /^[a-z][a-z0-9-]*$/);
  assert.ok(manifest.description.length > 0);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.author.name);
});

test('manifest and package.json versions match', () => {
  assert.equal(manifest.version, pkg.version);
});

test('parseFrontmatter reads key/value pairs and body, LF or CRLF', () => {
  const lf = parseFrontmatter('---\nname: x\ndescription: "Says hi"\n---\nBody\n');
  assert.deepEqual(lf.data, { name: 'x', description: 'Says hi' });
  assert.equal(lf.body, 'Body\n');
  const crlf = parseFrontmatter('---\r\nname: y\r\n---\r\nB');
  assert.equal(crlf.data.name, 'y');
  assert.equal(crlf.body, 'B');
  assert.equal(parseFrontmatter('no frontmatter'), null);
});

const hasClaude = spawnSync('claude', ['--version'], { shell: true }).status === 0;
test('claude plugin validate: no errors or unexpected warnings', { skip: !hasClaude && 'claude CLI not installed' }, () => {
  const r = spawnSync('claude', ['plugin', 'validate', '.', '--json'], {
    cwd: new URL('..', import.meta.url), shell: true, encoding: 'utf8',
  });
  let result;
  try {
    result = JSON.parse(r.stdout);
  } catch (err) {
    assert.fail(`claude plugin validate did not print JSON (${err.message}).
stdout: ${r.stdout}
stderr: ${r.stderr}`);
  }

  assert.equal(result.success, true, `Validation failed: ${JSON.stringify(result)}`);

  // Check manifest for errors and unexpected warnings
  assert.ok(result.manifest, `no manifest in result: ${JSON.stringify(result)}`);
  {
    const errors = result.manifest.errors || [];
    const warnings = (result.manifest.warnings || []).filter(
      w => !w.message.startsWith('CLAUDE.md at the plugin root is not loaded as project context')
    );
    assert.equal(errors.length, 0, `Manifest errors: ${JSON.stringify(errors)}`);
    assert.equal(warnings.length, 0, `Unexpected manifest warnings: ${JSON.stringify(warnings)}`);
  }

  // Check contents entries for errors and unexpected warnings
  assert.ok(Array.isArray(result.contents), `contents is not an array: ${JSON.stringify(result)}`);
  {
    for (const entry of result.contents) {
      const errors = entry.errors || [];
      const warnings = (entry.warnings || []).filter(
        w => !w.message.startsWith('CLAUDE.md at the plugin root is not loaded as project context')
      );
      assert.equal(errors.length, 0, `Errors in ${entry.file}: ${JSON.stringify(errors)}`);
      assert.equal(warnings.length, 0, `Unexpected warnings in ${entry.file}: ${JSON.stringify(warnings)}`);
    }
  }
});

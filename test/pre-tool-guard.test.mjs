import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFile, checkCommand, checkShellSecrets, decide, readDangerZones, isSecretPath } from '../hooks/pre-tool-guard.mjs';

const hook = fileURLToPath(new URL('../hooks/pre-tool-guard.mjs', import.meta.url));
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'Ahsan Shah Workspace proj '));
fs.writeFileSync(path.join(proj, 'CLAUDE.md'), [
  '# Project',
  '## Danger zones',
  '- `db/migrations/**` — applied migrations',
  '- `./generated/` — codegen output',
  '* `config/prod.json` — prod config',
  '### Why',
  '- `still/in/section/**` — subheadings do not end the section',
  '## Conventions',
  '- `src/**` — not a danger zone',
].join('\r\n'));

const runHook = (input, env = {}) => spawnSync(process.execPath, [hook], {
  input: typeof input === 'string' ? input : JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env },
});

test('readDangerZones parses the contract format', () => {
  assert.deepEqual(readDangerZones(proj), ['db/migrations/**', 'generated/**', 'config/prod.json', 'still/in/section/**']);
  assert.deepEqual(readDangerZones(path.join(proj, 'nope')), []);
});

test('secrets blocked for read and write, inside or outside project, any case or separator', () => {
  for (const p of [
    path.join(proj, '.env'), path.join(proj, 'api', '.env.local'), path.join(proj, '.ENV.PRODUCTION'),
    path.join(proj, 'certs', 'server.pem'), path.join(proj, 'tls.key'), path.join(proj, 'secrets', 'x.json'),
    path.join(proj, 'infra', 'terraform.tfstate'),
    path.join(os.homedir(), '.aws', 'credentials'), path.join(os.homedir(), '.kube', 'config'),
  ]) {
    assert.match(checkFile('Read', p, proj) ?? '', /secret/, `Read ${p}`);
    assert.match(checkFile('Write', p, proj) ?? '', /secret/, `Write ${p}`);
  }
  assert.match(checkFile('Read', proj.replace(/\\/g, '/') + '/.env', proj) ?? '', /secret/);
});

test('.env templates stay readable and editable', () => {
  for (const name of ['.env.example', '.env.sample', '.env.template']) {
    assert.equal(checkFile('Read', path.join(proj, name), proj), null);
    assert.equal(checkFile('Edit', path.join(proj, name), proj), null);
  }
});

test('danger zones block writes only, inside project only', () => {
  const mig = path.join(proj, 'db', 'migrations', '001_init.sql');
  assert.match(checkFile('Edit', mig, proj) ?? '', /danger zone `db\/migrations\/\*\*`/);
  assert.match(checkFile('Write', path.join(proj, 'generated', 'api.ts'), proj) ?? '', /danger zone/);
  assert.match(checkFile('MultiEdit', path.join(proj, 'CONFIG', 'Prod.json'), proj) ?? '', /danger zone/);
  assert.equal(checkFile('Read', mig, proj), null);
  assert.equal(checkFile('Edit', path.join(proj, 'src', 'a.ts'), proj), null);
  assert.equal(checkFile('Edit', path.join(os.tmpdir(), 'db', 'migrations', 'x.sql'), proj), null);
});

test('dangerous commands blocked, safe lookalikes allowed', () => {
  for (const c of [
    'git push --force', 'git push origin main --force', 'git push -f origin main', 'npm test && git push --force',
    'terraform destroy', 'terraform -chdir=infra destroy -auto-approve', 'terraform apply -destroy',
    'kubectl delete namespace prod', 'kubectl --context x delete ns prod',
  ]) assert.ok(checkCommand(c), c);
  for (const c of [
    'git push', 'git push --force-with-lease', 'git push --force-if-includes origin x', 'git fetch -f',
    'terraform plan', 'kubectl delete pod x', 'echo terraform destroy is blocked > notes.txt',
  ]) assert.equal(checkCommand(c), null, c);
});

test('decide routes by tool and ignores unrelated tools', () => {
  assert.ok(decide({ tool_name: 'Read', tool_input: { file_path: path.join(proj, '.env') } }, proj));
  assert.ok(decide({ tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(proj, 'secrets', 'n.ipynb') } }, proj));
  assert.ok(decide({ tool_name: 'PowerShell', tool_input: { command: 'git push --force' } }, proj));
  assert.equal(decide({ tool_name: 'Grep', tool_input: { pattern: 'x' } }, proj), null);
  assert.equal(decide({ tool_name: 'Read', tool_input: {} }, proj), null);
});

test('hook process: exit 2 with stderr when blocking, 0 when allowed', () => {
  const blocked = runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(proj, 'db', 'migrations', 'a.sql') } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /danger zone/);
  const allowed = runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(proj, 'src', 'a.ts') } });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('hook process falls back to input.cwd when CLAUDE_PROJECT_DIR is unset', () => {
  const r = runHook({ cwd: proj, tool_name: 'Write', tool_input: { file_path: path.join(proj, 'generated', 'x.ts') } }, { CLAUDE_PROJECT_DIR: '' });
  assert.equal(r.status, 2);
});

test('malformed or empty stdin is a non-blocking error (exit 1), never exit 2', () => {
  for (const input of ['', '{not json']) {
    const r = runHook(input);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /pre-tool-guard: could not parse hook input/);
  }
});

test('.env* variants blocked; example/sample/template suffixes allowed; secrets dir still blocked', () => {
  for (const name of ['.envrc', '.env-prod', '.env_local']) {
    assert.match(checkFile('Read', path.join(proj, name), proj) ?? '', /secret/, name);
  }
  for (const name of ['.env.local.example', '.env.production.sample']) {
    assert.equal(checkFile('Read', path.join(proj, name), proj), null, `Read ${name}`);
    assert.equal(checkFile('Edit', path.join(proj, name), proj), null, `Edit ${name}`);
  }
  assert.match(checkFile('Read', path.join(proj, 'secrets', '.env.example'), proj) ?? '', /secret/);
});

test('Windows credential stores and AWS SSO cache blocked', () => {
  for (const p of [
    path.join(os.homedir(), 'AppData', 'Roaming', 'gcloud', 'credentials.db'),
    path.join(os.homedir(), '.aws', 'sso', 'cache', 'abc.json'),
  ]) {
    assert.match(checkFile('Read', p, proj) ?? '', /secret/, p);
    assert.equal(isSecretPath(p, proj), true, p);
  }
});

test('Grep blocked on secret path or secret glob, allowed otherwise', () => {
  assert.match(decide({ tool_name: 'Grep', tool_input: { pattern: 'KEY', path: path.join(proj, '.env') } }, proj) ?? '', /secret/);
  assert.equal(decide({ tool_name: 'Grep', tool_input: { pattern: 'x', path: 'src', glob: '*.ts' } }, proj), null);
  assert.match(decide({ tool_name: 'Grep', tool_input: { pattern: 'x', glob: '.env*' } }, proj) ?? '', /secret/);
  assert.match(decide({ tool_name: 'Grep', tool_input: { pattern: 'x', glob: '*.pem' } }, proj) ?? '', /secret/);
  assert.equal(decide({ tool_name: 'Grep', tool_input: { pattern: 'x' } }, proj), null);
});

test('checkShellSecrets blocks secret file references, allows examples and commit messages', () => {
  for (const c of [
    'cat .env', 'type .env.local', 'Get-Content secrets/db.json', 'grep KEY .env',
    'docker run --env-file=.env app', 'cat ~/.aws/credentials', 'cp .env.example .env', 'cat ".env"',
  ]) {
    assert.match(checkShellSecrets(c, proj) ?? '', /secret file/, c);
  }
  for (const c of [
    'cat .env.example', 'git commit -m "ignore .env files"', 'git commit -m .env',
    'echo "the .env file"', 'npm test', 'ls src',
  ]) {
    assert.equal(checkShellSecrets(c, proj), null, c);
  }
  assert.match(decide({ tool_name: 'Bash', tool_input: { command: 'cat .env' } }, proj) ?? '', /secret file/);
});

test('wrapped, prefixed and quoted destructive commands blocked', () => {
  for (const c of [
    'bash -c "git push --force"', "sh -c 'terraform destroy'", 'echo `git push -f`', '{ git push -f; }',
    'if true; then git push -f; fi', 'FOO=1 git push -f', 'sudo git push --force', 'git -C repo push --force',
    'git -c a=b push -f', 'git.exe push --force', 'git push -uf origin x', 'git push origin +main',
    'sudo terraform destroy',
  ]) assert.ok(checkCommand(c), c);
});

test('safe git and shell lookalikes still allowed after hardening', () => {
  for (const c of ['git push -u origin main', 'git push origin main', 'git -C repo push', 'git -C repo status']) {
    assert.equal(checkCommand(c), null, c);
  }
});

test('stdin that is valid JSON but not an object is non-blocking (exit 1)', () => {
  const r = runHook('null');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not parse hook input/);
});

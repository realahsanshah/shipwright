import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const snippet = JSON.parse(fs.readFileSync(new URL('../settings/project-settings.json', import.meta.url), 'utf8'));

test('snippet only contains permissions.deny', () => {
  assert.deepEqual(Object.keys(snippet), ['permissions']);
  assert.deepEqual(Object.keys(snippet.permissions), ['deny']);
});

test('snippet denies the spec-listed reads and commands', () => {
  for (const rule of [
    'Read(**/.env)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/secrets/**)',
    'Read(~/.aws/credentials)', 'Read(~/.config/gcloud/**)', 'Read(~/.azure/**)', 'Read(~/.kube/config)',
    'Read(**/.env.local)', 'Read(**/.env.*.local)', 'Read(**/.env.production)', 'Read(**/.env.development)',
    'Read(**/.env.staging)', 'Read(**/.env.test)', 'Read(**/.envrc)', 'Read(**/.dev.vars)',
    'Read(~/.ssh/id_*)', 'Read(~/.git-credentials)', 'Read(~/.netrc)',
    'Bash(git push --force *)', 'Bash(terraform destroy *)', 'Bash(kubectl delete namespace *)',
  ]) assert.ok(snippet.permissions.deny.includes(rule), `missing ${rule}`);
});

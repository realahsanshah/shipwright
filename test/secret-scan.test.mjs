import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanFileDiff, scanLines, RULES } from '../scripts/secret-scan.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/secret-scan.mjs', import.meta.url));

// Every planted secret is assembled at runtime so no literal lives in this source.
const AWS = 'AKIA' + 'Q'.repeat(16);
const GH = 'ghp_' + 'a'.repeat(36);
const GH_FINE = 'github_pat_' + 'A'.repeat(60);
const SLACK = 'xoxb-' + '1234567890' + 'abcdef';
const GOOGLE = 'AIza' + 'B'.repeat(35);
const STRIPE = 'sk_live_' + 'c'.repeat(24);
const ANTHROPIC = 'sk-ant-' + 'd'.repeat(24);
const PEM = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const PW_KEY = 'pass' + 'word';
const generic = (v) => `${PW_KEY} = "${v}"`;

function diffFor(file, addedLines, { start = 5, isNew = false } = {}) {
  const head = [`diff --git a/${file} b/${file}`];
  if (isNew) head.push('new file mode 100644', '--- /dev/null');
  else head.push(`--- a/${file}`);
  head.push(`+++ b/${file}`, `@@ -1,0 +${start},${addedLines.length} @@`);
  return [...head, ...addedLines.map((l) => '+' + l)].join('\n') + '\n';
}

const SAMPLES = {
  'private-key': PEM,
  'aws-access-key-id': AWS,
  'github-token': GH,
  'github-fine-grained-token': GH_FINE,
  'slack-token': SLACK,
  'google-api-key': GOOGLE,
  'stripe-live-key': STRIPE,
  'anthropic-api-key': ANTHROPIC,
  'generic-assignment': generic('hunter2' + 'hunter2'),
};

test('every rule hits an added line with the right file and line', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), RULES.map((r) => r.id).sort());
  for (const [rule, text] of Object.entries(SAMPLES)) {
    const f = scanFileDiff('src/a.js', diffFor('src/a.js', ['// ok', text]));
    assert.deepEqual(f, [{ file: 'src/a.js', line: 6, rule }], rule);
  }
});

test('removed, context lines and +++ header are not scanned', () => {
  const diff = [
    'diff --git a/x.js b/x.js',
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -1,2 +1,2 @@',
    '-' + AWS,
    ' ' + GH,
    '+safe line',
  ].join('\n');
  assert.deepEqual(scanFileDiff("x.js", diff), []);
});

test('placeholders are not generic-assignment hits', () => {
  const lines = [
    generic('change' + 'me'),
    'api_' + 'key: "<your key>"',
    'tok' + 'en = "${TOKEN}"',
    'sec' + 'ret = "xxxxxxxx"',
  ];
  assert.deepEqual(scanFileDiff('a.yml', diffFor('a.yml', lines)), []);
});

test('shipwright:allow-secret skips the line', () => {
  assert.deepEqual(scanFileDiff('a.js', diffFor('a.js', [AWS + ' // shipwright:allow-secret'])), []);
});

test('scanLines reports given line numbers', () => {
  assert.deepEqual(scanLines('f', [{ line: 3, text: GH }]), [{ file: 'f', line: 3, rule: 'github-token' }]);
});

test('binary diff has no hunks and is skipped', () => {
  assert.deepEqual(scanFileDiff('img.png', 'Binary files a/img.png and b/img.png differ\n'), []);
});

test('an added line starting with "++ " is content, not a header', () => {
  const diff = ['@@ -0,0 +1,2 @@', '+safe', '+++ ' + AWS].join('\n');
  assert.deepEqual(scanFileDiff('f.txt', diff), [{ file: 'f.txt', line: 2, rule: 'aws-access-key-id' }]);
});

test('hunk header with missing counts means 1 line', () => {
  const diff = ['@@ -3 +3 @@', '-old', '+' + GH].join('\n');
  assert.deepEqual(scanFileDiff('f', diff), [{ file: 'f', line: 3, rule: 'github-token' }]);
});

test('generic-assignment placeholders are whole-value only', () => {
  const hit = (t) => scanLines('f', [{ line: 1, text: t }]).length;
  assert.equal(hit(PW_KEY + ' = "pa$' + '$w0rd!Xyz9"'), 1);
  assert.equal(hit(PW_KEY + ' = "your_Real-Pass123"'), 1);
  assert.equal(hit('api_' + 'key = "<your key>"'), 0);
  assert.equal(hit('tok' + 'en = "${TOKEN}"'), 0);
  assert.equal(hit('a = {' + PW_KEY + ': "change' + 'me", sec' + 'ret: "s3cr3t' + 'Value99"}'), 1);
});

// ---- CLI ----
const roots = [];
function run(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret scan '));
  roots.push(root);
  git(root, 'init', '-b', 'main');
  fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'init');
  git(root, 'checkout', '-b', 'feat/x');
  return root;
}
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

test('CLI: clean branch exits 0', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'a.txt'), 'nothing here\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'a');
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^secret-scan: clean \(\d+ files scanned\)/);
});

test('CLI: committed planted token is found and never printed', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'cfg.js'), `x\nconst t = "${GH}";\n`);
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'c');
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /1 finding\(s\)/);
  assert.match(r.stdout, /cfg\.js:2 github-token/);
  assert.ok(!(r.stdout + r.stderr).includes(GH));
});

test('CLI: untracked new file is scanned', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'new.txt'), `k=${AWS}\n`);
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /new\.txt:1 aws-access-key-id/);
  assert.ok(!(r.stdout + r.stderr).includes(AWS));
});

test('CLI: uncommitted modification to a tracked file is scanned', () => {
  const root = makeRepo();
  fs.appendFileSync(path.join(root, 'README.md'), `${STRIPE}\n`);
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /README\.md:2 stripe-live-key/);
  assert.ok(!(r.stdout + r.stderr).includes(STRIPE));
});

test('CLI: unknown base exits 2', () => {
  const root = makeRepo();
  const r = run(['--base', 'nope'], root);
  assert.equal(r.status, 2);
});

test('CLI: outside a git repo exits 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not repo '));
  roots.push(dir);
  const r = run([], dir);
  assert.equal(r.status, 2);
});

function commitFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'add ' + rel);
}

test('CLI: committed empty .env.production gives secret-file', () => {
  const root = makeRepo();
  commitFile(root, '.env.production', '');
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\.env\.production:0 secret-file/);
});

test('CLI: committed binary .env.local gives secret-file', () => {
  const root = makeRepo();
  commitFile(root, '.env.local', Buffer.from([1, 0, 2, 0, 255]));
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\.env\.local:0 secret-file/);
});

test('CLI: .env.example is fine', () => {
  const root = makeRepo();
  commitFile(root, '.env.example', 'A=1\n');
  assert.equal(run(['--base', 'main'], root).status, 0);
});

test('CLI: spaces and non-ASCII paths are reported exactly', () => {
  const root = makeRepo();
  commitFile(root, 'sp ace/a b.txt', `${GH}\n`);
  commitFile(root, '\u00e9.txt', `${AWS}\n`);
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('  - sp ace/a b.txt:1 github-token'), r.stdout);
  assert.ok(r.stdout.includes('  - \u00e9.txt:1 aws-access-key-id'), r.stdout);
  assert.ok(!(r.stdout + r.stderr).includes(GH) && !(r.stdout + r.stderr).includes(AWS));
});

test('CLI: large untracked file is skipped and counted', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'big.txt'), 'a'.repeat(1024 * 1024 + 10));
  const r = run(['--base', 'main'], root);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /clean \(1 files scanned, 1 large file skipped\)/);
});

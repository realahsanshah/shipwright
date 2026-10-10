import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localBin, planTools, shouldSkip, hasEslintConfig, hasRuffConfig, runTool } from '../hooks/post-edit-format.mjs';

const hook = fileURLToPath(new URL('../hooks/post-edit-format.mjs', import.meta.url));
const isWin = process.platform === 'win32';

function finders({ local = [], path: onPathNames = [], eslintConfig = true, ruffConfig = true, venv = [] } = {}) {
  return {
    eslintConfig: () => eslintConfig,
    ruffConfig: () => ruffConfig,
    venvBin: (_dir, name) => (venv.includes(name) ? '/p/.venv/bin/' + name : null),
    localBin: (_dir, name) => (local.includes(name) ? `/p/node_modules/.bin/${name}` : null),
    onPath: (name) => (onPathNames.includes(name) ? `/usr/bin/${name}` : null),
  };
}

test('planTools: ts file gets prettier then eslint, path last', () => {
  const tools = planTools('src/a.ts', '/p', finders({ local: ['prettier', 'eslint'] }));
  assert.deepEqual(tools.map((t) => [t.kind, t.name]), [['format', 'prettier'], ['lint', 'eslint']]);
  for (const t of tools) assert.equal(t.args.at(-1), 'src/a.ts');
});

test('planTools: json gets prettier only, svelte nothing', () => {
  const f = finders({ local: ['prettier', 'eslint'] });
  assert.deepEqual(planTools('a.json', '/p', f).map((t) => t.name), ['prettier']);
  assert.deepEqual(planTools('a.svelte', '/p', f), []);
});

test('planTools: python uses ruff on PATH; none without it; go nothing', () => {
  const tools = planTools('api/a.py', '/p', finders({ path: ['ruff'] }));
  assert.deepEqual(tools.map((t) => t.name), ['ruff format', 'ruff check']);
  assert.deepEqual(tools[0].args, ['format', '--', 'api/a.py']);
  assert.deepEqual(tools[1].args, ['check', '--', 'api/a.py']);
  assert.deepEqual(planTools('api/a.py', '/p', finders()), []);
  assert.deepEqual(planTools('main.go', '/p', finders({ local: ['prettier'], path: ['ruff'] })), []);
});

test('shouldSkip: outside, vendor dirs, .delivery, secrets, danger zones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pef-skip-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# P\n\n## Danger zones\n\n- `generated/**`\n');
    assert.equal(shouldSkip(null, dir), true);
    for (const p of ['node_modules/x.js', 'dist/a.js', '.delivery/HC-1/plan.md', '.env.local', 'generated/a.ts']) {
      assert.equal(shouldSkip(p, dir), true, p);
    }
    assert.equal(shouldSkip('src/a.ts', dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('localBin: prefers the .cmd shim on win32, plain bin elsewhere', () => {
  const base = path.join('/p', 'node_modules', '.bin', 'prettier');
  const exists = (c) => c === `${base}.cmd` || c === base;
  const got = localBin('/p', 'prettier', exists);
  assert.equal(got, isWin ? `${base}.cmd` : base);
  assert.equal(localBin('/p', 'prettier', () => false), null);
});

// ---- process-level tests ----
let proj;
before(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pef proj '));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'x.ts'), 'const a = 1;\n');
  fs.writeFileSync(path.join(proj, 'eslint.config.js'), 'export default [];\n');
  fs.mkdirSync(path.join(proj, 'node_modules', '.bin'), { recursive: true });
});
after(() => fs.rmSync(proj, { recursive: true, force: true }));

function fakeBin(name, out, code) {
  const file = path.join(proj, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);
  if (isWin) {
    const lines = ['@echo off'];
    if (out) lines.push(`echo ${out}`);
    lines.push(`exit /b ${code}`);
    fs.writeFileSync(file, `${lines.join('\r\n')}\r\n`);
  } else {
    fs.writeFileSync(file, `#!/bin/sh\n${out ? `echo "${out}"\n` : ''}exit ${code}\n`);
    fs.chmodSync(file, 0o755);
  }
}

function run(input, env = {}) {
  const r = spawnSync(process.execPath, [hook], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env },
  });
  return r;
}
const editInput = () => ({ tool_name: 'Edit', tool_input: { file_path: path.join(proj, 'src', 'x.ts') }, cwd: proj });

test('process: clean prettier and eslint exit 0 with empty stderr', () => {
  fakeBin('prettier', '', 0);
  fakeBin('eslint', '', 0);
  const r = run(editInput());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

test('process: eslint failure exits 2 with its output', () => {
  fakeBin('prettier', '', 0);
  fakeBin('eslint', 'x.ts:1 no-unused-vars', 1);
  const r = run(editInput());
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /post-edit-format: lint errors in src\/x\.ts/);
  assert.match(r.stderr, /x\.ts:1 no-unused-vars/);
});

test('process: prettier failure exits 2 with format failed', () => {
  fakeBin('prettier', 'SyntaxError oops', 2);
  fakeBin('eslint', '', 0);
  const r = run(editInput());
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /format failed/);
  assert.match(r.stderr, /SyntaxError oops/);
});

test('process: Read tool and opt-out run nothing', () => {
  fakeBin('prettier', 'ran', 2);
  fakeBin('eslint', 'ran', 1);
  const read = run({ ...editInput(), tool_name: 'Read' });
  assert.equal(read.status, 0);
  assert.equal(read.stderr, '');
  const off = run(editInput(), { SHIPWRIGHT_FORMAT_ON_EDIT: '0' });
  assert.equal(off.status, 0);
  assert.equal(off.stderr, '');
});

test('process: malformed stdin exits 1', () => {
  const r = run('not json');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /post-edit-format: could not parse hook input/);
  assert.equal(run('[]').status, 1);
});

test('planTools: "--" goes before the file for prettier and eslint', () => {
  const tools = planTools('src/-a.ts', '/p', finders({ local: ['prettier', 'eslint'] }));
  assert.deepEqual(tools.map((t) => t.args), [['--write', '--', 'src/-a.ts'], ['--', 'src/-a.ts']]);
});

test('planTools: eslint and ruff need project config; prettier needs only its local bin', () => {
  const noCfg = finders({ local: ['prettier', 'eslint'], path: ['ruff'], eslintConfig: false, ruffConfig: false });
  assert.deepEqual(planTools('src/a.ts', '/p', noCfg).map((t) => t.name), ['prettier']);
  assert.deepEqual(planTools('api/a.py', '/p', noCfg), []);
});

test('planTools: the project venv ruff is preferred over PATH', () => {
  const tools = planTools('api/a.py', '/p', finders({ path: ['ruff'], venv: ['ruff'] }));
  assert.ok(tools.every((t) => t.cmd === '/p/.venv/bin/ruff'));
  assert.deepEqual(planTools('api/a.py', '/p', finders({ venv: ['ruff'] })).length, 2);
});

function cfgDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pef cfg '));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('hasEslintConfig: flat config, legacy rc, package.json key; none otherwise', () => {
  const cases = [
    [{ 'eslint.config.mjs': '' }, true],
    [{ 'eslint.config.ts': '' }, true],
    [{ '.eslintrc.json': '{}' }, true],
    [{ '.eslintrc': '{}' }, true],
    [{ 'package.json': '{"eslintConfig":{}}' }, true],
    [{ 'package.json': '{"name":"x"}' }, false],
    [{ 'package.json': 'not json' }, false],
    [{}, false],
  ];
  for (const [files, want] of cases) {
    const dir = cfgDir(files);
    try { assert.equal(hasEslintConfig(dir), want, JSON.stringify(files)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('hasRuffConfig: [tool.ruff] in pyproject, ruff.toml, .ruff.toml; none otherwise', () => {
  const cases = [
    [{ 'pyproject.toml': '[project]\nname="x"\n\n[tool.ruff]\nline-length = 100\n' }, true],
    [{ 'pyproject.toml': '[tool.ruff.lint]\nselect = ["E"]\n' }, true],
    [{ 'pyproject.toml': '[project]\nname="x"\n# [tool.ruff] not here\n' }, false],
    [{ 'ruff.toml': '' }, true],
    [{ '.ruff.toml': '' }, true],
    [{}, false],
  ];
  for (const [files, want] of cases) {
    const dir = cfgDir(files);
    try { assert.equal(hasRuffConfig(dir), want, JSON.stringify(files)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('runTool: a tool that cannot be spawned fails open', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pef spawn '));
  try {
    const r = runTool({ kind: 'lint', name: 'eslint', cmd: path.join(dir, 'missing-tool'), args: ['--', 'a.ts'] }, dir);
    assert.equal(r.ok, true);
    assert.equal(r.notRun, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('process: eslint that cannot be spawned exits 0 with a one-line note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pef broken '));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'x.ts'), 'const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];\n');
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin', 'eslint'), { recursive: true }); // a directory: exists, cannot run
    const r = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'x.ts') }, cwd: dir }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim(), 'post-edit-format: could not run eslint');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('process: eslint without a project config is not run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pef nocfg '));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'x.ts'), 'const a = 1;\n');
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    const file = path.join(dir, 'node_modules', '.bin', isWin ? 'eslint.cmd' : 'eslint');
    fs.writeFileSync(file, isWin ? '@echo off\r\necho ran\r\nexit /b 1\r\n' : '#!/bin/sh\necho ran\nexit 1\n');
    if (!isWin) fs.chmodSync(file, 0o755);
    const r = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'x.ts') }, cwd: dir }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin/install-dev-link.sh');

function run(args = [], { home, os = 'Linux', shell = '/bin/bash', root = ROOT } = {}) {
  return spawnSync('bash', [join(root, 'bin/install-dev-link.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, JLU_UNAME_S: os, SHELL: shell },
  });
}

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'jlu-devlink-'));
}

const blockCount = (text) => text.split('# >>> jelou-spec-plugin dev-link >>>').length - 1;

describe('startup file detection across operating systems', () => {
  const cases = [
    ['Linux', '/bin/bash', '.bashrc'],
    ['Linux', '/usr/bin/zsh', '.zshrc'],
    ['Darwin', '/bin/zsh', '.zshrc'],
    ['Darwin', '/bin/bash', '.bash_profile'],
  ];

  for (const [os, shell, expected] of cases) {
    test(`${os} with ${shell} writes to ${expected}`, () => {
      const home = sandbox();
      const result = run(['--detect'], { home, os, shell });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), join(home, expected));
      rmSync(home, { recursive: true, force: true });
    });
  }

  test('macOS bash targets .bash_profile even when only .bashrc exists', () => {
    const home = sandbox();
    writeFileSync(join(home, '.bashrc'), 'export PATH=/usr/bin\n');
    const result = run(['--detect'], { home, os: 'Darwin', shell: '/bin/bash' });
    assert.equal(
      result.stdout.trim(),
      join(home, '.bash_profile'),
      'macOS Terminal opens bash as a login shell, which reads .bash_profile and never .bashrc — ' +
        'falling back to .bashrc writes a file nothing sources',
    );
    rmSync(home, { recursive: true, force: true });
  });

  test('macOS bash creates .bash_profile when it is missing', () => {
    const home = sandbox();
    const result = run([], { home, os: 'Darwin', shell: '/bin/bash' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(home, '.bash_profile')));
    assert.equal(existsSync(join(home, '.bashrc')), false);
    rmSync(home, { recursive: true, force: true });
  });

  test('an unrecognised OS refuses to guess and asks for --rc', () => {
    const home = sandbox();
    const result = run(['--detect'], { home, os: 'SunOS', shell: '/bin/bash' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported OS/);
    assert.match(result.stderr, /--rc/);
    rmSync(home, { recursive: true, force: true });
  });

  test('--rc overrides detection entirely', () => {
    const home = sandbox();
    const target = join(home, 'custom-profile');
    const result = run(['--detect', '--rc', target], { home, os: 'SunOS', shell: '/bin/fish' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), target);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('writing the block', () => {
  test('both helpers land, pointing at this repository', () => {
    const home = sandbox();
    const result = run([], { home });
    assert.equal(result.status, 0, result.stderr);
    const rc = readFileSync(join(home, '.bashrc'), 'utf8');
    assert.match(rc, /jlu-dev\(\) \{ claude --plugin-dir "/);
    assert.ok(rc.includes(ROOT), 'the block must reference the repository it was run from');
    assert.match(rc, /jlu-dev-c\(\) \{ jlu-dev --continue "\$@"; \}/);
    rmSync(home, { recursive: true, force: true });
  });

  test('existing startup content survives untouched', () => {
    const home = sandbox();
    const existing = 'export PATH=/opt/bin:$PATH\nalias ll="ls -la"\n';
    writeFileSync(join(home, '.bashrc'), existing);
    run([], { home });
    const rc = readFileSync(join(home, '.bashrc'), 'utf8');
    assert.ok(rc.startsWith(existing), 'the original file must remain a prefix of the result');
    rmSync(home, { recursive: true, force: true });
  });

  test('a missing startup file is created', () => {
    const home = sandbox();
    assert.equal(existsSync(join(home, '.bashrc')), false);
    run([], { home });
    assert.ok(existsSync(join(home, '.bashrc')));
    rmSync(home, { recursive: true, force: true });
  });

  test('running twice leaves exactly one block', () => {
    const home = sandbox();
    run([], { home });
    run([], { home });
    assert.equal(blockCount(readFileSync(join(home, '.bashrc'), 'utf8')), 1);
    rmSync(home, { recursive: true, force: true });
  });

  test('a moved repository rewrites the path instead of stacking a second block', () => {
    const home = sandbox();
    const moved = mkdtempSync(join(tmpdir(), 'jlu-moved-'));
    mkdirSync(join(moved, 'bin'), { recursive: true });
    writeFileSync(join(moved, 'bin/install-dev-link.sh'), readFileSync(SCRIPT, 'utf8'));

    run([], { home });
    run([], { home, root: moved });

    const rc = readFileSync(join(home, '.bashrc'), 'utf8');
    assert.equal(blockCount(rc), 1);
    assert.ok(rc.includes(moved), 'the surviving block must point at the new location');
    assert.equal(rc.includes(`--plugin-dir "${ROOT}"`), false, 'the stale path must be gone');

    rmSync(home, { recursive: true, force: true });
    rmSync(moved, { recursive: true, force: true });
  });

  test('a hand-written jlu-dev outside the block is reported, not silently shadowed', () => {
    const home = sandbox();
    writeFileSync(join(home, '.bashrc'), 'jlu-dev() { claude --plugin-dir /somewhere/else "$@"; }\n');
    const result = run([], { home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /already defines jlu-dev/);
    rmSync(home, { recursive: true, force: true });
  });

  test('an aliased jlu-dev is caught the same way', () => {
    const home = sandbox();
    writeFileSync(join(home, '.bashrc'), "alias jlu-dev='claude --plugin-dir /elsewhere'\n");
    assert.match(run([], { home }).stderr, /already defines jlu-dev/);
    rmSync(home, { recursive: true, force: true });
  });

  test('a clean file produces no such warning', () => {
    const home = sandbox();
    writeFileSync(join(home, '.bashrc'), 'export PATH=/opt/bin:$PATH\n');
    assert.doesNotMatch(run([], { home }).stderr, /already defines/);
    rmSync(home, { recursive: true, force: true });
  });

  test('--print emits the block without touching the filesystem', () => {
    const home = sandbox();
    const result = run(['--print'], { home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /jlu-dev\(\)/);
    assert.equal(existsSync(join(home, '.bashrc')), false);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('removing the block', () => {
  test('uninstall restores the file to what it was before', () => {
    const home = sandbox();
    const existing = 'export PATH=/opt/bin:$PATH\n';
    writeFileSync(join(home, '.bashrc'), existing);
    run([], { home });
    const result = run(['--uninstall'], { home });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(home, '.bashrc'), 'utf8'), existing);
    rmSync(home, { recursive: true, force: true });
  });

  test('repeated install/uninstall cycles never accumulate blank lines', () => {
    const home = sandbox();
    const existing = 'export PATH=/opt/bin:$PATH\n';
    writeFileSync(join(home, '.bashrc'), existing);
    for (let i = 0; i < 3; i++) {
      run([], { home });
      run(['--uninstall'], { home });
    }
    assert.equal(readFileSync(join(home, '.bashrc'), 'utf8'), existing);
    rmSync(home, { recursive: true, force: true });
  });

  test('blank lines the user already had are preserved', () => {
    const home = sandbox();
    const existing = 'export A=1\n\n\nexport B=2\n';
    writeFileSync(join(home, '.bashrc'), existing);
    run([], { home });
    run(['--uninstall'], { home });
    assert.equal(readFileSync(join(home, '.bashrc'), 'utf8'), existing);
    rmSync(home, { recursive: true, force: true });
  });

  test('uninstall on a file without a block changes nothing and still succeeds', () => {
    const home = sandbox();
    const existing = 'alias ll="ls -la"\n';
    writeFileSync(join(home, '.bashrc'), existing);
    const result = run(['--uninstall'], { home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /nothing to remove/);
    assert.equal(readFileSync(join(home, '.bashrc'), 'utf8'), existing);
    rmSync(home, { recursive: true, force: true });
  });

  test('a backup is left behind whenever an existing file is rewritten', () => {
    const home = sandbox();
    writeFileSync(join(home, '.bashrc'), 'alias ll="ls -la"\n');
    run([], { home });
    assert.ok(existsSync(join(home, '.bashrc.jlu-dev-link.bak')));
    rmSync(home, { recursive: true, force: true });
  });
});

describe('the generated functions are valid shell', () => {
  test('bash parses the block and both functions resolve', () => {
    const home = sandbox();
    run([], { home });
    const probe = spawnSync('bash', ['-c', `source "${join(home, '.bashrc')}"; type jlu-dev; type jlu-dev-c`], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stdout, /jlu-dev is a function/);
    assert.match(probe.stdout, /jlu-dev-c is a function/);
    rmSync(home, { recursive: true, force: true });
  });

  test('a plugin directory containing spaces stays quoted', () => {
    const home = sandbox();
    const spaced = mkdtempSync(join(tmpdir(), 'jlu spaced-'));
    mkdirSync(join(spaced, 'bin'), { recursive: true });
    writeFileSync(join(spaced, 'bin/install-dev-link.sh'), readFileSync(SCRIPT, 'utf8'));
    run([], { home, root: spaced });
    const rc = readFileSync(join(home, '.bashrc'), 'utf8');
    assert.ok(rc.includes(`--plugin-dir "${spaced}"`), 'the path must be double-quoted');
    rmSync(home, { recursive: true, force: true });
    rmSync(spaced, { recursive: true, force: true });
  });
});

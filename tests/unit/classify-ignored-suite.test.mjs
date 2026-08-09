import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'classify-ignored-suite.mjs');
const SUITE = 'tests/e2e/create-database.spec.ts';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'classify-ignored-suite-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-q', '-m', 'baseline');
  mkdirSync(join(dir, 'tests', 'e2e'), { recursive: true });
  writeFileSync(join(dir, SUITE), 'test("x", () => {});\n');
  return dir;
}

function run(...args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function classify(repo, path = SUITE) {
  const res = run(`--path=${path}`, `--repo=${repo}`);
  assert.equal(res.code, 0, res.stderr);
  return JSON.parse(res.stdout);
}

describe('classify-ignored-suite — not ignored', () => {
  test('a suite with no matching rule commits normally', () => {
    const repo = setupRepo();
    assert.deepEqual(classify(repo), {
      status: 'not_ignored',
      rule: null,
      source: null,
      action: 'commit',
      caveat: null,
    });
  });

  test('an already-tracked suite is not ignored even when a rule matches', () => {
    const repo = setupRepo();
    writeFileSync(join(repo, '.gitignore'), 'tests/e2e/\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'add', '-f', SUITE);
    git(repo, 'commit', '-q', '-m', 'track suite');
    const out = classify(repo);
    assert.equal(out.status, 'not_ignored');
    assert.equal(out.action, 'commit');
  });
});

describe('classify-ignored-suite — local uncommitted rule', () => {
  test('.git/info/exclude yields force_add with a caveat naming the override and rule', () => {
    const repo = setupRepo();
    writeFileSync(join(repo, '.git', 'info', 'exclude'), 'tests/e2e/*.spec.ts\n');
    const out = classify(repo);
    assert.equal(out.status, 'local_rule');
    assert.equal(out.action, 'force_add');
    assert.equal(out.rule, 'tests/e2e/*.spec.ts');
    assert.equal(out.source, '.git/info/exclude:1');
    assert.match(out.caveat, /force-added/);
    assert.match(out.caveat, /tests\/e2e\/\*\.spec\.ts/);
    assert.match(out.caveat, /\.git\/info\/exclude:1/);
  });

  test('an untracked .gitignore yields force_add', () => {
    const repo = setupRepo();
    writeFileSync(join(repo, '.gitignore'), '# local only\ntests/e2e/\n');
    const out = classify(repo);
    assert.equal(out.status, 'local_rule');
    assert.equal(out.action, 'force_add');
    assert.equal(out.rule, 'tests/e2e/');
    assert.equal(out.source, '.gitignore:2');
    assert.match(out.caveat, new RegExp(SUITE.replace(/[.*]/g, '\\$&')));
  });
});

describe('classify-ignored-suite — committed repo rule', () => {
  test('a tracked .gitignore yields leave_uncommitted with a disclosure caveat', () => {
    const repo = setupRepo();
    writeFileSync(join(repo, '.gitignore'), 'tests/e2e/\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-q', '-m', 'ignore e2e');
    const out = classify(repo);
    assert.equal(out.status, 'repo_rule');
    assert.equal(out.action, 'leave_uncommitted');
    assert.equal(out.rule, 'tests/e2e/');
    assert.equal(out.source, '.gitignore:1');
    assert.match(out.caveat, /not part of this PR/);
    assert.match(out.caveat, new RegExp(SUITE.replace(/[.*]/g, '\\$&')));
  });

  test('a tracked nested .gitignore is still a repo rule', () => {
    const repo = setupRepo();
    writeFileSync(join(repo, 'tests', '.gitignore'), 'e2e/\n');
    git(repo, 'add', 'tests/.gitignore');
    git(repo, 'commit', '-q', '-m', 'nested ignore');
    const out = classify(repo);
    assert.equal(out.status, 'repo_rule');
    assert.equal(out.source, 'tests/.gitignore:1');
  });
});

describe('classify-ignored-suite — argument validation', () => {
  test('missing --path exits 2', () => {
    const repo = setupRepo();
    const res = run(`--repo=${repo}`);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--path/);
  });

  test('missing --repo exits 2', () => {
    const res = run(`--path=${SUITE}`);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--repo/);
  });

  test('a --repo that is not a directory exits 2', () => {
    const res = run(`--path=${SUITE}`, '--repo=/nonexistent/jlu/repo');
    assert.equal(res.code, 2);
    assert.match(res.stderr, /not found or not a directory/);
  });

  test('a valueless --path exits 2', () => {
    const repo = setupRepo();
    const res = run('--path', `--repo=${repo}`);
    assert.equal(res.code, 2);
  });
});

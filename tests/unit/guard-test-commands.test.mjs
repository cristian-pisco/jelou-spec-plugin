// tests/unit/guard-test-commands.test.mjs
//
// Run: `node --test tests/unit/guard-test-commands.test.mjs`
// Node 20+ required.
//
// Covers the PreToolUse Bash guard that deterministically blocks uncapped
// test invocations (the prompts in subagent-base.md state the same policy;
// the guard enforces it even when an agent disobeys).

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyCommand } from '../../bin/guard-test-commands.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCRIPTS = {
  '/svc': {
    test: 'jest --config ./test/jest.config.ts',
    'test:unit': 'jest --testPathPattern=unit',
    'test:watch': 'jest --watch',
    'test:cov': 'jest --coverage',
    'test:safe': 'jest --runInBand',
  },
  '/plugin': { test: 'node --test tests/unit/*.test.mjs' },
  '/mocha-svc': { test: "mocha 'test/**/*.test.js'" },
  '/vitest-svc': { test: 'vitest' },
};

const ctx = (cwd = '/svc') => ({
  cwd,
  resolveScript: (dir, name) => SCRIPTS[dir]?.[name] ?? null,
});

const expectDeny = (command, cwd) => {
  const verdict = classifyCommand(command, ctx(cwd));
  assert.equal(verdict.decision, 'deny', `expected deny for: ${command}`);
  assert.match(verdict.reason, /jlu resource guard/);
  return verdict.reason;
};

const expectAllow = (command, cwd) => {
  const verdict = classifyCommand(command, ctx(cwd));
  assert.equal(verdict.decision, 'allow', `expected allow for: ${command} (got: ${verdict.reason})`);
};

describe('guard — bare package test scripts', () => {
  test('blocks npm test when the script is an uncapped jest run', () => {
    const reason = expectDeny('npm test');
    assert.match(reason, /worker cap/);
  });

  test('blocks the exact invocation that froze the machine', () => {
    expectDeny('npm test --no-coverage');
  });

  test('blocks npm run test:unit without forwarded cap', () => {
    expectDeny('npm run test:unit');
  });

  test('blocks pnpm/yarn test when the script is uncapped', () => {
    expectDeny('pnpm test');
    expectDeny('yarn test');
  });

  test('blocks npm test -- with files but no cap', () => {
    expectDeny('npm test -- src/a.spec.ts');
  });

  test('blocks watch and coverage scripts outright', () => {
    assert.match(expectDeny('npm run test:watch'), /watch/);
    assert.match(expectDeny('npm run test:cov'), /coverage/);
  });

  test('blocks when the script cannot be resolved', () => {
    expectDeny('npm test', '/nowhere');
  });

  test('allows npm test -- files with cap forwarded', () => {
    expectAllow('npm test -- src/a.spec.ts --maxWorkers=2');
  });

  test('allows pnpm test with cap (pnpm forwards args without --)', () => {
    expectAllow('pnpm test src/a.spec.ts --maxWorkers=2');
  });

  test('allows bare npm test when the script is node --test', () => {
    expectAllow('npm test', '/plugin');
  });

  test('allows bare npm test when the script is serial mocha', () => {
    expectAllow('npm test', '/mocha-svc');
  });

  test('allows bare npm test when the script is already capped', () => {
    expectAllow('npm run test:safe');
  });
});

describe('guard — direct runner invocations', () => {
  test('blocks uncapped jest, with and without files', () => {
    expectDeny('npx jest');
    expectDeny('npx jest src/a.spec.ts');
    expectDeny('jest --config ./test/jest.config.ts');
  });

  test('blocks jest with maxWorkers above the cap or percentage', () => {
    expectDeny('npx jest src/a.spec.ts --maxWorkers=8');
    expectDeny('npx jest src/a.spec.ts --maxWorkers=50%');
  });

  test('allows capped jest forms', () => {
    expectAllow('npx jest src/a.spec.ts --maxWorkers=2');
    expectAllow('npx jest src/a.spec.ts --maxWorkers 2');
    expectAllow('npx jest src/a.spec.ts --runInBand');
    expectAllow('node ./node_modules/.bin/jest src/a.spec.ts -i');
  });

  test('blocks watch mode even when capped', () => {
    expectDeny('npx jest src/a.spec.ts --watch --maxWorkers=2');
    expectDeny('npx vitest --watch');
    expectDeny('tsc --watch');
  });

  test('blocks coverage even when capped', () => {
    expectDeny('npx jest src/a.spec.ts --coverage --maxWorkers=2');
  });

  test('blocks bare vitest (watch mode) and uncapped vitest run', () => {
    expectDeny('npx vitest');
    expectDeny('npx vitest run');
    expectDeny('pnpm vitest run src/a.test.ts');
  });

  test('allows capped single-pass vitest, including Step 8b related form', () => {
    expectAllow('npx vitest run src/a.test.ts --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=2');
    expectAllow('npx vitest related src/a.ts --pool=threads --poolOptions.threads.maxThreads=2 --run');
    expectAllow('npx vitest run src/a.test.ts --no-file-parallelism');
  });

  test('blocks playwright test without workers, allows capped, ignores other subcommands', () => {
    expectDeny('npx playwright test');
    expectDeny('npx playwright test tests/e2e/flow.spec.ts');
    expectAllow('npx playwright test tests/e2e/flow.spec.ts --workers=1');
    expectAllow('npx playwright install chromium');
  });

  test('pytest: serial allowed, capped xdist allowed, fan-out blocked', () => {
    expectAllow('pytest path/to/test.py');
    expectAllow('pytest path/to/test.py -n 2');
    expectDeny('pytest -n auto');
    expectDeny('pytest -n 8');
  });

  test('allows single-pass tsc and node --test', () => {
    expectAllow('tsc --noEmit');
    expectAllow('node --test tests/unit/foo.test.mjs');
  });

  test('sees through env assignments and wrappers', () => {
    expectDeny('cross-env NODE_ENV=testing npx jest src/a.spec.ts');
    expectDeny('NODE_ENV=test jest src/a.spec.ts');
    expectAllow('nice -n 19 npx jest src/a.spec.ts --maxWorkers=2');
    expectDeny('pnpm exec jest src/a.spec.ts');
  });
});

describe('guard — compound commands and false-positive safety', () => {
  test('tracks cd before the test command', () => {
    expectDeny('cd /svc && npm test', '/');
    expectAllow('cd /plugin && npm test', '/');
  });

  test('classifies each segment of a compound command', () => {
    expectDeny('npm install && npm test');
    expectAllow('npx jest src/a.spec.ts --maxWorkers=2 2>&1 | tail -200');
  });

  test('quoted separators do not split the cap away', () => {
    expectAllow('npx jest -t "a && b" src/a.spec.ts --maxWorkers=2');
  });

  test('ignores commands that merely mention runners or scripts', () => {
    expectAllow('grep jest package.json');
    expectAllow('cat jest.config.ts');
    expectAllow('echo "npm test"');
    expectAllow('git commit -m "fix npm test invocation"');
    expectAllow('npm install -D @playwright/test');
    expectAllow('npm run build');
    expectAllow('npm run sync-agents');
    expectAllow('ls tests/unit');
  });
});

describe('guard — plugin wiring', () => {
  test('hooks/hooks.json registers the guard on Bash PreToolUse', () => {
    const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks/hooks.json'), 'utf8'));
    const bash = hooks.hooks.PreToolUse.find((h) => h.matcher === 'Bash');
    assert.ok(bash, 'Bash matcher must exist');
    const guard = bash.hooks.find((h) => /guard-test-commands\.mjs/.test(h.command));
    assert.ok(guard, 'guard-test-commands must be wired on Bash');
    assert.match(guard.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  });

  test('plugin manifest points at the hooks file', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(manifest.hooks, './hooks/hooks.json');
    assert.ok(existsSync(join(ROOT, 'bin/guard-test-commands.mjs')));
  });
});

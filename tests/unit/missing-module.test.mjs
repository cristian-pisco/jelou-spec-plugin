import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseMissingModule,
  packageNameFromSpecifier,
  classifyMissingModule,
  planMissingModuleFix
} from '../../bin/lib/dev-orchestrator/missing-module.mjs';

describe('parseMissingModule', () => {
  test('reads the package out of the workflows-service failure verbatim', () => {
    const capture = [
      'workflows-service | > nest start --watch',
      "workflows-service | Error: Cannot find module '@jeloulatam/clickhouse-warehouse'",
      'workflows-service |     at Module._resolveFilename (node:internal/modules/cjs/loader:1146:15)'
    ].join('\n');
    assert.deepEqual(parseMissingModule(capture), {
      specifier: '@jeloulatam/clickhouse-warehouse',
      packageName: '@jeloulatam/clickhouse-warehouse'
    });
  });

  test('a deep import resolves to the installable package, not the subpath', () => {
    assert.equal(parseMissingModule("Cannot find module 'lodash/fp/merge'").packageName, 'lodash');
    assert.equal(
      parseMissingModule("Cannot find module '@scope/pkg/dist/index.js'").packageName,
      '@scope/pkg'
    );
  });

  test('ESM and bundler phrasings are recognised too', () => {
    assert.equal(parseMissingModule("Cannot find package 'zod' imported from /app/main.js").packageName, 'zod');
    assert.equal(
      parseMissingModule("Module not found: Error: Can't resolve 'react-dom' in '/app/src'").packageName,
      'react-dom'
    );
  });

  test('a relative import is not a dependency problem', () => {
    assert.equal(parseMissingModule("Cannot find module './services/user.service'"), null);
    assert.equal(parseMissingModule("Cannot find module '/app/dist/main'"), null);
    assert.equal(parseMissingModule("Cannot find module 'node:sqlite'"), null);
  });

  test('an unrelated capture yields nothing', () => {
    assert.equal(parseMissingModule('EADDRINUSE: address already in use :::8686'), null);
    assert.equal(parseMissingModule(''), null);
    assert.equal(parseMissingModule(null), null);
  });
});

describe('packageNameFromSpecifier', () => {
  test('scoped packages keep exactly two segments', () => {
    assert.equal(packageNameFromSpecifier('@jeloulatam/jwt-s2s-auth'), '@jeloulatam/jwt-s2s-auth');
  });

  test('aliases and self-references are rejected', () => {
    assert.equal(packageNameFromSpecifier('#internal/db'), null);
    assert.equal(packageNameFromSpecifier('~/lib'), null);
    assert.equal(packageNameFromSpecifier('   '), null);
  });
});

describe('classifyMissingModule', () => {
  test('a declared but absent package is an install', () => {
    const v = classifyMissingModule({
      packageName: '@jeloulatam/clickhouse-warehouse',
      declaredDependencies: ['@nestjs/core', '@jeloulatam/clickhouse-warehouse']
    });
    assert.equal(v.action, 'install');
  });

  test('an undeclared package is a broken import, never an install', () => {
    const v = classifyMissingModule({
      packageName: 'left-pad',
      declaredDependencies: ['@nestjs/core']
    });
    assert.equal(v.action, 'escalate');
    assert.match(v.reason, /broken import/);
  });

  test('an unreadable package.json escalates rather than guessing', () => {
    assert.equal(classifyMissingModule({ packageName: 'x', declaredDependencies: null }).action, 'escalate');
  });

  test('no package name falls through to the diagnoser', () => {
    assert.equal(classifyMissingModule({ packageName: null, declaredDependencies: [] }).action, 'diagnose');
  });
});

describe('planMissingModuleFix', () => {
  test('the command follows the declared manager, not npm-by-habit', () => {
    const fix = planMissingModuleFix({
      packageName: '@jeloulatam/clickhouse-warehouse',
      packageManager: 'pnpm',
      composeFile: './docker-compose.yml',
      composeService: 'app'
    });
    assert.equal(
      fix.command,
      'docker compose -f ./docker-compose.yml exec app pnpm add @jeloulatam/clickhouse-warehouse'
    );
    assert.equal(fix.runs_in, 'container');
  });

  test('every supported manager gets its own add syntax', () => {
    const of = (pm) => planMissingModuleFix({
      packageName: 'zod', packageManager: pm, composeFile: 'c.yml', composeService: 's'
    }).command;
    assert.match(of('npm'), /npm install zod$/);
    assert.match(of('yarn'), /yarn add zod$/);
    assert.match(of('pnpm'), /pnpm add zod$/);
    assert.match(of('bun'), /bun add zod$/);
  });

  test('a custom exec template is honoured', () => {
    const fix = planMissingModuleFix({
      packageName: 'zod',
      packageManager: 'pnpm',
      composeFile: 'c.yml',
      composeService: 's',
      execTemplate: 'docker exec {compose_service} sh -lc "{cmd}"'
    });
    assert.equal(fix.command, 'docker exec s sh -lc "pnpm add zod"');
  });

  test('it refuses to compose anything without a manager', () => {
    assert.throws(() => planMissingModuleFix({ packageName: 'zod', packageManager: null }), /package manager/);
    assert.throws(() => planMissingModuleFix({ packageName: null, packageManager: 'pnpm' }), /package name/);
  });
});

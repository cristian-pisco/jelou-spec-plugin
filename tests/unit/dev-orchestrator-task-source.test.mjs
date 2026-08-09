import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { inspectGitSource, resolveTaskSources } from '../../bin/lib/dev-orchestrator/task-source.mjs';

function service(id, path) {
  return { id, path };
}

describe('resolveTaskSources — worktree task source', () => {
  test('reports the exact affected worktree path and commit selected for boot', () => {
    const slug = 'source-task';
    const canonicalPath = '/repos/api-service';
    const sourcePath = `${canonicalPath}/.worktrees/${slug}`;
    const taskContext = {
      slug,
      mode: 'worktree',
      affectedServices: [{ id: 'api-service', branch: `production/${slug}` }],
    };
    const inspectGit = (path) => ({
      topLevel: path,
      commit: '9e218c72837b809095b7293a57d1807485c1f7ac',
      branch: `production/${slug}`,
      worktrees: [{ path, branch: `production/${slug}`, prunable: false }],
    });

    const sources = resolveTaskSources({
      sourceMode: 'task-aware',
      registry: { services: [service('api-service', canonicalPath)] },
      taskContext,
      inspectGit,
      pathExists: () => true,
    });

    assert.deepEqual(sources, [{
      mode: 'worktree',
      taskSlug: slug,
      serviceId: 'api-service',
      affected: true,
      sourcePath,
      commit: '9e218c72837b809095b7293a57d1807485c1f7ac',
      branch: `production/${slug}`,
      ownership: 'task',
    }]);
  });
});

describe('resolveTaskSources — realistic branch hybrid', () => {
  test('uses task branches for affected services and canonical main sources for unaffected services', () => {
    const slug = 'source-task';
    const taskBranch = `production/${slug}`;
    const gitByPath = new Map([
      ['/repos/api-service', { topLevel: '/repos/api-service', commit: '1111111111111111111111111111111111111111', branch: taskBranch }],
      ['/repos/dashboard-server', { topLevel: '/repos/dashboard-server', commit: '2222222222222222222222222222222222222222', branch: 'main' }],
      ['/repos/jelou-apps', { topLevel: '/repos/jelou-apps', commit: '3333333333333333333333333333333333333333', branch: taskBranch }],
    ]);

    const sources = resolveTaskSources({
      sourceMode: 'task-aware',
      registry: {
        services: [
          service('api-service', '/repos/api-service'),
          service('dashboard-server', '/repos/dashboard-server'),
          service('jelou-apps', '/repos/jelou-apps'),
        ],
      },
      taskContext: {
        slug,
        mode: 'branch',
        affectedServices: [
          { id: 'api-service', branch: taskBranch },
          { id: 'jelou-apps', branch: taskBranch },
        ],
      },
      inspectGit: (path) => gitByPath.get(path),
      pathExists: () => true,
    });

    assert.deepEqual(sources, [
      {
        mode: 'branch',
        taskSlug: slug,
        serviceId: 'api-service',
        affected: true,
        sourcePath: '/repos/api-service',
        commit: '1111111111111111111111111111111111111111',
        branch: taskBranch,
        ownership: 'task',
      },
      {
        mode: 'main',
        taskSlug: null,
        serviceId: 'dashboard-server',
        affected: false,
        sourcePath: '/repos/dashboard-server',
        commit: '2222222222222222222222222222222222222222',
        branch: 'main',
        ownership: 'main',
      },
      {
        mode: 'branch',
        taskSlug: slug,
        serviceId: 'jelou-apps',
        affected: true,
        sourcePath: '/repos/jelou-apps',
        commit: '3333333333333333333333333333333333333333',
        branch: taskBranch,
        ownership: 'task',
      },
    ]);
  });
});

describe('resolveTaskSources — task source rejection', () => {
  const slug = 'source-task';
  const branch = `production/${slug}`;
  const canonicalPath = '/repos/api-service';
  const sourcePath = `${canonicalPath}/.worktrees/${slug}`;
  const input = {
    sourceMode: 'task-aware',
    registry: { services: [service('api-service', canonicalPath)] },
    taskContext: {
      slug,
      mode: 'worktree',
      affectedServices: [{ id: 'api-service', branch }],
    },
    pathExists: () => true,
  };

  test('rejects a missing affected task source without falling back to main', () => {
    assert.throws(
      () => resolveTaskSources({ ...input, pathExists: () => false, inspectGit: () => assert.fail('Git inspection must not run') }),
      (error) => /missing/i.test(error.message)
        && /api-service/.test(error.message)
        && /\.worktrees\/source-task/.test(error.message),
    );
  });

  test('rejects a stale affected worktree registration', () => {
    assert.throws(
      () => resolveTaskSources({
        ...input,
        inspectGit: () => ({ topLevel: sourcePath, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', branch, worktrees: [] }),
      }),
      /api-service.*stale.*source-task/i,
    );
  });

  test('rejects a task source whose Git top-level differs from the selected worktree path', () => {
    assert.throws(
      () => resolveTaskSources({
        ...input,
        inspectGit: () => ({
          topLevel: '/repos/api-service',
          commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          branch,
          worktrees: [{ path: sourcePath, branch, prunable: false }],
        }),
      }),
      /api-service.*path mismatch.*\.worktrees\/source-task.*\/repos\/api-service/i,
    );
  });

  test('rejects a prunable task worktree before returning any source descriptor', () => {
    assert.throws(
      () => resolveTaskSources({
        ...input,
        inspectGit: () => ({
          topLevel: sourcePath,
          commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          branch,
          worktrees: [{ path: sourcePath, branch, prunable: true }],
        }),
      }),
      /api-service.*stale.*source-task/i,
    );
  });

  test('rejects a detached affected task source', () => {
    assert.throws(
      () => resolveTaskSources({
        ...input,
        inspectGit: () => ({
          topLevel: sourcePath,
          commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          branch: null,
          worktrees: [{ path: sourcePath, branch, prunable: false }],
        }),
      }),
      /api-service.*detached.*production\/source-task/i,
    );
  });

  test('rejects an affected source checked out on a different task branch', () => {
    assert.throws(
      () => resolveTaskSources({
        ...input,
        inspectGit: () => ({
          topLevel: sourcePath,
          commit: 'cccccccccccccccccccccccccccccccccccccccc',
          branch: 'production/another-task',
          worktrees: [{ path: sourcePath, branch: 'production/another-task', prunable: false }],
        }),
      }),
      /api-service.*production\/source-task.*production\/another-task/i,
    );
  });

  test('rejects task metadata that names an unregistered affected service', () => {
    assert.throws(
      () => resolveTaskSources({
        ...input,
        taskContext: {
          ...input.taskContext,
          affectedServices: [{ id: 'missing-service', branch }],
        },
        inspectGit: () => ({
          topLevel: canonicalPath,
          commit: 'dddddddddddddddddddddddddddddddddddddddd',
          branch: 'main',
          worktrees: [],
        }),
      }),
      /missing-service.*not registered/i,
    );
  });

  test('rejects an unsupported task execution mode', () => {
    assert.throws(
      () => resolveTaskSources({
        ...input,
        taskContext: { ...input.taskContext, mode: 'archive' },
        inspectGit: () => ({
          topLevel: canonicalPath,
          commit: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          branch,
          worktrees: [],
        }),
      }),
      /unsupported task mode.*archive.*worktree.*branch/i,
    );
  });
});

describe('inspectGitSource', () => {
  test('reports the exact commit, branch, top-level path, and registered worktrees', () => {
    const sourcePath = '/repos/api-service/.worktrees/source-task';
    const outputs = new Map([
      ['rev-parse --show-toplevel', `${sourcePath}\n`],
      ['rev-parse --verify HEAD', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n'],
      ['symbolic-ref --quiet --short HEAD', 'production/source-task\n'],
      ['worktree list --porcelain', `worktree /repos/api-service
HEAD ffffffffffffffffffffffffffffffffffffffff
branch refs/heads/main

worktree ${sourcePath}
HEAD eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
branch refs/heads/production/source-task

`],
    ]);
    const run = (_binary, args) => ({ status: 0, stdout: outputs.get(args.slice(2).join(' ')) });

    const inspected = inspectGitSource(sourcePath, { run });

    assert.deepEqual(inspected, {
      topLevel: sourcePath,
      commit: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      branch: 'production/source-task',
      worktrees: [
        { path: '/repos/api-service', branch: 'main', prunable: false },
        { path: sourcePath, branch: 'production/source-task', prunable: false },
      ],
    });
  });
});

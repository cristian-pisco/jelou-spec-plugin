import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function worktreeRecords(porcelain) {
  return porcelain.trim().split(/\n\s*\n/).filter(Boolean).map((block) => {
    const lines = block.split('\n');
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branchLine = lines.find((line) => line.startsWith('branch '));
    return {
      path,
      branch: branchLine ? branchLine.slice('branch refs/heads/'.length) : null,
      prunable: lines.some((line) => line.startsWith('prunable')),
    };
  });
}

export function inspectGitSource(sourcePath, { run = spawnSync } = {}) {
  const invoke = (args) => run('git', ['-C', sourcePath, ...args], { encoding: 'utf8' });
  const topLevel = invoke(['rev-parse', '--show-toplevel']);
  const commit = invoke(['rev-parse', '--verify', 'HEAD']);
  if (topLevel.status !== 0 || commit.status !== 0) throw new Error(`invalid Git source at ${sourcePath}`);
  const branch = invoke(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const worktrees = invoke(['worktree', 'list', '--porcelain']);
  return {
    topLevel: topLevel.stdout.trim(),
    commit: commit.stdout.trim(),
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    worktrees: worktrees.status === 0 ? worktreeRecords(worktrees.stdout) : [],
  };
}

function validateTaskSource({ serviceId, sourcePath, taskMode, expectedBranch, git }) {
  if (!git.branch) throw new Error(`${serviceId} task source is detached; expected ${expectedBranch}`);
  if (git.branch !== expectedBranch) {
    throw new Error(`${serviceId} expected task branch ${expectedBranch} but source is on ${git.branch}`);
  }
  if (git.topLevel !== sourcePath) {
    throw new Error(`${serviceId} task source path mismatch: expected ${sourcePath}, Git reports ${git.topLevel}`);
  }
  if (taskMode !== 'worktree') return;
  const record = (git.worktrees || []).find((worktree) => worktree.path === sourcePath);
  if (!record || record.prunable || record.branch !== expectedBranch) {
    throw new Error(`${serviceId} has stale worktree registration for ${sourcePath}`);
  }
}

export function resolveTaskSources({ sourceMode, registry, taskContext, inspectGit = inspectGitSource, pathExists = existsSync }) {
  if (sourceMode === 'task-aware' && !['worktree', 'branch'].includes(taskContext?.mode)) {
    throw new Error(`unsupported task mode ${String(taskContext?.mode)}; expected worktree or branch`);
  }
  const registered = new Set(registry.services.map((service) => service.id));
  for (const service of taskContext?.affectedServices || []) {
    if (!registered.has(service.id)) throw new Error(`${service.id} is affected by the task but not registered`);
  }
  const affected = new Map((taskContext?.affectedServices || []).map((service) => [service.id, service]));
  return registry.services.map((service) => {
    const taskService = affected.get(service.id);
    const sourcePath = sourceMode === 'task-aware' && taskService && taskContext.mode === 'worktree'
      ? join(service.path, '.worktrees', taskContext.slug)
      : service.path;
    if (!pathExists(sourcePath)) throw new Error(`source path is missing for ${service.id}: ${sourcePath}`);
    const git = inspectGit(sourcePath);
    const usesTaskSource = sourceMode === 'task-aware' && Boolean(taskService);
    if (usesTaskSource) {
      validateTaskSource({
        serviceId: service.id,
        sourcePath,
        taskMode: taskContext.mode,
        expectedBranch: taskService.branch,
        git,
      });
    }
    return {
      mode: usesTaskSource ? taskContext.mode : 'main',
      taskSlug: usesTaskSource ? taskContext.slug : null,
      serviceId: service.id,
      affected: Boolean(taskService),
      sourcePath,
      commit: git.commit,
      branch: git.branch,
      ownership: usesTaskSource ? 'task' : 'main',
    };
  });
}

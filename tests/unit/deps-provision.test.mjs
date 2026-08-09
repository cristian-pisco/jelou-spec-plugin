import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  detectLockfile,
  depsVolumeName,
  codeMountTarget,
  shadowingDepsMount,
  resolveDepsProvision
} from '../../bin/lib/boot-engine/deps-provision.mjs';

const WT = '/wt/api-gateway';
const CANON = '/repo/api-gateway';
const LOCK = '{"lockfileVersion":3,"packages":{}}';
const LOCK_HASH = createHash('sha256').update(LOCK).digest('hex').slice(0, 12);
const DEPS_MARKER_ESCAPED = '\\.jlu-lock-hash';

function fs({ files = {}, dirs = [] } = {}) {
  return {
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p) || dirs.includes(p),
    readFile: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null)
  };
}

function bindMounts({ source = CANON, target = '/app', shadow = null } = {}) {
  const mounts = [{ type: 'bind', source, target }];
  if (shadow) mounts.push(shadow);
  return mounts;
}

const anonymousShadow = { type: 'volume', target: '/app/node_modules' };

function base(overrides = {}) {
  return {
    launcher: 'docker-exec',
    serviceId: 'api-gateway-service',
    slug: 'secure-token',
    worktreeDir: WT,
    canonicalPath: CANON,
    mounts: bindMounts(),
    ...overrides
  };
}

describe('detectLockfile', () => {
  test('package-lock.json resolves to npm ci, never npm install', () => {
    const { exists, readFile } = fs({ files: { [`${WT}/package-lock.json`]: LOCK } });
    const lock = detectLockfile(WT, { exists, readFile });
    assert.equal(lock.file, 'package-lock.json');
    assert.equal(lock.installCmd, 'npm ci');
    assert.equal(lock.hash, LOCK_HASH);
  });

  test('yarn.lock and pnpm-lock.yaml resolve to frozen installs', () => {
    const y = fs({ files: { [`${WT}/yarn.lock`]: LOCK } });
    assert.equal(detectLockfile(WT, y).installCmd, 'yarn install --frozen-lockfile');
    const p = fs({ files: { [`${WT}/pnpm-lock.yaml`]: LOCK } });
    assert.equal(detectLockfile(WT, p).installCmd, 'pnpm install --frozen-lockfile');
  });

  test('the install command follows the lockfile, not the dev command runner', () => {
    const { exists, readFile } = fs({ files: { [`${WT}/package-lock.json`]: LOCK } });
    const lock = detectLockfile(WT, { exists, readFile });
    assert.doesNotMatch(lock.installCmd, /yarn/);
  });

  test('no lockfile returns null', () => {
    assert.equal(detectLockfile(WT, fs()), null);
  });

  test('a changed lockfile changes the hash', () => {
    const a = detectLockfile(WT, fs({ files: { [`${WT}/package-lock.json`]: LOCK } }));
    const b = detectLockfile(WT, fs({ files: { [`${WT}/package-lock.json`]: `${LOCK} ` } }));
    assert.notEqual(a.hash, b.hash);
  });
});

describe('mount topology', () => {
  test('codeMountTarget finds the bind for either checkout', () => {
    assert.equal(codeMountTarget(bindMounts({ source: CANON }), [CANON, WT]), '/app');
    assert.equal(codeMountTarget(bindMounts({ source: WT }), [CANON, WT]), '/app');
    assert.equal(codeMountTarget(bindMounts({ source: '/elsewhere' }), [CANON, WT]), null);
  });

  test('shadowingDepsMount detects an anonymous volume over the code mount', () => {
    const mounts = bindMounts({ shadow: anonymousShadow });
    assert.deepEqual(shadowingDepsMount(mounts, '/app'), anonymousShadow);
    assert.equal(shadowingDepsMount(bindMounts(), '/app'), null);
  });
});

describe('depsVolumeName', () => {
  test('is keyed by service, slug and lock hash', () => {
    assert.equal(
      depsVolumeName({ serviceId: 'api-gateway-service', slug: 'secure-token', lockHash: 'abc123' }),
      'jlu-nm-api-gateway-service-secure-token-abc123'
    );
  });

  test('two tasks sharing a lockfile never share a volume', () => {
    const a = depsVolumeName({ serviceId: 's', slug: 'task-a', lockHash: 'h' });
    const b = depsVolumeName({ serviceId: 's', slug: 'task-b', lockHash: 'h' });
    assert.notEqual(a, b);
  });
});

describe('resolveDepsProvision — the api-gateway regression', () => {
  test('an anonymous volume over the code mount is taken over by a lock-keyed named volume', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK },
      dirs: [`${WT}/node_modules`, `${CANON}/node_modules`]
    });
    const p = resolveDepsProvision(base({ mounts: bindMounts({ shadow: anonymousShadow }), exists, readFile }));

    assert.equal(p.source, 'named-volume');
    assert.equal(p.lockFile, 'package-lock.json');
    assert.equal(p.lockHash, LOCK_HASH);
    assert.equal(p.volumeName, `jlu-nm-api-gateway-service-secure-token-${LOCK_HASH}`);
    assert.equal(p.mountTarget, '/app/node_modules');
    assert.equal(p.satisfied, false);
    assert.equal(p.install.runs_in, 'container');
    assert.equal(p.install.cwd, '/app');
    assert.match(p.install.cmd, /npm ci/);
    assert.match(p.install.cmd, new RegExp(LOCK_HASH));
    assert.ok(p.install.timeoutMs >= 300000);
  });

  test('a complete canonical and worktree node_modules does not mask the shadowed volume', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${CANON}/package-lock.json`]: LOCK },
      dirs: [
        `${WT}/node_modules`, `${WT}/node_modules/@nestjs/websockets`, `${WT}/node_modules/socket.io`,
        `${CANON}/node_modules`, `${CANON}/node_modules/@nestjs/websockets`, `${CANON}/node_modules/socket.io`
      ]
    });
    const p = resolveDepsProvision(base({ mounts: bindMounts({ shadow: anonymousShadow }), exists, readFile }));
    assert.notEqual(p, null);
    assert.equal(p.source, 'named-volume');
    assert.equal(p.satisfied, false);
  });

  test('the guarded install is idempotent: it skips when the marker already matches', () => {
    const { exists, readFile } = fs({ files: { [`${WT}/package-lock.json`]: LOCK } });
    const p = resolveDepsProvision(base({ mounts: bindMounts({ shadow: anonymousShadow }), exists, readFile }));
    assert.match(p.install.cmd, /\.jlu-lock-hash/);
    assert.match(p.install.cmd, /exit 0/);
  });

  test('the log redirect wraps only the install, so the marker write is never its target', () => {
    const { exists, readFile } = fs({ files: { [`${WT}/package-lock.json`]: LOCK } });
    const p = resolveDepsProvision(base({ mounts: bindMounts({ shadow: anonymousShadow }), exists, readFile }));
    assert.doesNotMatch(p.install.cmd, new RegExp(`${DEPS_MARKER_ESCAPED} > /tmp`));
    assert.match(p.install.cmd, new RegExp(`\\{ npm ci && printf %s ${LOCK_HASH} > node_modules/\\.jlu-lock-hash; \\} > ${p.install.logPath.replace(/\//g, '\\/')} 2>&1$`));
  });

  test('the guard short-circuits before the redirect, so a warm run preserves the last install log', () => {
    const { exists, readFile } = fs({ files: { [`${WT}/package-lock.json`]: LOCK } });
    const p = resolveDepsProvision(base({ mounts: bindMounts({ shadow: anonymousShadow }), exists, readFile }));
    const guardIndex = p.install.cmd.indexOf('exit 0');
    const redirectIndex = p.install.cmd.indexOf(`> ${p.install.logPath}`);
    assert.ok(guardIndex > -1 && redirectIndex > -1);
    assert.ok(guardIndex < redirectIndex);
  });
});

describe('resolveDepsProvision — mount topologies', () => {
  test('no shadow and a worktree node_modules installs through the bind, in the container', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK },
      dirs: [`${WT}/node_modules`]
    });
    const p = resolveDepsProvision(base({ exists, readFile }));
    assert.equal(p.source, 'worktree-bind');
    assert.equal(p.volumeName, null);
    assert.equal(p.install.runs_in, 'container');
    assert.equal(p.install.cwd, '/app');
  });

  test('an unchanged lockfile keeps the canonical mount and installs nothing', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${CANON}/package-lock.json`]: LOCK },
      dirs: [`${CANON}/node_modules`]
    });
    const p = resolveDepsProvision(base({ exists, readFile }));
    assert.equal(p.source, 'canonical');
    assert.equal(p.satisfied, true);
    assert.equal(p.install, null);
    assert.equal(p.volumeName, null);
  });

  test('a branch that changed the lockfile never mutates the canonical checkout', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${CANON}/package-lock.json`]: '{"other":true}' },
      dirs: [`${CANON}/node_modules`]
    });
    const p = resolveDepsProvision(base({ exists, readFile }));
    assert.equal(p.source, 'named-volume');
    assert.equal(p.install.runs_in, 'container');
    assert.doesNotMatch(p.install.cmd, new RegExp(CANON));
  });

  test('unavailable compose mounts fail open and never install into the canonical checkout', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${CANON}/package-lock.json`]: LOCK },
      dirs: [`${CANON}/node_modules`]
    });
    const p = resolveDepsProvision(base({ mounts: null, exists, readFile }));
    assert.equal(p.source, 'canonical');
    assert.equal(p.install, null);
  });

  test('no lockfile leaves provisioning untouched', () => {
    const { exists, readFile } = fs({ dirs: [`${WT}/node_modules`] });
    assert.equal(resolveDepsProvision(base({ exists, readFile })), null);
  });
});

describe('resolveDepsProvision — host launchers', () => {
  test('installs into the worktree, never the canonical checkout it resolves up into', () => {
    const { exists, readFile } = fs({ files: { [`${WT}/package-lock.json`]: LOCK } });
    const p = resolveDepsProvision(base({ launcher: 'npm', mounts: null, exists, readFile }));
    assert.equal(p.source, 'worktree');
    assert.equal(p.install.runs_in, 'host');
    assert.equal(p.install.cwd, WT);
    assert.equal(p.volumeName, null);
    assert.doesNotMatch(p.install.cmd, new RegExp(CANON));
  });

  test('a matching host marker is already satisfied', () => {
    const { exists, readFile } = fs({
      files: {
        [`${WT}/package-lock.json`]: LOCK,
        [`${WT}/node_modules/.jlu-lock-hash`]: LOCK_HASH
      },
      dirs: [`${WT}/node_modules`]
    });
    const p = resolveDepsProvision(base({ launcher: 'npm', mounts: null, exists, readFile }));
    assert.equal(p.satisfied, true);
    assert.equal(p.install, null);
  });

  test('a stale host marker reinstalls', () => {
    const { exists, readFile } = fs({
      files: {
        [`${WT}/package-lock.json`]: LOCK,
        [`${WT}/node_modules/.jlu-lock-hash`]: 'stale'
      },
      dirs: [`${WT}/node_modules`]
    });
    const p = resolveDepsProvision(base({ launcher: 'npm', mounts: null, exists, readFile }));
    assert.equal(p.satisfied, false);
    assert.equal(p.install.runs_in, 'host');
  });
});

describe('resolveDepsProvision — adopting a working host install', () => {
  const PKG = JSON.stringify({ dependencies: { a: '1', b: '1' }, devDependencies: { chokidar: '4' } });

  test('a complete host node_modules is adopted instead of wiped by a reinstall', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${WT}/package.json`]: PKG },
      dirs: [`${WT}/node_modules`, `${WT}/node_modules/a`, `${WT}/node_modules/b`, `${WT}/node_modules/chokidar`]
    });
    const p = resolveDepsProvision(base({ exists, readFile }));
    assert.equal(p.source, 'worktree-bind');
    assert.equal(p.satisfied, true);
    assert.equal(p.adopted, true);
    assert.equal(p.install, null);
    assert.deepEqual(p.missing, []);
  });

  test('an incomplete host node_modules still installs and names what is missing', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${WT}/package.json`]: PKG },
      dirs: [`${WT}/node_modules`, `${WT}/node_modules/a`]
    });
    const p = resolveDepsProvision(base({ exists, readFile }));
    assert.equal(p.satisfied, false);
    assert.equal(p.adopted, false);
    assert.deepEqual(p.missing, ['b', 'chokidar']);
    assert.equal(p.install.runs_in, 'container');
  });

  test('a matching marker wins without re-walking the dependency list', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${WT}/node_modules/.jlu-lock-hash`]: LOCK_HASH },
      dirs: [`${WT}/node_modules`]
    });
    const p = resolveDepsProvision(base({ exists, readFile }));
    assert.equal(p.satisfied, true);
    assert.equal(p.adopted, false);
  });

  test('adoption applies to host launchers too, never redirecting at the canonical checkout', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${WT}/package.json`]: PKG },
      dirs: [`${WT}/node_modules`, `${WT}/node_modules/a`, `${WT}/node_modules/b`, `${WT}/node_modules/chokidar`]
    });
    const p = resolveDepsProvision(base({ launcher: 'npm', mounts: null, exists, readFile }));
    assert.equal(p.source, 'worktree');
    assert.equal(p.adopted, true);
    assert.equal(p.install, null);
  });

  test('a named volume is never adopted — the host cannot see inside it', () => {
    const { exists, readFile } = fs({
      files: { [`${WT}/package-lock.json`]: LOCK, [`${WT}/package.json`]: PKG },
      dirs: [`${WT}/node_modules`, `${WT}/node_modules/a`, `${WT}/node_modules/b`, `${WT}/node_modules/chokidar`]
    });
    const p = resolveDepsProvision(base({ mounts: bindMounts({ shadow: anonymousShadow }), exists, readFile }));
    assert.equal(p.source, 'named-volume');
    assert.equal(p.adopted, false);
    assert.equal(p.satisfied, false);
    assert.ok(p.install);
  });
});

describe('resolveDepsProvision — image-sourced dependencies', () => {
  function imagePlan() {
    const { exists, readFile } = fs({
      files: { [`${WT}/pnpm-lock.yaml`]: LOCK },
      dirs: [`${WT}/node_modules`]
    });
    return resolveDepsProvision(base({
      launcher: 'docker',
      mounts: bindMounts({ shadow: anonymousShadow }),
      exists,
      readFile
    }));
  }

  test('a self-starting launcher over a shadowed node_modules reconciles instead of trusting the image', () => {
    const p = imagePlan();
    assert.equal(p.source, 'image');
    assert.equal(p.satisfied, false);
    assert.equal(p.install.runs_in, 'container');
    assert.equal(p.install.cwd, '/app');
    assert.match(p.install.cmd, /pnpm install --frozen-lockfile/);
  });

  test('the reconcile install is marker-guarded, so a warm boot stays a no-op', () => {
    assert.match(imagePlan().install.cmd, new RegExp(`${DEPS_MARKER_ESCAPED}.*${LOCK_HASH}`));
  });

  test('no provisioning decision carries an unverified escape hatch any more', () => {
    assert.equal('unverified' in imagePlan(), false);
  });
});

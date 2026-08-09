import { spawnSync } from 'node:child_process';

function defaultRun(command, args, options) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function keyArgs(identity) {
  return ['service', 'jlu-local-auth', 'account', identity];
}

function keyringFailure(action) {
  return new Error(`operating-system keyring ${action} failed; install and unlock a Secret Service keyring, then retry`);
}

const AVAILABILITY_PROBE_IDENTITY = 'jlu-keyring-availability-probe';

export function createOsKeyring({ run = defaultRun } = {}) {
  return {
    isAvailable() {
      const result = run('secret-tool', ['lookup', ...keyArgs(AVAILABILITY_PROBE_IDENTITY)], { encoding: 'utf8' });
      if (!result || result.error) return false;
      if (result.status === 0) return true;
      if (result.status !== 1) return false;
      return String(result.stderr || '').trim().length === 0;
    },
    read(identity) {
      const result = run('secret-tool', ['lookup', ...keyArgs(identity)], { encoding: 'utf8' });
      if (result.status === 1) return null;
      if (result.status !== 0) throw keyringFailure('lookup');
      return String(result.stdout).replace(/\r?\n$/, '');
    },
    replace(identity, password) {
      const result = run('secret-tool', ['store', '--label=Jelou local auth', ...keyArgs(identity)], { encoding: 'utf8', input: password });
      if (result.status !== 0) throw keyringFailure('write');
    },
    remove(identity) {
      const result = run('secret-tool', ['clear', ...keyArgs(identity)], { encoding: 'utf8' });
      if (result.status !== 0) throw keyringFailure('removal');
    },
  };
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CHECKS = [
  { id: 'opencode', script: 'bin/sync-agents.mjs', label: '.opencode/ mirror' },
  { id: 'codex', script: 'bin/sync-codex.mjs', label: '.codex/ mirror' },
];

export function checkMirrors({ root, exec }) {
  const findings = [];
  for (const { id, script, label } of CHECKS) {
    if (!existsSync(join(root, script))) continue;
    try {
      exec('node', [script, '--check'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      findings.push({
        id: `mirror-drift-${id}`,
        severity: 'error',
        message: `${label} is out of sync with agents/ and skills/, so ${id} would load stale content`,
        fix: 'npm run sync',
      });
    }
  }
  return findings;
}

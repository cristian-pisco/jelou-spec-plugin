import { detectPackageManager, commandManager } from './package-manager.mjs';

export function devCommandMismatches(services, { detect = detectPackageManager } = {}) {
  const out = [];
  for (const svc of services || []) {
    const command = svc && svc.dev && svc.dev.command;
    const declared = commandManager(command);
    if (!declared || !svc.path) continue;
    const repo = detect(svc.path);
    if (!repo || repo === declared) continue;
    out.push({ id: svc.id, path: svc.path, command, declaredManager: declared, repoManager: repo });
  }
  return out;
}

export function mismatchReport(mismatches) {
  return mismatches
    .map((m) => `  ${m.id}: declares "${m.command}" (${m.declaredManager}) but the repo is a ${m.repoManager} project`)
    .join('\n');
}

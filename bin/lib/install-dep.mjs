// bin/lib/install-dep.mjs
//
// Pure planner for runtime-aware dependency installation. Given a service config
// (from jlu-services.json) and the packages to install, return an ordered command
// plan. Host-runtime services install on the host (current behavior); docker-compose
// services install INSIDE their container, booting it first if it is not running.
//
// The package manager is DETECTED from the lockfile, never assumed.
//
// No execution and no I/O beyond reading the lockfile via detectPackageManager.
// The executor (bin/install-dep.mjs) runs the steps.

import { detectPackageManager } from '../derive-dev-block.mjs';
import { DEFAULT_EXEC_TEMPLATE, substituteExecTemplate } from './runtime-exec.mjs';

// npm/bun use `install`/`add`; yarn/pnpm use `add`. Dev flag differs only in spelling.
function installCommand(pm, packages, dev) {
  const pkgs = packages.join(' ');
  switch (pm) {
    case 'yarn': return `yarn add ${dev ? '-D ' : ''}${pkgs}`;
    case 'pnpm': return `pnpm add ${dev ? '-D ' : ''}${pkgs}`;
    case 'bun':  return `bun add ${dev ? '-d ' : ''}${pkgs}`;
    case 'npm':
    default:     return `npm install ${dev ? '-D ' : ''}${pkgs}`;
  }
}

export function planInstall({ service, serviceDir, packages, dev = false }) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('planInstall requires at least one package');
  }

  const pm = detectPackageManager(serviceDir) || 'npm';
  const install = installCommand(pm, packages, dev);
  const runtime = (service && service.runtime && service.runtime.type) || 'host';
  const warnings = [];

  if (runtime !== 'docker-compose') {
    return {
      runtime: 'host',
      packageManager: pm,
      warnings,
      steps: [{ kind: 'install', runs_in: 'host', cmd: install, cwd: serviceDir }]
    };
  }

  const { compose_file: composeFile, compose_service: composeService } = service.runtime;
  const execTemplate = service.runtime.exec_template || DEFAULT_EXEC_TEMPLATE;

  if (!detectPackageManager(serviceDir)) {
    warnings.push(
      `no node lockfile detected in ${serviceDir}; assuming npm. ` +
      'pip/go installs inside the container are not auto-supported — install manually via exec_template.'
    );
  }

  const checkCmd = `docker compose -f ${composeFile} ps --status running --services`;
  const bootCmd = `docker compose -f ${composeFile} up -d ${composeService}`;
  const installCmd = substituteExecTemplate(execTemplate, {
    composeFile,
    composeService,
    cmd: install
  });

  return {
    runtime: 'docker-compose',
    packageManager: pm,
    composeService,
    warnings,
    steps: [
      { kind: 'check', runs_in: 'host', cmd: checkCmd, expectService: composeService },
      { kind: 'boot', runs_in: 'host', cmd: bootCmd, onlyIfDown: true },
      { kind: 'install', runs_in: 'container', cmd: installCmd }
    ]
  };
}

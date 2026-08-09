// bin/lib/install-dep.mjs
//
// Pure planner for runtime-aware dependency installation. Given a service config
// (from jlu-services.json) and the packages to install, return an ordered command
// plan. Host-runtime services install on the host (current behavior); docker-compose
// services install INSIDE their container, booting it first if it is not running.
//
// The package manager is DECLARED by the registry or DETECTED from the lockfile, never assumed.
//
// No execution and no I/O beyond reading the lockfile via detectPackageManager.
// The executor (bin/install-dep.mjs) runs the steps.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectPackageManager,
  frozenInstallCommand,
  lockfileForManager,
  addCommand
} from './registry/package-manager.mjs';
import { DEFAULT_EXEC_TEMPLATE, substituteExecTemplate } from './runtime-exec.mjs';

// Non-destructive reconcile install — safe inside a running dev container; drift
// is detected afterward by inspecting the lockfile rather than by failing.
function reconcileInstallCommand(pm) {
  return `${pm} install`;
}

export function planInstall({ service, serviceDir, packages, dev = false, packageManager = null }) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('planInstall requires at least one package');
  }

  const pm = packageManager || detectPackageManager(serviceDir) || 'npm';
  const install = addCommand(pm, packages, { dev });
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

  if (!packageManager && !detectPackageManager(serviceDir)) {
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

export function planInstallValidate({ service, serviceDir, packageManager = null }) {
  if (!existsSync(join(serviceDir, 'package.json'))) {
    return { runtime: 'skip', packageManager: null, warnings: [], steps: [] };
  }
  const pm = packageManager || detectPackageManager(serviceDir) || 'npm';
  const lockfile = lockfileForManager(pm);
  const runtime = (service && service.runtime && service.runtime.type) || 'host';

  if (runtime !== 'docker-compose') {
    return {
      runtime: 'host', packageManager: pm, warnings: [],
      steps: [{ kind: 'install', runs_in: 'host', cmd: frozenInstallCommand(pm), cwd: serviceDir }],
    };
  }

  const { compose_file: composeFile, compose_service: composeService } = service.runtime;
  const execTemplate = service.runtime.exec_template || DEFAULT_EXEC_TEMPLATE;
  const installInContainer = substituteExecTemplate(execTemplate, {
    composeFile, composeService, cmd: reconcileInstallCommand(pm),
  });
  return {
    runtime: 'docker-compose', packageManager: pm, composeService, warnings: [],
    steps: [
      { kind: 'check', runs_in: 'host', cmd: `docker compose -f ${composeFile} ps --status running --services`, expectService: composeService },
      { kind: 'boot', runs_in: 'host', cmd: `docker compose -f ${composeFile} up -d ${composeService}`, onlyIfDown: true },
      { kind: 'install', runs_in: 'container', cmd: installInContainer },
      { kind: 'drift_check', runs_in: 'host', lockfile, cmd: `git -C ${serviceDir} diff --exit-code -- ${lockfile}`, revertCmd: `git -C ${serviceDir} checkout -- ${lockfile}` },
    ],
  };
}

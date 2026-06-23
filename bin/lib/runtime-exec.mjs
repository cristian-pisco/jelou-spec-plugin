// bin/lib/runtime-exec.mjs
//
// Pure runtime resolver + exec-template helpers shared by install-dep (validate
// mode) and the build preflight. Given a service config (from jlu-services.json),
// resolve whether it runs on the host or in a docker-compose container, and the
// command prefix needed to exec inside that container.

export const DEFAULT_EXEC_TEMPLATE =
  'docker compose -f {compose_file} exec {compose_service} {cmd}';

export function substituteExecTemplate(template, { composeFile, composeService, cmd }) {
  return template
    .replaceAll('{compose_file}', composeFile)
    .replaceAll('{compose_service}', composeService)
    .replaceAll('{cmd}', cmd);
}

// execPrefix is the exec template with an empty {cmd} placeholder, trimmed —
// callers append their own command (e.g. `${execPrefix} npm run build`).
export function resolveRuntimeExec({ service }) {
  const runtime = (service && service.runtime && service.runtime.type) || 'host';
  if (runtime !== 'docker-compose') return { runtime: 'host', execPrefix: '' };

  const { compose_file: composeFile, compose_service: composeService } = service.runtime;
  const template = service.runtime.exec_template || DEFAULT_EXEC_TEMPLATE;
  const execPrefix = substituteExecTemplate(template, { composeFile, composeService, cmd: '' }).trimEnd();
  return { runtime: 'docker-compose', execPrefix };
}

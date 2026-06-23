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

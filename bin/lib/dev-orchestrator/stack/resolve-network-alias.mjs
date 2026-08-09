const SERVICES_KEY_RE = /^(\s*)services:\s*$/;
const CONTAINER_NAME_RE = /^\s*container_name:\s*["']?([^"'#\s]+)["']?\s*$/;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

export function containerNameFromCompose(composeText, composeService) {
  const lines = String(composeText || '').split('\n');
  let servicesIndent = null;
  let serviceIndent = null;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (servicesIndent === null) {
      const match = SERVICES_KEY_RE.exec(line);
      if (match) servicesIndent = match[1].length;
      continue;
    }
    if (serviceIndent === null) {
      if (indentOf(line) <= servicesIndent) return null;
      if (line.trim() === `${composeService}:` || line.trim() === `"${composeService}":`) serviceIndent = indentOf(line);
      continue;
    }
    if (indentOf(line) <= serviceIndent) return null;
    const named = CONTAINER_NAME_RE.exec(line);
    if (named) return named[1];
  }
  return null;
}

export function parseRunningContainerNames(dockerPsJsonLines) {
  const index = new Map();
  for (const line of String(dockerPsJsonLines || '').split('\n').filter(Boolean)) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const labels = Object.fromEntries(String(value.Labels || '').split(',').map((item) => {
      const separator = item.indexOf('=');
      return separator === -1 ? [item, ''] : [item.slice(0, separator), item.slice(separator + 1)];
    }));
    const workingDir = labels['com.docker.compose.project.working_dir'];
    const service = labels['com.docker.compose.service'];
    if (!workingDir || !service || !value.Names) continue;
    index.set(`${workingDir}|${service}`, String(value.Names).split(',')[0].trim());
  }
  return index;
}

export function createRunningNameResolver({ run }) {
  let index = null;
  return ({ cwd, composeService }) => {
    if (index === null) {
      const r = run('docker', ['ps', '--format', '{{json .}}'], {});
      index = r && r.status === 0 ? parseRunningContainerNames(r.stdout) : new Map();
    }
    return index.get(`${cwd}|${composeService}`) || null;
  };
}

export function resolveNetworkAlias({ composeText, composeService, declaredAlias = null, runningName = null }) {
  if (declaredAlias) return declaredAlias;
  return containerNameFromCompose(composeText, composeService) || runningName || composeService || null;
}

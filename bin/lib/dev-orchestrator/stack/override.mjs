import { createHash } from 'node:crypto';

const DNS_LABEL_MAX = 63;
const DIGEST_LENGTH = 8;

export function projectName(serviceName, slug) {
  const full = `${serviceName}-${slug}`;
  if (full.length <= DNS_LABEL_MAX) return full;
  const digest = createHash('sha256').update(full).digest('hex').slice(0, DIGEST_LENGTH);
  const head = full.slice(0, DNS_LABEL_MAX - DIGEST_LENGTH - 1).replace(/-+$/, '');
  return `${head}-${digest}`;
}

export function renderOverride({ service, slug, allocations, networkAlias, image, nodeModulesMount = null, runtimeMounts = [], depsVolume = null }) {
  const proj = projectName(service.name, slug);
  const lines = [];
  lines.push(`name: ${proj}`);
  lines.push('');
  lines.push('services:');
  lines.push(`  ${service.compose_service}:`);
  lines.push(`    container_name: ${proj}`);
  if (image) {
    lines.push(`    image: ${image}`);
    lines.push('    pull_policy: never');
    lines.push('    build: !reset null');
  }
  if (service.mode === 'exec') {
    lines.push('    entrypoint: ["sleep", "infinity"]');
    lines.push('    command: !reset null');
  }
  lines.push('    ports: !override');
  for (const a of allocations) lines.push(`      - "${a.host}:${a.internal}"`);
  lines.push('    networks:');
  lines.push(`      ${networkAlias}:`);
  lines.push('        aliases:');
  lines.push(`          - ${proj}`);
  const mountLines = [];
  if (depsVolume) mountLines.push(`      - ${depsVolume.name}:${depsVolume.target}`);
  if (nodeModulesMount) mountLines.push(`      - ${nodeModulesMount}:/app/node_modules`);
  for (const m of runtimeMounts) mountLines.push(`      - ${m.source}:${m.target}`);
  if (mountLines.length) {
    lines.push('    volumes:');
    for (const l of mountLines) lines.push(l);
  }
  if (depsVolume) {
    lines.push('');
    lines.push('volumes:');
    lines.push(`  ${depsVolume.name}:`);
  }
  lines.push('');
  return lines.join('\n');
}

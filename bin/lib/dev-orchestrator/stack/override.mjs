export function projectName(serviceName, slug) {
  return `${serviceName}-${slug}`;
}

export function renderOverride({ service, slug, allocations, networkAlias, image, nodeModulesMount = null, runtimeMounts = [] }) {
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
  if (nodeModulesMount) mountLines.push(`      - ${nodeModulesMount}:/app/node_modules`);
  for (const m of runtimeMounts) mountLines.push(`      - ${m.source}:${m.target}`);
  if (mountLines.length) {
    lines.push('    volumes:');
    for (const l of mountLines) lines.push(l);
  }
  lines.push('');
  return lines.join('\n');
}

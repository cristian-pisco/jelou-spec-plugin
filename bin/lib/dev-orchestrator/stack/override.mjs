export function projectName(serviceName, slug) {
  return `${serviceName}-${slug}`;
}

export function renderOverride({ service, slug, allocations, networkAlias }) {
  const proj = projectName(service.name, slug);
  const lines = [];
  lines.push(`name: ${proj}`);
  lines.push('');
  lines.push('services:');
  lines.push(`  ${service.compose_service}:`);
  lines.push(`    container_name: ${proj}`);
  lines.push('    ports: !override');
  for (const a of allocations) lines.push(`      - "${a.host}:${a.internal}"`);
  lines.push('    networks:');
  lines.push(`      ${networkAlias}:`);
  lines.push('        aliases:');
  lines.push(`          - ${proj}`);
  lines.push('');
  return lines.join('\n');
}

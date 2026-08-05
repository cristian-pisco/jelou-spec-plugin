export function serviceIdDivergences(merged) {
  return (merged || [])
    .filter((m) => m.from !== m.id)
    .map((m) => ({ registryId: m.id, servicesId: m.from }))
    .sort((a, b) => a.registryId.localeCompare(b.registryId));
}

export function divergenceReport(divergences) {
  return divergences
    .map(
      (d) =>
        `  ${d.registryId} (jelou-registry.yaml) and ${d.servicesId} (services.yaml) are the same path under two ids`
    )
    .join('\n');
}

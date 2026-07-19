export function hostByService({ plan, registry }) {
  const byId = {};
  for (const s of registry.services) byId[s.id] = s;
  const map = {};
  const occupied = [];
  for (const entry of plan.services) {
    if (entry.policy === 'task-isolated') {
      const primary = entry.ports.find((p) => p.primary) || entry.ports[0];
      map[entry.id] = primary.host;
      for (const p of entry.ports) occupied.push(p.host);
    } else {
      const dev = byId[entry.id].dev;
      map[entry.id] = dev.ports[dev.port_env];
    }
  }
  return { hostByService: map, occupied };
}

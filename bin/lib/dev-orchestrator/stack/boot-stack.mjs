import { bootPlan } from './boot-commands.mjs';
import { readinessPollUrl } from './readiness-url.mjs';
import { bootService } from './boot-exec.mjs';

export async function bootStack({ plan, writeFile, run, probe, delay, attempts = 10 }) {
  const services = plan.map((entry) => {
    bootService({ plan: bootPlan(entry), writeFile, run });
    return { name: entry.name, url: readinessPollUrl(entry) };
  });
  const pending = new Set(services.map((s) => s.name));
  for (let i = 0; i < attempts && pending.size > 0; i += 1) {
    for (const s of services) {
      if (!pending.has(s.name)) continue;
      if (await probe(s.url)) pending.delete(s.name);
    }
    if (pending.size > 0) await delay();
  }
  return { green: pending.size === 0, down: [...pending], services };
}

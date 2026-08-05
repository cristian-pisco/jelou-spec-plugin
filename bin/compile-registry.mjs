#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { parseYamlLite } from './lib/registry/yaml-lite.mjs';
import { normalizeRegistry } from './lib/registry/normalize.mjs';
import { resolveServicePath } from './lib/registry/resolve-path.mjs';
import { mergeDevBlocks } from './lib/registry/merge-dev-blocks.mjs';
import { devCommandMismatches, mismatchReport } from './lib/registry/validate-dev-commands.mjs';

export function registryYamlPath(workspaceRoot) {
  return join(workspaceRoot, 'registry', 'jelou-registry.yaml');
}

export function servicesYamlPath(workspaceRoot) {
  return join(workspaceRoot, 'registry', 'services.yaml');
}

export function registryJsonPath(workspaceRoot) {
  return join(workspaceRoot, 'registry', 'registry.json');
}

function readYaml(path) {
  if (!existsSync(path)) return null;
  return parseYamlLite(readFileSync(path, 'utf8'));
}

export function compileRegistry({ workspaceRoot }) {
  const raw = parseYamlLite(readFileSync(registryYamlPath(workspaceRoot), 'utf8'));
  const resolve = (p) => resolveServicePath({ workspaceRoot, relativePath: p });
  const overlay = readYaml(servicesYamlPath(workspaceRoot));
  const { services, merged, unmerged } = mergeDevBlocks({
    baseServices: raw.services,
    overlayServices: overlay ? overlay.services : null,
    resolve
  });
  const reg = normalizeRegistry({ ...raw, services }, { resolve });

  const mismatches = devCommandMismatches(reg.services);
  if (mismatches.length > 0) {
    throw new Error(`refusing to compile the registry — these dev commands use the wrong package manager:\n${mismatchReport(mismatches)}\nFix the dev block in registry/services.yaml (it is the maintained source) or re-derive it with bin/derive-dev-block.mjs.`);
  }

  const dest = registryJsonPath(workspaceRoot);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  return { dest, merged, unmerged };
}

function main() {
  const i = argv.indexOf('--workspace');
  if (i === -1 || !argv[i + 1]) { console.error('compile-registry: --workspace <root> required'); exit(2); }
  try {
    const { dest, merged, unmerged } = compileRegistry({ workspaceRoot: argv[i + 1] });
    for (const m of merged) {
      console.error(`compile-registry: merged dev fields from services.yaml '${m.from}' into '${m.id}': ${m.fields.join(', ')}`);
      for (const c of m.changes) console.error(`  ${m.id}.${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    }
    if (unmerged.length) console.error(`compile-registry: services.yaml declares dev blocks not present in jelou-registry.yaml (not booted): ${unmerged.join(', ')}`);
    console.log(dest);
  } catch (err) {
    console.error(err.message);
    exit(3);
  }
}

if (import.meta.url === `file://${argv[1]}`) main();

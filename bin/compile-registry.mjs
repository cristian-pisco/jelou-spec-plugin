#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { parseYamlLite } from './lib/registry/yaml-lite.mjs';
import { normalizeRegistry } from './lib/registry/normalize.mjs';
import { resolveServicePath } from './lib/registry/resolve-path.mjs';

export function registryYamlPath(workspaceRoot) {
  return join(workspaceRoot, 'registry', 'jelou-registry.yaml');
}

export function registryJsonPath(workspaceRoot) {
  return join(workspaceRoot, 'registry', 'registry.json');
}

export function compileRegistry({ workspaceRoot }) {
  const raw = parseYamlLite(readFileSync(registryYamlPath(workspaceRoot), 'utf8'));
  const reg = normalizeRegistry(raw, { resolve: (p) => resolveServicePath({ workspaceRoot, relativePath: p }) });
  const dest = registryJsonPath(workspaceRoot);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  return dest;
}

function main() {
  const i = argv.indexOf('--workspace');
  if (i === -1 || !argv[i + 1]) { console.error('compile-registry: --workspace <root> required'); exit(2); }
  console.log(compileRegistry({ workspaceRoot: argv[i + 1] }));
}

if (import.meta.url === `file://${argv[1]}`) main();

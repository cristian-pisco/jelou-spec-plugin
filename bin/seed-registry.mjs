#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';
import { compileRegistry, registryYamlPath } from './compile-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, '..', 'jelou', 'config', 'jelou-registry.template.yaml');

export function seedRegistry({ workspaceRoot }) {
  const dest = registryYamlPath(workspaceRoot);
  let created = false;
  if (!existsSync(dest)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(TEMPLATE_PATH, dest);
    created = true;
  }
  compileRegistry({ workspaceRoot });
  return { created, path: dest };
}

function main() {
  const i = argv.indexOf('--workspace');
  if (i === -1 || !argv[i + 1]) { console.error('seed-registry: --workspace <root> required'); exit(2); }
  const r = seedRegistry({ workspaceRoot: argv[i + 1] });
  console.log(`${r.created ? 'seeded' : 'present'}: ${r.path}`);
}

if (import.meta.url === `file://${argv[1]}`) main();

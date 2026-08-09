#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOsKeyring } from './lib/dev-orchestrator/stack/local-keyring.mjs';
import { onboardLocalAuth } from './lib/dev-orchestrator/stack/local-provisioning.mjs';

function adapterUrl(value) {
  if (value === 'plugin:local-jelou-provisioning') {
    return new URL('./lib/dev-orchestrator/stack/local-jelou-provisioning-adapter.mjs', import.meta.url).href;
  }
  return pathToFileURL(resolve(value)).href;
}

export function parseLocalOnboardingArgs(argv) {
  const adapterIndex = argv.indexOf('--adapter-module');
  if (adapterIndex === -1 || !argv[adapterIndex + 1]) throw new Error('--adapter-module is required');
  const unsupported = argv.filter((value, index) => !['--adapter-module', '--reconfigure'].includes(value) && index !== adapterIndex + 1);
  if (unsupported.length > 0) throw new Error(`unsupported argument: ${unsupported[0]}`);
  return { adapterModule: argv[adapterIndex + 1], reconfigure: argv.includes('--reconfigure') };
}

export async function runLocalOnboardingCli({ requestText, adapter, keyring = createOsKeyring() }) {
  const request = JSON.parse(requestText);
  const result = await onboardLocalAuth(request, { keyring, database: adapter.database, bcrypt: adapter.bcrypt });
  return {
    status: result.status,
    profile: result.profile,
    targetProof: result.targetProof,
    counts: result.counts,
    cleanupResources: result.cleanupResources || [],
  };
}

async function main() {
  const parsed = parseLocalOnboardingArgs(process.argv.slice(2));
  const requestText = readFileSync(0, 'utf8');
  const request = JSON.parse(requestText);
  const adapterModule = await import(adapterUrl(parsed.adapterModule));
  const adapter = typeof adapterModule.createProvisioningAdapter === 'function'
    ? await adapterModule.createProvisioningAdapter(request)
    : adapterModule;
  const output = await runLocalOnboardingCli({
    requestText: JSON.stringify({ ...request, reconfigure: parsed.reconfigure || request.reconfigure }),
    adapter,
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}

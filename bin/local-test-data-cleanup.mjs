#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { proveLocalDatabaseTarget } from './lib/dev-orchestrator/stack/local-target.mjs';

async function main() {
  const resource = JSON.parse(readFileSync(0, 'utf8'));
  proveLocalDatabaseTarget(resource.target, resource.topology);
  const module = await import(pathToFileURL(resolve(resource.provisioningBoundaryPath)).href);
  if (typeof module.createLocalJelouBoundary !== 'function') throw new Error('registered local database boundary is invalid');
  const boundary = await module.createLocalJelouBoundary({ target: resource.target, topology: resource.topology });
  if (typeof boundary?.database?.removeOwnedRecord !== 'function') throw new Error('registered local database boundary lacks owned-record cleanup');
  const removed = await boundary.database.removeOwnedRecord(resource);
  if (removed !== true) throw new Error('registered local database boundary refused owned-record cleanup');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});

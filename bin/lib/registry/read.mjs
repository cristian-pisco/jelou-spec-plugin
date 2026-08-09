import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFrontendService } from './normalize.mjs';

export function readUnifiedRegistry(workspaceRoot) {
  const p = join(workspaceRoot, 'registry', 'registry.json');
  if (!existsSync(p)) throw new Error(`registry.json not found at ${p} — run bin/seed-registry.mjs (or compile-registry.mjs) --workspace ${workspaceRoot} first`);
  return ensureFrontendService(JSON.parse(readFileSync(p, 'utf8')));
}

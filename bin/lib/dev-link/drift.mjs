// bin/lib/dev-link/drift.mjs
//
// Compares the working tree against the installed release copy, surface by
// surface, so `status` can answer the only question that matters before a
// release: what would a session see differently if it loaded this tree instead
// of the published version.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SURFACES = ['.claude-plugin', 'skills', 'agents', 'hooks', 'bin', 'jelou'];

const IGNORED_DIRS = new Set(['node_modules', '.git']);

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function diffSurface(rootDir, installedDir) {
  const left = new Set(walk(rootDir));
  const right = new Set(walk(installedDir));
  const added = [...left].filter((f) => !right.has(f)).sort();
  const removed = [...right].filter((f) => !left.has(f)).sort();
  const changed = [...left]
    .filter((f) => right.has(f))
    .filter((f) => digest(join(rootDir, f)) !== digest(join(installedDir, f)))
    .sort();
  return { added, removed, changed };
}

export function diffAgainstInstalled({ root, installPath, surfaces = SURFACES }) {
  if (!installPath || !existsSync(installPath)) return { available: false };
  const bySurface = {};
  let total = 0;
  for (const surface of surfaces) {
    const diff = diffSurface(join(root, surface), join(installPath, surface));
    const count = diff.added.length + diff.removed.length + diff.changed.length;
    if (count) {
      bySurface[surface] = diff;
      total += count;
    }
  }
  return { available: true, total, bySurface };
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_WALK_UP = 6;

function readPointerWorkspace(pointer) {
  try {
    const workspace = JSON.parse(readFileSync(pointer, 'utf8'))?.workspace;
    return workspace && existsSync(join(workspace, 'specs')) ? workspace : null;
  } catch {
    return null;
  }
}

export function resolveSpecWorkspace(startDir) {
  let dir = startDir;
  for (let i = 0; i <= MAX_WALK_UP; i++) {
    const pointer = join(dir, '.spec-workspace.json');
    if (existsSync(pointer)) {
      const fromPointer = readPointerWorkspace(pointer);
      if (fromPointer) return fromPointer;
    }
    const local = join(dir, '.spec-workspace');
    if (existsSync(join(local, 'specs'))) return local;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

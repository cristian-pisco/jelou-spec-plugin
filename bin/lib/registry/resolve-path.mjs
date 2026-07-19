import { isAbsolute, resolve } from 'node:path';

export function resolveServicePath({ workspaceRoot, relativePath }) {
  if (!relativePath) throw new Error('resolveServicePath: relativePath is required');
  if (isAbsolute(relativePath)) return relativePath;
  return resolve(workspaceRoot, relativePath);
}

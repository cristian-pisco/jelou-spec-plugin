import { addCommand } from '../registry/package-manager.mjs';
import { DEFAULT_EXEC_TEMPLATE, substituteExecTemplate } from '../runtime-exec.mjs';

const PATTERNS = [
  /Cannot find module\s+['"]([^'"]+)['"]/,
  /Cannot find package\s+['"]([^'"]+)['"]/,
  /Module not found:.*?Can't resolve\s+['"]([^'"]+)['"]/,
  /ERR_MODULE_NOT_FOUND.*?['"]([^'"]+)['"]/
];

const RELATIVE_PREFIXES = ['.', '/', '~', '#'];

export function packageNameFromSpecifier(specifier) {
  const raw = String(specifier || '').trim();
  if (!raw) return null;
  if (RELATIVE_PREFIXES.some((prefix) => raw.startsWith(prefix))) return null;
  if (raw.startsWith('node:')) return null;
  const parts = raw.split('/');
  return raw.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function parseMissingModule(capture) {
  const text = String(capture || '');
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const name = packageNameFromSpecifier(match[1]);
    if (name) return { specifier: match[1], packageName: name };
  }
  return null;
}

export function classifyMissingModule({ packageName, declaredDependencies }) {
  if (!packageName) return { action: 'diagnose', reason: 'no missing-module signature in the capture' };
  if (declaredDependencies === null || declaredDependencies === undefined) {
    return { action: 'escalate', reason: `could not read package.json to confirm '${packageName}' is a declared dependency` };
  }
  if (!declaredDependencies.includes(packageName)) {
    return {
      action: 'escalate',
      reason: `'${packageName}' is not declared in package.json — this is a broken import, not stale container dependencies`
    };
  }
  return { action: 'install', reason: `'${packageName}' is declared but absent from the container's node_modules` };
}

export function planMissingModuleFix({ packageName, packageManager, composeFile, composeService, execTemplate }) {
  if (!packageName) throw new Error('planMissingModuleFix requires a package name');
  if (!packageManager) throw new Error('planMissingModuleFix requires a package manager');
  const install = addCommand(packageManager, [packageName]);
  return {
    packageName,
    packageManager,
    command: substituteExecTemplate(execTemplate || DEFAULT_EXEC_TEMPLATE, {
      composeFile,
      composeService,
      cmd: install
    }),
    runs_in: 'container'
  };
}

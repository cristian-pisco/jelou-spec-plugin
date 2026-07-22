#!/usr/bin/env node
import { argv, stdout, exit, env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, copyFileSync, realpathSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, '..', 'jelou', 'config', 'settings.json');
const DEFAULTS = { autochain: false };

export function userSettingsPath(home = homedir()) {
  return join(home, '.jlu', 'settings.json');
}

export function seedSettings(home = homedir()) {
  const dest = userSettingsPath(home);
  if (existsSync(dest)) return { created: false, path: dest };
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(TEMPLATE_PATH, dest);
  return { created: true, path: dest };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function resolveSetting(key, { home = homedir(), environ = env } = {}) {
  const envKey = `JLU_${key.toUpperCase()}`;
  if (environ[envKey] !== undefined && environ[envKey] !== '') {
    const raw = environ[envKey];
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return raw;
  }
  try {
    seedSettings(home);
  } catch {}
  const settings = readJson(userSettingsPath(home)) ?? readJson(TEMPLATE_PATH) ?? DEFAULTS;
  return settings[key] !== undefined ? settings[key] : DEFAULTS[key];
}

function main() {
  const [command, key] = argv.slice(2);
  if (command !== 'get' || !key) {
    stdout.write('usage: jlu-settings.mjs get <key>\n');
    exit(2);
  }
  stdout.write(`${JSON.stringify(resolveSetting(key))}\n`);
}

function isDirectInvocation() {
  if (!argv[1]) return false;
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main();
}

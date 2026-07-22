#!/usr/bin/env node
import { argv, stdout, exit, env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { createSettingsStore } from './lib/settings-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, '..', 'jelou', 'config', 'settings.json');
const DEFAULTS = { autochain: true };

const store = createSettingsStore({ templatePath: TEMPLATE_PATH, basename: 'settings.json' });

export function userSettingsPath(home = homedir()) {
  return store.userSettingsPath(home);
}

export function seedSettings(home = homedir()) {
  return store.seedSettings(home);
}

export function resolveSetting(key, { home = homedir(), environ = env } = {}) {
  const envKey = `JLU_${key.toUpperCase()}`;
  if (environ[envKey] !== undefined && environ[envKey] !== '') {
    const raw = environ[envKey];
    const normalized = raw.toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return raw;
  }
  const settings = store.readSettings(home) ?? DEFAULTS;
  return settings[key] !== undefined ? settings[key] : DEFAULTS[key];
}

function main() {
  const [command, key] = argv.slice(2);
  if (command !== 'get' || !key) {
    stdout.write('usage: jlu-settings.mjs get <key>\n');
    exit(2);
  }
  const value = resolveSetting(key);
  if (value === undefined) {
    stdout.write('null\n');
    exit(1);
  }
  stdout.write(`${JSON.stringify(value)}\n`);
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

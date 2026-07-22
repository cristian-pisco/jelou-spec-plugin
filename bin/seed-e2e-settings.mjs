#!/usr/bin/env node
import { argv, stdout, exit, env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSettingsStore } from './lib/settings-store.mjs';

const VERSION = '0.1.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, '..', 'jelou', 'config', 'e2e-settings.json');
const DEFAULT_VIDEO_MODE = 'on';
const DEFAULT_RETENTION_DAYS = 14;

const store = createSettingsStore({ templatePath: TEMPLATE_PATH, basename: 'e2e-settings.json' });

export function userSettingsPath(home = homedir()) {
  return store.userSettingsPath(home);
}

export function seedSettings(home = homedir()) {
  return store.seedSettings(home);
}

export function resolveVideoMode(home = homedir(), environ = env) {
  if (environ.JLU_E2E_VIDEO) return environ.JLU_E2E_VIDEO;
  const settings = store.readSettings(home);
  const mode = settings && settings.video && settings.video.mode;
  return typeof mode === 'string' && mode ? mode : DEFAULT_VIDEO_MODE;
}

export function resolveRetentionDays(home = homedir()) {
  const settings = store.readSettings(home);
  const days = settings && settings.retentionDays;
  return Number.isInteger(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS;
}

function main() {
  const arg = argv[2];
  if (arg === '--version') {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }
  if (arg === '--print-video') {
    stdout.write(`${resolveVideoMode()}\n`);
    exit(0);
  }
  if (arg === '--print-retention') {
    stdout.write(`${resolveRetentionDays()}\n`);
    exit(0);
  }
  store.trySeed();
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

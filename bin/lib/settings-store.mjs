import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';

export function createSettingsStore({ templatePath, basename }) {
  function userSettingsPath(home = homedir()) {
    return join(home, '.jlu', basename);
  }

  function seedSettings(home = homedir()) {
    const dest = userSettingsPath(home);
    if (existsSync(dest)) return { created: false, path: dest };
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(templatePath, dest);
    return { created: true, path: dest };
  }

  function trySeed(home = homedir()) {
    try {
      return seedSettings(home);
    } catch {
      return null;
    }
  }

  function readJson(path) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  function readSettings(home = homedir()) {
    trySeed(home);
    return readJson(userSettingsPath(home)) ?? readJson(templatePath);
  }

  return { userSettingsPath, seedSettings, trySeed, readJson, readSettings };
}

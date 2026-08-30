// bin/lib/dev-link/claude-cli.mjs
//
// Thin, injectable wrapper over the `claude` CLI surfaces this tooling reads.
//
// `claude --plugin-dir <root>` loads a plugin straight from disk and takes
// precedence over an installed plugin of the same name, keeping the `jlu:`
// namespace intact. That is the whole mechanism behind pre-release testing:
// the working tree becomes the plugin for that session, with no install,
// no uninstall, and no global state touched.
//
// `claude plugin list --json` reports each installed plugin's load errors —
// the only surface that reveals a manifest the runtime refused.

import { execFileSync } from 'node:child_process';

export const PLUGIN_ID = 'jlu@jelou-spec-plugin';

export function claudeBin(env = process.env) {
  return env.JLU_CLAUDE_CLI || 'claude';
}

export function launchArgv(root, extra = []) {
  return ['--plugin-dir', root, ...extra];
}

export function launchCommand(root, extra = [], env = process.env) {
  return [claudeBin(env), ...launchArgv(root, extra)].join(' ');
}

export function defaultRunner(env = process.env) {
  return (args) => {
    try {
      return { ok: true, stdout: execFileSync(claudeBin(env), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      return { ok: false, stdout: err.stdout ?? '', error: err.message };
    }
  };
}

export function parsePluginList(stdout, id = PLUGIN_ID) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { available: false, reason: 'plugin list did not return JSON' };
  }
  const entries = Array.isArray(parsed) ? parsed : parsed.plugins ?? [];
  const entry = entries.find((p) => p.id === id);
  if (!entry) return { available: true, found: false };
  return {
    available: true,
    found: true,
    version: entry.version,
    enabled: entry.enabled !== false,
    installPath: entry.installPath,
    errors: entry.errors ?? [],
  };
}

export function readInstalledPlugin({ runner, id = PLUGIN_ID }) {
  const result = runner(['plugin', 'list', '--json']);
  if (!result.ok) return { available: false, reason: result.error ?? 'claude CLI unavailable' };
  return parsePluginList(result.stdout, id);
}

export function installedFindings(installed) {
  if (!installed.available || !installed.found) return [];
  const findings = [];
  for (const error of installed.errors) {
    findings.push({
      id: 'installed-load-error',
      severity: 'error',
      message: `the installed release ${installed.version} fails to load: ${error}`,
      fix: 'Fix the manifest in the working tree, release, then /jlu-update',
    });
  }
  if (!installed.enabled) {
    findings.push({
      id: 'installed-disabled',
      severity: 'warn',
      message: `${PLUGIN_ID} is disabled, so bare-name sessions run without it`,
      fix: `claude plugin enable ${PLUGIN_ID}`,
    });
  }
  return findings;
}

export function validateManifest({ runner, root }) {
  const result = runner(['plugin', 'validate', root]);
  if (!result.ok && !result.stdout) return { available: false, reason: result.error ?? 'claude CLI unavailable' };
  const stdout = result.stdout ?? '';
  const warnings = [...stdout.matchAll(/❯\s+(.+)/g)].map((m) => m[1].trim());
  return { available: true, passed: result.ok && /Validation passed/.test(stdout), warnings, stdout };
}

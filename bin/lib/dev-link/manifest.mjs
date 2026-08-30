// bin/lib/dev-link/manifest.mjs
//
// Static reimplementation of the plugin-load rules that actually break a release.
//
// `claude plugin validate` passes on manifests that the runtime then refuses to
// load — 0.3.359 shipped with a hooks reference the CLI auto-loads on its own and
// reported "failed to load" for every install. These checks run offline, so the
// pre-push gate does not depend on the Claude CLI being present.
//
// Every check returns findings shaped { id, severity, message, fix }.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentFile } from '../agent-frontmatter.mjs';

export const STANDARD_HOOKS_FILE = 'hooks/hooks.json';

const PLUGIN_ROOT_REF = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g;

const finding = (id, severity, message, fix) => ({ id, severity, message, fix });

export function readJsonFile(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return { ok: false, missing: true, error: `${rel} does not exist` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (err) {
    return { ok: false, missing: false, error: `${rel} is not valid JSON: ${err.message}` };
  }
}

export function listSkillDirs(root) {
  const dir = join(root, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, 'SKILL.md')))
    .sort();
}

export function listAgentFiles(root) {
  const dir = join(root, 'agents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function normalizeHooksField(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
  return [];
}

function stripLeadingDot(rel) {
  return rel.replace(/^\.\//, '');
}

export function checkPluginManifest(root) {
  const manifest = readJsonFile(root, '.claude-plugin/plugin.json');
  if (!manifest.ok) {
    return [finding('manifest-unreadable', 'error', manifest.error, 'Restore a parseable .claude-plugin/plugin.json')];
  }

  const findings = [];
  const { value } = manifest;

  if (!value.name) {
    findings.push(finding('manifest-no-name', 'error', 'plugin.json has no "name"', 'Add a "name" field — it is the skill and agent namespace'));
  }

  for (const declared of normalizeHooksField(value.hooks)) {
    if (stripLeadingDot(declared) === STANDARD_HOOKS_FILE) {
      findings.push(
        finding(
          'hooks-duplicate',
          'error',
          `plugin.json declares hooks: "${declared}", which Claude Code already auto-loads — the runtime rejects the whole plugin with "Duplicate hooks file detected"`,
          'Drop the "hooks" field; manifest.hooks may only reference ADDITIONAL hook files',
        ),
      );
    }
  }

  return findings;
}

export function checkHookWiring(root) {
  const hooks = readJsonFile(root, STANDARD_HOOKS_FILE);
  if (hooks.missing) return [];
  if (!hooks.ok) {
    return [finding('hooks-unparseable', 'error', hooks.error, 'Fix the JSON in hooks/hooks.json')];
  }

  const findings = [];
  const events = hooks.value?.hooks ?? {};
  for (const [event, groups] of Object.entries(events)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of group.hooks ?? []) {
        const command = typeof hook.command === 'string' ? hook.command : '';
        for (const [, rel] of command.matchAll(PLUGIN_ROOT_REF)) {
          if (!existsSync(join(root, rel))) {
            findings.push(
              finding(
                'hook-target-missing',
                'error',
                `${event} hook points at ${rel}, which does not exist in the plugin root`,
                `Restore ${rel} or drop the hook from ${STANDARD_HOOKS_FILE}`,
              ),
            );
          }
        }
      }
    }
  }
  return findings;
}

export function checkMarketplaceManifest(root) {
  const market = readJsonFile(root, '.claude-plugin/marketplace.json');
  if (market.missing) return [];
  if (!market.ok) {
    return [finding('marketplace-unparseable', 'error', market.error, 'Fix the JSON in .claude-plugin/marketplace.json')];
  }

  const manifest = readJsonFile(root, '.claude-plugin/plugin.json');
  const pluginName = manifest.ok ? manifest.value.name : null;
  const findings = [];

  for (const entry of market.value.plugins ?? []) {
    const source = typeof entry.source === 'string' ? entry.source : '';
    if (!source) {
      findings.push(finding('marketplace-no-source', 'error', `marketplace entry "${entry.name}" has no source`, 'Point the entry at the plugin directory'));
      continue;
    }
    if (!existsSync(join(root, source))) {
      findings.push(
        finding('marketplace-source-missing', 'error', `marketplace entry "${entry.name}" points at "${source}", which does not exist`, 'Correct the source path'),
      );
    }
    if (stripLeadingDot(source) === '' && pluginName && entry.name !== pluginName) {
      findings.push(
        finding(
          'marketplace-name-drift',
          'error',
          `marketplace entry is named "${entry.name}" but plugin.json declares "${pluginName}" — installs resolve the namespace from plugin.json`,
          `Rename the marketplace entry to "${pluginName}"`,
        ),
      );
    }
  }
  return findings;
}

function frontmatterOf(raw) {
  try {
    return parseAgentFile(raw).frontmatter;
  } catch {
    return null;
  }
}

export function checkSkillFrontmatter(root) {
  const findings = [];
  for (const name of listSkillDirs(root)) {
    const rel = `skills/${name}/SKILL.md`;
    const fm = frontmatterOf(readFileSync(join(root, rel), 'utf8'));
    if (!fm) {
      findings.push(finding('skill-frontmatter-malformed', 'error', `${rel} has no parseable YAML frontmatter`, 'Add a --- delimited frontmatter block'));
      continue;
    }
    if (fm.name !== name) {
      findings.push(
        finding('skill-name-drift', 'error', `${rel} declares name "${fm.name ?? ''}" but lives in skills/${name}/`, `Set name: ${name}`),
      );
    }
    if (!fm.description) {
      findings.push(finding('skill-no-description', 'error', `${rel} has no description — the model cannot route to it`, 'Add a description with trigger phrases'));
    }
  }
  return findings;
}

export function checkAgentFrontmatter(root) {
  const findings = [];
  for (const file of listAgentFiles(root)) {
    const rel = `agents/${file}`;
    const expected = file.replace(/\.md$/, '');
    const fm = frontmatterOf(readFileSync(join(root, rel), 'utf8'));
    if (!fm) {
      findings.push(finding('agent-frontmatter-malformed', 'error', `${rel} has no parseable YAML frontmatter`, 'Add a --- delimited frontmatter block'));
      continue;
    }
    if (fm.name !== expected) {
      findings.push(
        finding('agent-name-drift', 'error', `${rel} declares name "${fm.name ?? ''}" — dispatch resolves by filename`, `Set name: ${expected}`),
      );
    }
    if (!fm.description) {
      findings.push(finding('agent-no-description', 'error', `${rel} has no description — the orchestrator cannot select it`, 'Add a description'));
    }
  }
  return findings;
}

export function inventory(root) {
  const hooks = readJsonFile(root, STANDARD_HOOKS_FILE);
  const events = hooks.ok ? Object.keys(hooks.value?.hooks ?? {}).sort() : [];
  return { skills: listSkillDirs(root), agents: listAgentFiles(root).map((f) => f.replace(/\.md$/, '')), hookEvents: events };
}

export function auditManifest(root) {
  return [
    ...checkPluginManifest(root),
    ...checkHookWiring(root),
    ...checkMarketplaceManifest(root),
    ...checkSkillFrontmatter(root),
    ...checkAgentFrontmatter(root),
  ];
}

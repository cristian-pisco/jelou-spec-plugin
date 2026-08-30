import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listAgentFiles, listSkillDirs } from './manifest.mjs';

const SKILL_PROVENANCE = 'jelou/workflows/';
const AGENT_PREFIX = 'jlu-';

export const CURRENT = 'shadows-current';
export const RETIRED = 'retired';

function safeReaddir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

export function globalSkillsDir(home) {
  return join(home, '.claude', 'skills');
}

export function globalAgentsDir(home) {
  return join(home, '.claude', 'agents');
}

export function legacyPluginRoot(home) {
  return join(home, '.claude', 'jelou');
}

export function scanShadowSkills({ root, home }) {
  const owned = new Set(listSkillDirs(root));
  const dir = globalSkillsDir(home);
  const out = [];
  for (const name of safeReaddir(dir).sort()) {
    const skillPath = join(dir, name);
    const skillFile = join(skillPath, 'SKILL.md');
    if (!statSync(skillPath).isDirectory() || !existsSync(skillFile)) continue;
    if (!readFileSync(skillFile, 'utf8').includes(SKILL_PROVENANCE)) continue;
    out.push({ name, path: skillPath, status: owned.has(name) ? CURRENT : RETIRED });
  }
  return out;
}

export function scanShadowAgents({ root, home }) {
  const owned = new Set(listAgentFiles(root).map((f) => f.replace(/\.md$/, '')));
  const dir = globalAgentsDir(home);
  const out = [];
  for (const file of safeReaddir(dir).sort()) {
    if (!file.endsWith('.md') || !file.startsWith(AGENT_PREFIX)) continue;
    const name = file.replace(/\.md$/, '');
    out.push({ name, path: join(dir, file), status: owned.has(name) ? CURRENT : RETIRED });
  }
  return out;
}

export function scanShadows({ root, home }) {
  const legacyRoot = legacyPluginRoot(home);
  return {
    skills: scanShadowSkills({ root, home }),
    agents: scanShadowAgents({ root, home }),
    legacyRoot: existsSync(legacyRoot) ? legacyRoot : null,
  };
}

export function shadowFindings(scan) {
  const findings = [];
  const describe = (kind, entries, status, id, message, fix) => {
    const hits = entries.filter((e) => e.status === status);
    if (!hits.length) return;
    findings.push({
      id,
      severity: 'error',
      message: `${hits.length} ${kind} ${message}: ${hits.map((e) => e.name).join(', ')}`,
      fix,
    });
  };

  describe('skill', scan.skills, CURRENT, 'skill-shadow-current',
    'copied into ~/.claude/skills/ shadow live plugin skills under their bare name',
    'node bin/dev-link.mjs clean-shadows --apply');
  describe('skill', scan.skills, RETIRED, 'skill-shadow-retired',
    'in ~/.claude/skills/ belong to workflows this plugin no longer ships',
    'node bin/dev-link.mjs clean-shadows --apply');
  describe('agent', scan.agents, CURRENT, 'agent-shadow-current',
    'copied into ~/.claude/agents/ shadow live plugin agents under their bare name',
    'node bin/dev-link.mjs clean-shadows --apply');
  describe('agent', scan.agents, RETIRED, 'agent-shadow-retired',
    'in ~/.claude/agents/ were retired from the plugin and still dispatch',
    'node bin/dev-link.mjs clean-shadows --apply');

  if (scan.legacyRoot) {
    findings.push({
      id: 'legacy-plugin-root',
      severity: 'warn',
      message: `${scan.legacyRoot} is a frozen copy of jelou/ that every skill's Phase-1 bootstrap accepts as a plugin-root fallback`,
      fix: 'node bin/dev-link.mjs clean-shadows --apply --include-legacy-root',
    });
  }

  return findings;
}

export function removalPlan(scan, { includeLegacyRoot = false } = {}) {
  const paths = [...scan.skills, ...scan.agents].map((e) => e.path);
  if (includeLegacyRoot && scan.legacyRoot) paths.push(scan.legacyRoot);
  return paths;
}

export function isRemovable(path, home) {
  const allowed = [globalSkillsDir(home), globalAgentsDir(home), legacyPluginRoot(home)];
  return allowed.some((base) => path === base || path.startsWith(`${base}/`));
}

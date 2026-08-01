#!/usr/bin/env node
// bin/sync-codex.mjs
//
// Regenerate the Codex CLI runtime mirror from canonical sources:
//   .codex/agents/<agent>.toml   ← agents/<agent>.md      (renderCodexAgent)
//   .codex/skills/jlu-<skill>/SKILL.md ← skills/<skill>/SKILL.md (renderCodexSkill)
//
// Canonical sources are edited by hand; this mirror is generated. Same contract
// as bin/sync-agents.mjs (the OpenCode mirror): CI fails on drift.
//
// Usage:
//   node bin/sync-codex.mjs           # write mode: regenerate mirror
//   node bin/sync-codex.mjs --check   # CI mode: exit 1 on drift, no writes

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { parseAgentFile, renderCodexAgent } from './lib/agent-frontmatter.mjs';
import { renderCodexSkill } from './lib/codex-skill.mjs';

const cwd = process.cwd();
const AGENTS_SRC = join(cwd, 'agents');
const SKILLS_SRC = join(cwd, 'skills');
const AGENTS_DEST = join(cwd, '.codex/agents');
const SKILLS_DEST = join(cwd, '.codex/skills');
const CHECK_MODE = process.argv.includes('--check');

function listMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md'));
}

function listSkills(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    (name) =>
      statSync(join(dir, name)).isDirectory() &&
      existsSync(join(dir, name, 'SKILL.md')),
  );
}

function walkRel(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkRel(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

// Returns { drift: [{name, reason}], written: number }
function syncPair(expectedByDest, destDir) {
  const drift = [];
  let written = 0;

  if (!existsSync(destDir)) {
    if (CHECK_MODE) {
      drift.push({ name: destDir, reason: 'missing-dir' });
      return { drift, written };
    }
    mkdirSync(destDir, { recursive: true });
  }

  const expectedNames = new Set(Object.keys(expectedByDest));
  for (const [destName, expected] of Object.entries(expectedByDest)) {
    const destPath = join(destDir, destName);
    const current = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
    if (current === expected) continue;
    if (CHECK_MODE) {
      drift.push({ name: destName, reason: current === null ? 'missing' : 'stale' });
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, expected);
      written += 1;
    }
  }

  if (existsSync(destDir)) {
    for (const rel of walkRel(destDir, destDir)) {
      if (!expectedNames.has(rel) && (rel.endsWith('.toml') || rel.endsWith('.md'))) {
        if (CHECK_MODE) drift.push({ name: rel, reason: 'orphan' });
      }
    }
  }
  return { drift, written };
}

function main() {
  if (!existsSync(AGENTS_SRC)) {
    console.error(`Source directory not found: ${AGENTS_SRC}`);
    process.exit(2);
  }

  const agentExpected = {};
  for (const name of listMd(AGENTS_SRC)) {
    const raw = readFileSync(join(AGENTS_SRC, name), 'utf8');
    agentExpected[name.replace(/\.md$/, '.toml')] = renderCodexAgent(raw);
  }

  const skillExpected = {};
  for (const skill of listSkills(SKILLS_SRC)) {
    const raw = readFileSync(join(SKILLS_SRC, skill, 'SKILL.md'), 'utf8');
    const { frontmatter } = parseAgentFile(raw);
    skillExpected[`jlu-${skill}/SKILL.md`] = renderCodexSkill(skill, frontmatter);
  }

  const agents = syncPair(agentExpected, AGENTS_DEST);
  const skills = syncPair(skillExpected, SKILLS_DEST);
  const drift = [...agents.drift, ...skills.drift];

  if (CHECK_MODE) {
    if (drift.length > 0) {
      console.error(`sync-codex --check failed (${drift.length} drift):`);
      for (const d of drift) console.error(`  ${d.name} (${d.reason})`);
      console.error('Run `node bin/sync-codex.mjs` to regenerate.');
      process.exit(1);
    }
    return;
  }

  console.log(
    `sync-codex: ${Object.keys(agentExpected).length} agents (${agents.written} written) → .codex/agents/, ` +
      `${Object.keys(skillExpected).length} skills (${skills.written} written) → .codex/skills/`,
  );
}

main();

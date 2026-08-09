// tests/unit/agent-namespace-dispatch.test.mjs
//
// Run: `node --test tests/unit/agent-namespace-dispatch.test.mjs`
//
// Claude Code resolves a bare `subagent_type` (e.g. `jlu-deps-validator`) ONLY
// from ~/.claude/agents and the project .claude/agents — never from an installed
// plugin, whose agents are namespaced `jlu:<agent>`. Workflows name agents bare,
// so a clean (or stale manual) install would fail to dispatch them. The fix: each
// skill's Claude Code runtime contract tells the orchestrator to dispatch agents
// with the `jlu:` plugin-namespace prefix and fall back to bare. This suite is
// self-enforcing: any workflow that references a canonical agent forces its skill
// to carry the rule.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const agentNames = readdirSync(join(ROOT, 'agents'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

const wordBoundary = (name) => new RegExp(`\\b${name}\\b`);

// A skill dispatches agents iff its workflow names at least one canonical agent.
function dispatchingSkills() {
  const dir = join(ROOT, 'jelou/workflows');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .filter((skill) => {
      const wf = readFileSync(join(dir, `${skill}.md`), 'utf8');
      return agentNames.some((a) => wordBoundary(a).test(wf));
    });
}

describe('agent namespace dispatch — every agent-dispatching skill prefixes with jlu:', () => {
  const skills = dispatchingSkills();

  test('the derived set is non-empty and includes ship + execute-task', () => {
    assert.ok(skills.length >= 5, `expected several dispatching skills, got ${skills.length}`);
    assert.ok(skills.includes('ship'), 'ship dispatches agents');
    assert.ok(skills.includes('execute-task'), 'execute-task dispatches agents');
  });

  for (const skill of dispatchingSkills()) {
    test(`${skill}: SKILL.md contract carries the jlu: prefix rule + bare fallback`, () => {
      const p = join(ROOT, 'skills', skill, 'SKILL.md');
      assert.ok(existsSync(p), `missing skills/${skill}/SKILL.md`);
      const src = readFileSync(p, 'utf8');
      assert.match(
        src,
        /jlu:jlu-/,
        `skills/${skill}/SKILL.md must instruct dispatch with the jlu: plugin-namespace prefix`,
      );
      assert.match(
        src,
        /bare `jlu-/,
        `skills/${skill}/SKILL.md must name the bare fallback for manual installs`,
      );
    });
  }
});

describe('agent namespace dispatch — no skill hardcodes a bare subagent_type', () => {
  test('every `subagent_type \\`jlu-…\\`` literal in a SKILL.md is jlu:-prefixed', () => {
    const skillsDir = join(ROOT, 'skills');
    const offenders = [];
    for (const skill of readdirSync(skillsDir)) {
      const p = join(skillsDir, skill, 'SKILL.md');
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf8');
      // Match `subagent_type ` followed by an inline-code bare jlu- name (no jlu: prefix).
      const re = /subagent_type[^\n`]*`jlu-[a-z-]+`/g;
      const hits = src.match(re) || [];
      for (const h of hits) offenders.push(`${skill}: ${h}`);
    }
    assert.deepEqual(
      offenders,
      [],
      `Hardcoded bare subagent_type literals (use jlu:jlu-<name>):\n${offenders.join('\n')}`,
    );
  });
});

// tests/unit/council-guards.test.mjs
//
// Run: `node --test tests/unit/council-guards.test.mjs`
//
// Text guards for the /jlu:council feature (design doc Revisión 5).
// The council's safety and verdict rules live as instructions in markdown
// (workflow, brief) — these guards make them enforceable: any edit that
// drops the publish consent gate, the dissent-headline rule, the
// anti-delegation wrapper or the degraded-mode banners must fail here.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const mustRead = (relPath) => {
  assert.ok(existsSync(join(ROOT, relPath)), `missing file: ${relPath}`);
  return readFileSync(join(ROOT, relPath), 'utf8');
};

describe('council brief — jelou/references/council-brief.md', () => {
  test('exists and is refute-first adversarial', () => {
    const brief = mustRead('jelou/references/council-brief.md');
    assert.match(brief, /REFUTE this idea/i);
    assert.match(brief, /\{IDEA\}/);
    assert.match(brief, /\{CASE_FILE\}/);
    assert.match(brief, /\{AGENTIC_MODE\}/);
  });

  test('demands canonical verdict tokens in JSON output', () => {
    const brief = mustRead('jelou/references/council-brief.md');
    assert.match(brief, /GO_WITH_CONDITIONS/);
    assert.match(brief, /NO_GO/);
    assert.match(brief, /refutations/);
    assert.match(brief, /evidence_from_repo/);
  });

  test('carries the anti-delegation wrapper for agentic judges', () => {
    const brief = mustRead('jelou/references/council-brief.md');
    assert.match(brief, /do not invoke or delegate to any skills, tools, agents, or councils/i);
  });

  test('forbids assuming facts and demands an uncertainties field instead', () => {
    const brief = mustRead('jelou/references/council-brief.md');
    assert.match(brief, /do not assume/i);
    assert.match(brief, /uncertainties/);
    assert.match(brief, /no live web access/i);
  });

  test('tells judges to read the accumulating deliberation as established ground', () => {
    const brief = mustRead('jelou/references/council-brief.md');
    assert.match(brief, /Deliberation so far/i);
  });
});

describe('council workflow — jelou/workflows/council.md', () => {
  test('exists', () => {
    mustRead('jelou/workflows/council.md');
  });

  test('never auto-publishes and gates publishing behind explicit confirmation', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /NEVER publish without explicit per-run confirmation/i);
    assert.doesNotMatch(wf, /auto-?publish(?!.*never)/i);
  });

  test('instructs dissent as headline, never resolved or averaged', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /dissent.*headline/i);
    assert.match(wf, /never resolve.*dissent|never.*average/i);
  });

  test('requires Unique Insights and Attribution sections in the report', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /Unique Insights/);
    assert.match(wf, /Attribution/);
  });

  test('applies correlated-agreement discount including same_family_as_arbiter', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /same_family_as_arbiter/);
    assert.match(wf, /discount/i);
  });

  test('declares degraded-mode banners with exact wording', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /NO CROSS-MODEL SIGNAL/);
    assert.match(wf, /EMPTY CASE FILE/);
    assert.match(wf, /jlu:map-codebase/);
  });

  test('asks service selection (multiSelect) when resolution yields zero or many', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /multiSelect/);
    assert.match(wf, /zero or (multiple|many)|0 or N/i);
  });

  test('presents the report path-first, never dumping content', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /absolute path/i);
    assert.match(wf, /clickable/i);
    assert.match(wf, /[Nn]ever print the COUNCIL_REPORT\.md content/);
  });

  test('visual phase is skip-if-absent with install hint', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /visual-explainer/);
    assert.match(wf, /plugin marketplace add nicobailon\/visual-explainer/);
  });

  test('labels judges agentic vs case-file-only', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /agentic/);
    assert.match(wf, /case-file-only/);
  });

  test('runs a multi-round deliberation loop to consensus', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /consensus/i);
    assert.match(wf, /round/i);
    assert.match(wf, /repeat to consensus|until.*consensus/i);
  });

  test('caps the loop so it always terminates', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /round cap|hard cap/i);
  });

  test('arbiter researches judge uncertainties via web/Perplexity and never assumes', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /uncertaint/i);
    assert.match(wf, /Perplexity/);
    assert.match(wf, /web search/i);
    assert.match(wf, /never assume|assumes/i);
  });

  test('onward routing is exclusive to /jlu-new-task and forbids other plugins', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /jlu-new-task/);
    assert.match(wf, /exclusiv/i);
    assert.match(wf, /superpowers/i);
    assert.match(wf, /gstack/i);
    assert.match(wf, /GSD/);
  });

  test('hands off via a self-sufficient seed so new-task can start in a fresh context window', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /new-task-seed\.md/);
    assert.match(wf, /self-sufficient/i);
    assert.match(wf, /fresh (window|session|context)/i);
    assert.match(wf, /cannot run inside a sub-agent/i);
  });

  test('persists arbiter research to deliberation.md before the user question', () => {
    const wf = mustRead('jelou/workflows/council.md');
    assert.match(wf, /Researched facts/);
    assert.match(wf, /deliberation\.md/);
  });
});

describe('new-task council-seed bridge — jelou/workflows/new-task.md', () => {
  test('auto-detects a pending council seed and reloads it into a fresh window', () => {
    const wf = mustRead('jelou/workflows/new-task.md');
    assert.match(wf, /new-task-seed\.md/);
    assert.match(wf, /council/i);
    assert.match(wf, /new-task-seed\.consumed\.md/);
  });
});

describe('council skill — skills/council/SKILL.md', () => {
  test('exists with frontmatter and dispatches to the workflow', () => {
    const skill = mustRead('skills/council/SKILL.md');
    assert.match(skill, /^---\nname: council\n/);
    assert.match(skill, /jelou\/workflows\/council\.md/);
  });

  test('preloads AskUserQuestion via ToolSearch like sibling skills', () => {
    const skill = mustRead('skills/council/SKILL.md');
    assert.match(skill, /select:AskUserQuestion/);
  });

  test('grants the arbiter web research and the new-task handoff tools', () => {
    const skill = mustRead('skills/council/SKILL.md');
    assert.match(skill, /WebSearch/);
    assert.match(skill, /- Skill/);
    assert.match(skill, /new-task/);
  });

  test('binds onward routing exclusively to new-task and bans other plugins', () => {
    const skill = mustRead('skills/council/SKILL.md');
    assert.match(skill, /ONLY onward routing/i);
    assert.match(skill, /superpowers/i);
    assert.match(skill, /gstack/i);
  });
});

describe('council script source — bin/council.mjs', () => {
  test('reads the brief from references (single source, no inline duplicate)', () => {
    const src = mustRead('bin/council.mjs');
    assert.match(src, /references\/council-brief\.md/);
    assert.doesNotMatch(src, /REFUTE this idea/i);
  });

  test('uses allSettled fan-out, never bare Promise.all', () => {
    const src = mustRead('bin/council.mjs');
    assert.match(src, /Promise\.allSettled/);
    assert.doesNotMatch(src, /Promise\.all\(/);
  });

  test('escalates kills SIGTERM then SIGKILL for CLI judges', () => {
    const src = mustRead('bin/council.mjs');
    assert.match(src, /SIGTERM/);
    assert.match(src, /SIGKILL/);
  });

  test('never sends the OpenRouter key through argv', () => {
    const src = mustRead('bin/council.mjs');
    assert.match(src, /OPENROUTER_API_KEY/);
  });
});

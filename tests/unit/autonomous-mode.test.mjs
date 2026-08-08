import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const CONTRACT = join(ROOT, 'jelou/references/autonomous-mode.md');
const AUTONOMOUS_WORKFLOWS = ['new-task', 'refine-task', 'map-codebase'];
const AUTONOMOUS_SKILLS = ['new-task', 'refine-task', 'map-codebase'];

const workflowText = (name) => readFileSync(join(ROOT, 'jelou/workflows', `${name}.md`), 'utf8');

test('the shared autonomous contract exists and defines the load-bearing rules', () => {
  assert.ok(existsSync(CONTRACT), 'jelou/references/autonomous-mode.md must exist');
  const text = readFileSync(CONTRACT, 'utf8');
  for (const rule of ['closed gate table', 'abort floor', 'Resolution order', 'never']) {
    assert.match(text, new RegExp(rule, 'i'), `contract must state: ${rule}`);
  }
});

for (const name of AUTONOMOUS_WORKFLOWS) {
  test(`${name} publishes an autonomous gate table pointing at the shared contract`, () => {
    const text = workflowText(name);
    assert.match(
      text,
      /## Autonomous mode — how every gate resolves/,
      `${name} must have the canonical autonomous section heading`,
    );
    assert.match(
      text,
      /jelou\/references\/autonomous-mode\.md/,
      `${name} must point at the shared contract instead of restating it`,
    );
    assert.match(
      text,
      /\|\s*Gate\s*\|\s*Site\s*\|\s*Autonomous default\s*\|/,
      `${name} must publish a gate table with the canonical columns`,
    );
    assert.match(
      text.replace(/\s+/g, ' '),
      /closed gate table/i,
      `${name} must declare its gate table closed`,
    );
  });

  test(`${name} marks every question site with its autonomous resolution`, () => {
    const text = workflowText(name);
    const body = text.split('## Autonomous mode — how every gate resolves')[1] ?? '';
    const afterTable = body.split('---').slice(1).join('---');
    const lines = afterTable.split('\n');
    const RESOLUTION_WINDOW = 9;
    lines.forEach((line, index) => {
      const isQuestionSite =
        /via `question`|using `question`|ask for approval/i.test(line) &&
        !line.trim().startsWith('>') &&
        !/MUST use `question`/.test(line);
      if (!isQuestionSite) return;
      const window = lines
        .slice(Math.max(0, index - RESOLUTION_WINDOW), index + RESOLUTION_WINDOW)
        .join(' ');
      assert.match(
        window,
        /autonomous/i,
        `${name}: this question site has no autonomous resolution within ${RESOLUTION_WINDOW} lines — every gate must be in the table:\n  ${line.trim()}`,
      );
    });
  });
}

test('new-task declares the abort floor and the assumptions disclosure channel', () => {
  const text = workflowText('new-task');
  assert.match(text, /no_derivable_requirement/, 'new-task must name the abort reason code');
  assert.match(text, /## Assumptions/, 'new-task must define the Assumptions disclosure section');
  assert.match(
    text,
    /Case-Coverage self-check/i,
    'new-task must state the case-coverage floor is not waivable by autonomous mode',
  );
});

test('refine-task declares its abort reason and appends rather than rewrites assumptions', () => {
  const text = workflowText('refine-task');
  assert.match(text, /no_change_description/, 'refine-task must name the abort reason code');
  assert.match(text, /never rewriting it/i, 'refine-task must append to prior assumptions');
});

test('map-codebase states it has no abort floor and never invents concerns', () => {
  const text = workflowText('map-codebase');
  assert.match(text, /No abort floor/i, 'map-codebase has no contract to be missing');
  assert.match(
    text,
    /never.*invent|write a concern the code does not evidence/is,
    'map-codebase must ban inventing concerns when the interview is deferred',
  );
});

for (const name of AUTONOMOUS_SKILLS) {
  test(`${name} skill resolves the autonomous flag explicitly, never by inference`, () => {
    const text = readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
    assert.match(text, /--autonomous/, `${name} skill must accept the --autonomous flag`);
    assert.match(text, /JLU_AUTONOMOUS/, `${name} skill must honour the env variable`);
    assert.match(
      text,
      /[Nn]ever infer autonomous mode/,
      `${name} skill must forbid inferring autonomous mode from context`,
    );
  });

  test(`${name} skill states the autonomous exception where the question ban is written`, () => {
    const lines = readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').split('\n');
    const banIndex = lines.findIndex((line) => /Never skip a prescribed question/.test(line));
    assert.notEqual(banIndex, -1, `${name} skill must still carry the question ban`);
    const nearBan = lines.slice(banIndex, banIndex + 3).join(' ');
    assert.match(
      nearBan,
      /autonomous/i,
      `${name}: the question ban must carry its autonomous exception inline — a model reading top-down would otherwise take the ban as absolute and block on a gate the caller already authorised`,
    );
  });

  test(`${name} OpenCode command carries the autonomous contract`, () => {
    const path = join(ROOT, '.opencode/commands', `jlu-${name}.md`);
    assert.ok(existsSync(path), `hand-authored OpenCode command missing for ${name}`);
    const text = readFileSync(path, 'utf8');
    assert.match(text, /--autonomous/, `jlu-${name} OpenCode command must document the flag`);
  });
}

test('only Codex skills whose workflow has a gate table carry the autonomous exception', () => {
  const skillsDir = join(ROOT, '.codex/skills');
  const workflowsDir = join(ROOT, 'jelou/workflows');
  const CLAUSE = 'Autonomous mode is the one exception';

  for (const entry of readdirSync(skillsDir)) {
    const skillPath = join(skillsDir, entry, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const carriesClause = readFileSync(skillPath, 'utf8').includes(CLAUSE);
    const workflowPath = join(workflowsDir, `${entry.replace(/^jlu-/, '')}.md`);
    const hasGateTable =
      existsSync(workflowPath) &&
      readFileSync(workflowPath, 'utf8').includes('## Autonomous mode — how every gate resolves');

    assert.equal(
      carriesClause,
      hasGateTable,
      carriesClause
        ? `${entry} tells Codex it may skip questions, but its workflow publishes no gate table — a model could over-generalize and skip a gate with no documented default`
        : `${entry}'s workflow has a gate table but the Codex mirror never grants the exception, so autonomous mode would still block on Codex`,
    );
  }
});

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('intra-service needs field', () => {
  test('phase template carries a **Needs:** line right after the title', () => {
    const tpl = read('jelou/templates/phase.md');
    assert.match(tpl, /^# Phase \{\{number\}\}: \{\{Phase Name\}\}\n\*\*Needs:\*\* none$/m);
  });

  test('proposal-agent instructs stamping **Needs:** on each phase file from same-service deps', () => {
    const agent = read('agents/jlu-proposal-agent.md');
    assert.match(agent, /\*\*Needs:\*\*/);
    assert.match(agent, /same-service|same service|within (the|this) service/i);
  });

  test('execute-task Step 7.0 documents that a wave may hold >1 same-service phase via **Needs:**', () => {
    const wf = read('jelou/workflows/execute-task.md');
    assert.match(wf, /\*\*Needs:\*\*/);
  });
});

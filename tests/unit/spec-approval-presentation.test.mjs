// tests/unit/spec-approval-presentation.test.mjs
//
// Run: `node --test tests/unit/spec-approval-presentation.test.mjs`
//
// Guards the spec approval gate UX. At the end of the interview the
// orchestrator must surface the SPEC.md file path (absolute, clickable —
// the user reviews the spec in their editor) instead of dumping the full
// spec content into the terminal. Any edit that re-introduces the old
// "present the complete SPEC.md" wording must fail here.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (relPath) => readFileSync(join(ROOT, relPath), 'utf8');

const PRESENTERS = ['jelou/workflows/new-task.md'];

const AUTHORS = [
  'agents/jlu-spec-interviewer.md',
  '.opencode/agents/jlu-spec-interviewer.md',
];

describe('spec approval gate — path over content dump', () => {
  for (const file of PRESENTERS) {
    describe(file, () => {
      const content = read(file);

      test('does not instruct presenting the full SPEC.md content', () => {
        assert.doesNotMatch(content, /present the complete (rewritten )?SPEC\.md/i);
      });

      test('forbids printing SPEC.md content in the terminal', () => {
        assert.match(content, /[Nn]ever print the SPEC\.md content/);
      });

      test('instructs printing the spec path as absolute and clickable', () => {
        assert.match(content, /absolute path/i);
        assert.match(content, /clickable/i);
      });
    });
  }
});

describe('spec author — receipt over body', () => {
  for (const file of AUTHORS) {
    describe(file, () => {
      const content = read(file);

      test('does not instruct presenting the full SPEC.md content', () => {
        assert.doesNotMatch(content, /present the complete (rewritten )?SPEC\.md/i);
      });

      test('forbids returning the spec body to the orchestrator', () => {
        assert.match(content, /[Nn]ever return the spec body/);
      });

      test('returns a receipt carrying paths and counts', () => {
        assert.match(content, /SPEC_WRITTEN:/);
        assert.match(content, /STORIES_WRITTEN:/);
        assert.match(content, /COUNTS:/);
      });

      test('is not granted AskUserQuestion, since the interview stays inline', () => {
        const frontmatter = content.slice(0, content.indexOf('---', 3));
        assert.doesNotMatch(frontmatter, /AskUserQuestion/);
      });
    });
  }
});

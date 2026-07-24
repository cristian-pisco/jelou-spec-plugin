import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const releaseWorkflowPath = new URL('../../.github/workflows/release.yml', import.meta.url);
const claudeInstructionsPath = new URL('../../CLAUDE.md', import.meta.url);

test('release workflow runs only after a successful main push test run', async () => {
  const workflow = await readFile(releaseWorkflowPath, 'utf8');

  assert.match(workflow, /workflows: \[test\]/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
});

test('release workflow publishes an untagged version or bumps a tagged version', async () => {
  const workflow = await readFile(releaseWorkflowPath, 'utf8');

  assert.match(workflow, /refs\/tags\/v\$current_version/);
  assert.match(workflow, /npm run release -- -m "\$subject"/);
  assert.match(workflow, /gh release create "v\$VERSION" --target main/);
});

test('Claude instructions do not require a manual release', async () => {
  const instructions = await readFile(claudeInstructionsPath, 'utf8');

  assert.doesNotMatch(instructions, /npm run release/);
  assert.doesNotMatch(instructions, /Releasing \(one bump per feature\)/);
});

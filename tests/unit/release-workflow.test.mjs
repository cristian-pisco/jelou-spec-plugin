import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const releaseWorkflowPath = new URL('../../.github/workflows/release.yml', import.meta.url);
const readmePath = new URL('../../README.md', import.meta.url);

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

test('the documentation does not require a manual release', async () => {
  const readme = await readFile(readmePath, 'utf8');

  assert.doesNotMatch(readme, /npm run release/);
  assert.doesNotMatch(readme, /Releasing \(one bump per feature\)/);
});

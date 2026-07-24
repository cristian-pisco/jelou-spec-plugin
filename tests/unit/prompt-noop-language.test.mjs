import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const forbiddenFragments = [
  'be thorough',
  'pragmatic tech lead',
  'go deep',
  'non-obvious',
  'continue until complete',
  'confidently',
  'invisible in a diff/style review',
  'invisible in a diff review',
  'invisible in a style review',
  'quality over quantity',
  'obvious inconsistencies',
  'sensible order',
  'clear enough',
  'proper test fixtures',
  'meaningful message',
  'bounded and honest',
  'window is still light',
  'as in other skills',
  'complete picture',
  'no surprises',
  'surgical',
];

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

test('canonical prompts contain no prohibited no-op language', () => {
  const files = [
    ...markdownFiles(join(repositoryRoot, 'agents')),
    ...markdownFiles(join(repositoryRoot, 'skills')),
    ...markdownFiles(join(repositoryRoot, 'jelou/workflows')),
    join(repositoryRoot, 'jelou/references/subagent-base.md'),
  ];
  const violations = files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        forbiddenFragments
          .filter((fragment) => line.toLowerCase().includes(fragment))
          .map((fragment) => `${relative(repositoryRoot, file)}:${index + 1}: ${fragment}`),
      ),
  );

  assert.equal(
    violations.length,
    0,
    `Prohibited prompt language:\n${violations.join('\n')}`,
  );
});

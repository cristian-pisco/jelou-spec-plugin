import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseStory,
  validateStory,
  coverageLint,
  parseServiceIds,
  parseSpecFrIds,
} from '../../bin/validate-stories.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'bin', 'validate-stories.mjs');

const KNOWN = ['datum-service', 'gateway'];

function story(frontmatter, acceptance) {
  return `---\n${frontmatter}\n---\n\n# A story\n\n## Story\nAs a x, I want y, so that z.\n\n## Acceptance Criteria\n${acceptance}\n`;
}

const VALID_FM = [
  'id: us-1',
  'title: Attach a filter to a column',
  'actor: ops manager',
  'services: [datum-service, gateway]',
  'depends-on: []',
  'service-order: [datum-service, gateway]',
  'covers: [FR-1, FR-2]',
].join('\n');

const VALID_ACCEPTANCE = [
  '- [success] valid input resolves',
  '- [rejection @IsNumber columnId] columnId="guid" -> 400',
  '- [realistic] filter references a real column id -> non-empty',
  '- [boundary] empty collection and its populated counterpart',
].join('\n');

describe('validate-stories — parseStory()', () => {
  test('parses frontmatter, flow lists and acceptance labels', () => {
    const parsed = parseStory(story(VALID_FM, VALID_ACCEPTANCE));
    assert.equal(parsed.frontmatter.id, 'us-1');
    assert.deepEqual(parsed.frontmatter.services, ['datum-service', 'gateway']);
    assert.deepEqual(parsed.frontmatter.covers, ['FR-1', 'FR-2']);
    assert.deepEqual(parsed.frontmatter['depends-on'], []);
    assert.deepEqual(parsed.acceptanceLabels, [
      'success',
      'rejection',
      'realistic',
      'boundary',
    ]);
  });

  test('malformed frontmatter yields null frontmatter', () => {
    const parsed = parseStory('# no frontmatter here\n\n## Story\ntext');
    assert.equal(parsed.frontmatter, null);
  });
});

describe('validate-stories — validateStory()', () => {
  test('a valid story has no errors', () => {
    const r = validateStory(story(VALID_FM, VALID_ACCEPTANCE), { knownServices: KNOWN });
    assert.deepEqual(r.errors, []);
    assert.equal(r.id, 'us-1');
  });

  test('missing services is an error naming the field', () => {
    const fm = VALID_FM.split('\n').filter((l) => !l.startsWith('services:')).join('\n');
    const r = validateStory(story(fm, VALID_ACCEPTANCE), { knownServices: KNOWN });
    assert.ok(r.errors.some((e) => /services/.test(e)));
  });

  test('unknown service is an error naming story and service', () => {
    const fm = VALID_FM.replace('[datum-service, gateway]', '[datum-service, ghost-service]');
    const r = validateStory(story(fm, VALID_ACCEPTANCE), { knownServices: KNOWN });
    assert.ok(r.errors.some((e) => /ghost-service/.test(e) && /us-1/.test(e)));
  });

  test('missing [success] acceptance is an error', () => {
    const accept = [
      '- [rejection] bad payload -> 400',
      '- [boundary] empty collection',
    ].join('\n');
    const r = validateStory(story(VALID_FM, accept), { knownServices: KNOWN });
    assert.ok(r.errors.some((e) => /success/.test(e)));
  });

  test('missing covers is an error', () => {
    const fm = VALID_FM.split('\n').filter((l) => !l.startsWith('covers:')).join('\n');
    const r = validateStory(story(fm, VALID_ACCEPTANCE), { knownServices: KNOWN });
    assert.ok(r.errors.some((e) => /covers/.test(e)));
  });

  test('malformed frontmatter is a single clear error naming the story file', () => {
    const r = validateStory('# no frontmatter\n\ntext', { knownServices: KNOWN, name: '01-x.story.md' });
    assert.equal(r.errors.length, 1);
    assert.ok(/01-x\.story\.md/.test(r.errors[0]));
    assert.ok(/frontmatter/.test(r.errors[0]));
  });

  test('unknown-service check is skipped when knownServices is not provided', () => {
    const fm = VALID_FM.replace('[datum-service, gateway]', '[anything-goes]');
    const r = validateStory(story(fm, VALID_ACCEPTANCE), {});
    assert.deepEqual(r.errors, []);
  });
});

describe('validate-stories — coverageLint()', () => {
  const stories = [
    { id: 'us-1', covers: ['FR-1'] },
    { id: 'us-2', covers: ['FR-2', 'FR-3'] },
  ];

  test('every FR mapped to >=1 story passes', () => {
    const r = coverageLint(['FR-1', 'FR-2', 'FR-3'], stories);
    assert.equal(r.ok, true);
    assert.deepEqual(r.missingFrs, []);
    assert.deepEqual(r.orphanStories, []);
  });

  test('an FR with no story is flagged', () => {
    const r = coverageLint(['FR-1', 'FR-2', 'FR-3', 'FR-4'], stories);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missingFrs, ['FR-4']);
  });

  test('an orphan story (covers no real FR) is flagged', () => {
    const withOrphan = [...stories, { id: 'us-9', covers: ['FR-99'] }];
    const r = coverageLint(['FR-1', 'FR-2', 'FR-3'], withOrphan);
    assert.equal(r.ok, false);
    assert.deepEqual(r.orphanStories, ['us-9']);
    assert.deepEqual(r.unknownFrRefs, ['FR-99']);
  });

  test('id-match ignores prose — same id different title still counts', () => {
    const r = coverageLint(['FR-1'], [{ id: 'us-1', covers: ['FR-1'], title: 'wording differs' }]);
    assert.equal(r.ok, true);
  });
});

describe('validate-stories — parsers', () => {
  test('parseServiceIds reads ids from services.yaml block style', () => {
    const yaml = [
      'services:',
      '  - id: datum-service',
      '    stack: nestjs',
      '    docker:',
      '      service: datum-api',
      '  - id: gateway',
      '    stack: nestjs',
    ].join('\n');
    assert.deepEqual(parseServiceIds(yaml), ['datum-service', 'gateway']);
  });

  test('parseSpecFrIds reads FR ids from the Functional section', () => {
    const spec = [
      '## Requirements',
      '### Functional',
      '- FR-1: do a thing',
      '- FR-2: do another',
      '### Non-Functional',
      '- NFR-1: fast',
      '## Success Criteria',
      '- SC-1 [success] (FR-1): works',
    ].join('\n');
    assert.deepEqual(parseSpecFrIds(spec), ['FR-1', 'FR-2']);
  });
});

describe('validate-stories — CLI', () => {
  function run(args) {
    const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  }

  function scaffold() {
    const dir = mkdtempSync(join(tmpdir(), 'validate-stories-'));
    const storiesDir = join(dir, 'stories');
    mkdirSync(storiesDir);
    writeFileSync(join(dir, 'services.yaml'), 'services:\n  - id: datum-service\n  - id: gateway\n');
    writeFileSync(
      join(dir, 'SPEC.md'),
      '## Requirements\n### Functional\n- FR-1: a\n- FR-2: b\n',
    );
    return { dir, storiesDir };
  }

  test('valid stories + spec coverage exits 0', () => {
    const { dir, storiesDir } = scaffold();
    writeFileSync(join(storiesDir, '01-a.story.md'), story(VALID_FM.replace('[FR-1, FR-2]', '[FR-1]'), VALID_ACCEPTANCE));
    writeFileSync(
      join(storiesDir, '02-b.story.md'),
      story(VALID_FM.replace('id: us-1', 'id: us-2').replace('[FR-1, FR-2]', '[FR-2]'), VALID_ACCEPTANCE),
    );
    const r = run([storiesDir, '--services', join(dir, 'services.yaml'), '--spec', join(dir, 'SPEC.md')]);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).ok, true);
  });

  test('an invalid story exits 1 with a message naming it', () => {
    const { dir, storiesDir } = scaffold();
    const fm = VALID_FM.replace('[datum-service, gateway]', '[ghost-service]').replace('[FR-1, FR-2]', '[FR-1]');
    writeFileSync(join(storiesDir, '01-a.story.md'), story(fm, VALID_ACCEPTANCE));
    writeFileSync(join(storiesDir, '02-b.story.md'), story(VALID_FM.replace('id: us-1', 'id: us-2').replace('[FR-1, FR-2]', '[FR-2]'), VALID_ACCEPTANCE));
    const r = run([storiesDir, '--services', join(dir, 'services.yaml'), '--spec', join(dir, 'SPEC.md')]);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(r.code, 1);
    assert.match(r.err, /ghost-service/);
  });

  test('a missing FR (coverage gap) exits 1', () => {
    const { dir, storiesDir } = scaffold();
    writeFileSync(join(storiesDir, '01-a.story.md'), story(VALID_FM.replace('[FR-1, FR-2]', '[FR-1]'), VALID_ACCEPTANCE));
    const r = run([storiesDir, '--services', join(dir, 'services.yaml'), '--spec', join(dir, 'SPEC.md')]);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(r.code, 1);
    assert.match(r.err, /FR-2/);
  });

  test('a missing stories dir does not crash (legacy fallback)', () => {
    const r = run([join(tmpdir(), 'does-not-exist-stories-xyz')]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).storiesPresent, false);
  });

  test('--version prints semver and exits 0', () => {
    const r = run(['--version']);
    assert.equal(r.code, 0);
    assert.match(r.out, /^\d+\.\d+\.\d+$/);
  });
});

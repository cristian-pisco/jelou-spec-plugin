// tests/unit/glossary-merge.test.mjs
//
// Run: `node --test tests/unit/glossary-merge.test.mjs`
// Node 20+ required.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MERGER = new URL('../../bin/glossary-merge.mjs', import.meta.url).pathname;

function setupWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'glossary-'));
  const glossary = join(root, 'glossary');
  const tmp = join(glossary, '.tmp');
  mkdirSync(tmp, { recursive: true });
  return { root, glossary, tmp };
}

function runMerger(args) {
  return spawnSync('node', [MERGER, ...args], { encoding: 'utf8' });
}

describe('glossary-merge — happy path', () => {
  test('merges a single fragment into a fresh candidates.json', () => {
    const { glossary, tmp } = setupWorkspace();
    const fragment = join(tmp, 'datum-service.candidates.json');

    writeFileSync(fragment, JSON.stringify({
      service_id: 'datum-service',
      scanned_commit: 'a1b2c3d',
      candidates: [
        {
          term: 'Datum',
          evidence: [
            { path: 'src/datum/datum.entity.ts', line: 10, kind: 'entity-class', snippet: 'class Datum' }
          ],
          location_role: 'definition',
          heuristic_confidence: 'high'
        }
      ],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.version, 1);
    assert.equal(merged.candidates.length, 1);
    assert.equal(merged.candidates[0].term, 'Datum');
    assert.equal(merged.candidates[0].discovered_in_services[0], 'datum-service');
    assert.equal(merged.candidates[0].evidence[0].service, 'datum-service');
    assert.deepEqual(merged.promoted, []);
    assert.deepEqual(merged.dropped, []);
  });
});

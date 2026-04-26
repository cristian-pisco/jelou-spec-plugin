// tests/unit/glossary-merge.test.mjs
//
// Run: `node --test tests/unit/glossary-merge.test.mjs`
// Node 20+ required.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
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

describe('glossary-merge — multi-service union', () => {
  test('two fragments with the same term union evidence and discovered_in_services', () => {
    const { glossary, tmp } = setupWorkspace();

    writeFileSync(join(tmp, 'datum-service.candidates.json'), JSON.stringify({
      service_id: 'datum-service',
      scanned_commit: 'a1b2c3d',
      candidates: [{
        term: 'Datum',
        evidence: [{ path: 'src/datum/datum.entity.ts', line: 10, kind: 'entity-class' }],
        location_role: 'definition',
        heuristic_confidence: 'high'
      }],
      location_updates: []
    }));

    writeFileSync(join(tmp, 'jelou-api.candidates.json'), JSON.stringify({
      service_id: 'jelou-api',
      scanned_commit: 'e4f5g6h',
      candidates: [{
        term: 'Datum',
        evidence: [{ path: 'src/clients/datum.ts', line: 5, kind: 'client-import' }],
        location_role: 'reference',
        heuristic_confidence: 'medium'
      }],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.candidates.length, 1, 'should have only one Datum entry');
    const datum = merged.candidates[0];
    assert.deepEqual(new Set(datum.discovered_in_services), new Set(['datum-service', 'jelou-api']));
    assert.equal(datum.evidence.length, 2);
    assert.equal(datum.heuristic_confidence, 'high', 'highest confidence wins');
  });
});

describe('glossary-merge — exclusion lists', () => {
  test('terms in dropped[] are not re-added even if extractor proposes them', () => {
    const { glossary, tmp } = setupWorkspace();

    // Pre-existing candidates.json with a dropped term.
    writeFileSync(join(glossary, 'candidates.json'), JSON.stringify({
      version: 1,
      updated_at: '2026-04-26T10:00:00Z',
      candidates: [],
      promoted: [],
      dropped: [{ term: 'Helper', dropped_at: '2026-04-26T10:00:00Z', reason: 'too generic' }]
    }));

    writeFileSync(join(tmp, 'svc.candidates.json'), JSON.stringify({
      service_id: 'svc',
      scanned_commit: 'aaa',
      candidates: [{
        term: 'Helper',
        evidence: [{ path: 'src/helper.ts', line: 1, kind: 'class-declaration' }],
        location_role: 'definition',
        heuristic_confidence: 'medium'
      }],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.candidates.length, 0, 'dropped term must not be re-added');
    assert.equal(merged.dropped.length, 1, 'dropped entry preserved');
  });

  test('terms in promoted[] are not re-added (already canonical)', () => {
    const { glossary, tmp } = setupWorkspace();

    writeFileSync(join(glossary, 'candidates.json'), JSON.stringify({
      version: 1,
      updated_at: '2026-04-26T10:00:00Z',
      candidates: [],
      promoted: [{ term: 'Workflow', promoted_at: '2026-04-26T10:00:00Z' }],
      dropped: []
    }));

    writeFileSync(join(tmp, 'svc.candidates.json'), JSON.stringify({
      service_id: 'svc',
      scanned_commit: 'bbb',
      candidates: [{
        term: 'Workflow',
        evidence: [{ path: 'src/workflow.entity.ts', line: 1, kind: 'entity-class' }],
        location_role: 'definition',
        heuristic_confidence: 'high'
      }],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.candidates.length, 0, 'promoted term must not be re-added as candidate');
  });
});

describe('glossary-merge — fragment cleanup', () => {
  test('deletes fragments after successful merge', () => {
    const { glossary, tmp } = setupWorkspace();
    const fragPath = join(tmp, 'svc.candidates.json');

    writeFileSync(fragPath, JSON.stringify({
      service_id: 'svc',
      scanned_commit: 'ccc',
      candidates: [],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0);

    assert.equal(existsSync(fragPath), false, 'fragment should be deleted');
  });
});

describe('glossary-merge — atomicity', () => {
  test('does not delete fragments if writing candidates.json fails', () => {
    const { glossary, tmp } = setupWorkspace();
    const fragPath = join(tmp, 'svc.candidates.json');

    writeFileSync(fragPath, JSON.stringify({
      service_id: 'svc',
      scanned_commit: 'fff',
      candidates: [{
        term: 'Datum',
        evidence: [{ path: 'src/datum.ts', line: 1, kind: 'entity-class' }],
        location_role: 'definition',
        heuristic_confidence: 'high'
      }],
      location_updates: []
    }));

    // Force the candidates.json write to fail by creating a directory at that path.
    mkdirSync(join(glossary, 'candidates.json'));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.notEqual(result.status, 0, 'merger should exit non-zero on write failure');
    assert.equal(existsSync(fragPath), true, 'fragment must NOT be deleted when write fails');
  });
});

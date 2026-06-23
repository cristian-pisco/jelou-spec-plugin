// tests/unit/coverage-breadth-gate.test.mjs
//
// Guards the /jlu-production-like Phase 4.5 coverage-breadth gate:
//  1. bin/probe-coverage-breadth.mjs flips thin -> broad once a validated DTO
//     field gains a rejecting-payload test (the GUID-into-@IsNumber 400 shape),
//     and flags collection fields exercised only empty.
//  2. The workflow prose for the gate + the two false-green guards survive edits
//     (production-like.md, test-suite.md, ui-qa-run.md).
//
// Run: `node --test tests/unit/coverage-breadth-gate.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCoverageBreadth } from '../../bin/probe-coverage-breadth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCRIPT = join(ROOT, 'bin', 'probe-coverage-breadth.mjs');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const NUMERIC_DTO = {
  name: 'create-database.dto.ts',
  content: `class CreateDatabaseDto {\n  @IsNumber()\n  columnId: number;\n}`,
};
const ARRAY_DTO = {
  name: 'create-with-filters.dto.ts',
  content: `class CreateWithFiltersDto {\n  @IsArray()\n  columns: string[];\n}`,
};

describe('auditCoverageBreadth — rejection coverage per validator', () => {
  test('a validated field with only a happy-path test is thin', () => {
    const testFiles = [
      {
        name: 'databases.spec.ts',
        content: `it('creates a database', async () => {
          const res = await post('/databases', { columnId: 1 });
          expect(res.status).toBe(201);
        });`,
      },
    ];
    const r = auditCoverageBreadth({ dtoFiles: [NUMERIC_DTO], testFiles });
    assert.equal(r.verdict, 'thin');
    assert.ok(r.dto_fields_without_rejection.some((f) => f.endsWith('columnId')));
  });

  test('the same field becomes broad once a rejecting payload is asserted', () => {
    const testFiles = [
      {
        name: 'databases.spec.ts',
        content: `it('rejects a guid for a numeric column id', async () => {
          const res = await post('/databases', { columnId: 'a-guid-string' });
          expect(res.status).toBe(400);
        });`,
      },
    ];
    const r = auditCoverageBreadth({ dtoFiles: [NUMERIC_DTO], testFiles });
    assert.equal(r.verdict, 'broad');
    assert.deepEqual(r.dto_fields_without_rejection, []);
  });
});

describe('auditCoverageBreadth — collection realism', () => {
  test('a collection field only ever exercised empty is thin', () => {
    const testFiles = [
      {
        name: 'databases.spec.ts',
        content: `it('rejects an empty filter set', async () => {
          const res = await post('/databases', { columns: [] });
          expect(res.status).toBe(400);
        });`,
      },
    ];
    const r = auditCoverageBreadth({ dtoFiles: [ARRAY_DTO], testFiles });
    assert.equal(r.verdict, 'thin');
    assert.ok(r.collections_only_empty.some((f) => f.endsWith('columns')));
  });

  test('a populated collection plus a rejecting payload is broad', () => {
    const testFiles = [
      {
        name: 'databases.spec.ts',
        content: `it('creates with a populated filter', async () => {
          const res = await post('/databases', { columns: ['name'] });
          expect(res.status).toBe(201);
        });
        it('rejects a malformed filter', async () => {
          const res = await post('/databases', { columns: 123 });
          expect(res.status).toBe(400);
        });`,
      },
    ];
    const r = auditCoverageBreadth({ dtoFiles: [ARRAY_DTO], testFiles });
    assert.equal(r.verdict, 'broad');
  });

  test('no DTOs to audit is broad (nothing to check)', () => {
    const r = auditCoverageBreadth({ dtoFiles: [], testFiles: [] });
    assert.equal(r.verdict, 'broad');
    assert.deepEqual(r.uncovered_dimensions, []);
  });
});

describe('probe-coverage-breadth — CLI', () => {
  test('--version prints semver and exits 0', () => {
    const r = spawnSync('node', [SCRIPT, '--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  test('--service over a thin worktree exits 4 with JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'breadth-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'thing.dto.ts'), NUMERIC_DTO.content);
      writeFileSync(
        join(dir, 'src', 'thing.spec.ts'),
        `it('happy', () => { post({ columnId: 1 }); expect(res.status).toBe(201); });`,
      );
      const r = spawnSync('node', [SCRIPT, '--service', dir, '--json'], { encoding: 'utf8' });
      assert.equal(r.status, 4);
      const out = JSON.parse(r.stdout.trim());
      assert.equal(out.verdict, 'thin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing --service and --dto exits 1', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 1);
  });

  test('--dto scoped mode audits only the named DTO (for create-pr)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'breadth-dto-'));
    try {
      const dtoPath = join(dir, 'changed.dto.ts');
      writeFileSync(dtoPath, NUMERIC_DTO.content);
      // a legacy DTO in the same tree must NOT be audited in --dto mode
      writeFileSync(join(dir, 'legacy.dto.ts'), 'class L { @IsUUID() ownerId: string; }');
      const r = spawnSync('node', [SCRIPT, '--service', dir, '--dto', dtoPath, '--json'], { encoding: 'utf8' });
      assert.equal(r.status, 4);
      const out = JSON.parse(r.stdout.trim());
      assert.ok(out.dto_fields_without_rejection.some((f) => f.endsWith('columnId')));
      assert.ok(!out.dto_fields_without_rejection.some((f) => f.endsWith('ownerId')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('production-like.md — Phase 4.5 gate prose', () => {
  const wf = read('jelou/workflows/production-like.md');
  test('documents the coverage-breadth + realistic-payload gate', () => {
    assert.match(wf, /Coverage-breadth \+ realistic-payload gate/i);
  });
  test('introduces the advisory PASS-THIN / NEEDS-BREADTH verdict', () => {
    assert.match(wf, /PASS-THIN/);
    assert.match(wf, /NEEDS-BREADTH/);
  });
  test('routes the gap to the upstream authors, never authoring itself', () => {
    assert.match(wf, /--allow-test-edits/);
    assert.match(wf, /never author/i);
  });
  test('references the breadth-audit bin helper', () => {
    assert.match(wf, /probe-coverage-breadth\.mjs/);
  });
});

describe('false-green guards in the delegates', () => {
  test('test-suite.md: green is not a breadth verdict', () => {
    assert.match(read('jelou/workflows/test-suite.md'), /green != broad/);
  });
  test('ui-qa-run.md: minimal_input_coverage guard under production-like', () => {
    assert.match(read('jelou/workflows/ui-qa-run.md'), /minimal_input_coverage/);
  });
});

describe('ship.md — breadth gate on the always-run PR path', () => {
  const wf = read('jelou/workflows/ship.md');
  test('runs the static auditor scoped to changed DTOs', () => {
    assert.match(wf, /probe-coverage-breadth\.mjs/);
    assert.match(wf, /--dto/);
  });
  test('prompts on a happy-path-only PARTIALLY_COVERED (breadth) requirement', () => {
    assert.match(wf, /PARTIALLY_COVERED \(breadth\)/);
  });
});

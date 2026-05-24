// tests/unit/classify-phase.test.mjs
//
// Tests for bin/classify-phase.sh — the 4 subcommands (mode | trivial |
// additive | compilable) that replace inline Bash classifiers in
// execute-task.md Steps 7c.1, 7e.1, 7h, and 7k.
//
// Run: `node --test tests/unit/classify-phase.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'bin', 'classify-phase.sh');

function parseOutput(stdout) {
  const out = {};
  for (const line of stdout.split('\n')) {
    if (!line.includes('=')) continue;
    const idx = line.indexOf('=');
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function runScript(subcommand, env) {
  const result = spawnSync('bash', [SCRIPT_PATH, subcommand], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: parseOutput(result.stdout),
  };
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'classify-phase-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'baseline.txt'), 'x\n');
  git(dir, 'add', 'baseline.txt');
  git(dir, 'commit', '-q', '-m', 'baseline');
  return dir;
}

// ===========================================================================
// mode subcommand
// ===========================================================================
describe('classify-phase.sh mode', () => {
  function writePhase(dir, contents) {
    const path = join(dir, 'phase.md');
    writeFileSync(path, contents);
    return path;
  }

  test('errors when phase file is missing', () => {
    const r = runScript('mode', {
      CLASSIFY_PHASE_FILE: '/nonexistent/phase.md',
      CLASSIFY_SERVICES_IN_PHASE: '1',
    });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /phase file not found/);
  });

  test('vertical when FR count ≤ 5 and single service', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-mode-'));
    try {
      const path = writePhase(dir, [
        '# Phase 01',
        '',
        '## Requirements (immutable)',
        '- FR-1: Add foo',
        '- FR-2: Add bar',
        '- NFR-3: Latency',
      ].join('\n'));
      const r = runScript('mode', {
        CLASSIFY_PHASE_FILE: path,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.mode, 'vertical');
      assert.equal(r.parsed.fr_nfr_count, '3');
      assert.equal(r.parsed.frontmatter_override, 'none');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('horizontal when FR count > 5', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-mode-'));
    try {
      const reqs = [1, 2, 3, 4, 5, 6, 7].map(i => `- FR-${i}: req ${i}`).join('\n');
      const path = writePhase(dir, [
        '# Phase 02',
        '',
        '## Requirements (immutable)',
        reqs,
      ].join('\n'));
      const r = runScript('mode', {
        CLASSIFY_PHASE_FILE: path,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.mode, 'horizontal');
      assert.equal(r.parsed.fr_nfr_count, '7');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('horizontal when multi-service even with ≤5 FRs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-mode-'));
    try {
      const path = writePhase(dir, [
        '# Phase 03',
        '',
        '## Requirements (immutable)',
        '- FR-1: x',
      ].join('\n'));
      const r = runScript('mode', {
        CLASSIFY_PHASE_FILE: path,
        CLASSIFY_SERVICES_IN_PHASE: '2',
      });
      assert.equal(r.parsed.mode, 'horizontal');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('docs mode honored when validation passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-mode-'));
    try {
      const path = writePhase(dir, [
        '# Phase 08',
        '',
        '**Mode: docs**',
        '',
        '## Requirements (immutable)',
        '- FR-1: Document the deployment checklist in CONVENTIONS.md',
        '- FR-2: Update README with the new section names',
      ].join('\n'));
      const r = runScript('mode', {
        CLASSIFY_PHASE_FILE: path,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.mode, 'docs');
      assert.equal(r.parsed.frontmatter_override, 'docs');
      assert.equal(r.parsed.docs_validation, 'passed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('docs override rejected when requirements contain code-change verb', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-mode-'));
    try {
      const path = writePhase(dir, [
        '# Phase 09',
        '',
        '**Mode: docs**',
        '',
        '## Requirements (immutable)',
        '- FR-1: Implement the auth controller',
      ].join('\n'));
      const r = runScript('mode', {
        CLASSIFY_PHASE_FILE: path,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.parsed.mode, 'vertical'); // falls back to size gate
      assert.equal(r.parsed.docs_validation, 'failed');
      assert.match(r.parsed.docs_rejection_reason, /implement|controller/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('horizontal frontmatter override honored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-mode-'));
    try {
      const path = writePhase(dir, [
        '# Phase 06',
        '',
        '**Mode: horizontal**',
        '',
        '## Requirements (immutable)',
        '- FR-1: x',
      ].join('\n'));
      const r = runScript('mode', {
        CLASSIFY_PHASE_FILE: path,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.parsed.mode, 'horizontal');
      assert.equal(r.parsed.frontmatter_override, 'horizontal');
      assert.equal(r.parsed.reason, 'frontmatter_override');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('vertical frontmatter override rejected by size gate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-mode-'));
    try {
      const reqs = [1, 2, 3, 4, 5, 6].map(i => `- FR-${i}: req`).join('\n');
      const path = writePhase(dir, [
        '# Phase 04',
        '',
        '**Mode: vertical**',
        '',
        '## Requirements (immutable)',
        reqs,
      ].join('\n'));
      const r = runScript('mode', {
        CLASSIFY_PHASE_FILE: path,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.parsed.mode, 'horizontal');
      assert.equal(r.parsed.reason, 'vertical_override_rejected_by_size_gate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// trivial subcommand
// ===========================================================================
describe('classify-phase.sh trivial', () => {
  test('default classifier: trivial when small diff, no risky files, single service', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'small.ts'), 'a\nb\nc\n');
      git(dir, 'add', 'small.ts');
      const r = runScript('trivial', {
        CLASSIFY_SOURCE_PATH: dir,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.trivial, 'true');
      assert.equal(r.parsed.has_lockfile, 'false');
      assert.equal(r.parsed.has_migration, 'false');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('default classifier: not trivial when diff > 20 lines', () => {
    const dir = setupRepo();
    try {
      const lots = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
      writeFileSync(join(dir, 'big.ts'), lots + '\n');
      git(dir, 'add', 'big.ts');
      const r = runScript('trivial', {
        CLASSIFY_SOURCE_PATH: dir,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.parsed.trivial, 'false');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('default classifier: not trivial when lockfile changes', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'package-lock.json'), '{"x":1}\n');
      git(dir, 'add', 'package-lock.json');
      const r = runScript('trivial', {
        CLASSIFY_SOURCE_PATH: dir,
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.parsed.trivial, 'false');
      assert.equal(r.parsed.has_lockfile, 'true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('frontmatter override accepted on small diff', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'a\nb\n');
      git(dir, 'add', 'a.ts');
      const r = runScript('trivial', {
        CLASSIFY_SOURCE_PATH: dir,
        CLASSIFY_SERVICES_IN_PHASE: '1',
        CLASSIFY_FRONTMATTER_TRIVIAL: '1',
      });
      assert.equal(r.parsed.trivial, 'true');
      assert.equal(r.parsed.reason, 'frontmatter_override');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('frontmatter override downgraded when diff > 50 lines', () => {
    const dir = setupRepo();
    try {
      const huge = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
      writeFileSync(join(dir, 'big.ts'), huge + '\n');
      git(dir, 'add', 'big.ts');
      const r = runScript('trivial', {
        CLASSIFY_SOURCE_PATH: dir,
        CLASSIFY_SERVICES_IN_PHASE: '1',
        CLASSIFY_FRONTMATTER_TRIVIAL: '1',
      });
      assert.equal(r.parsed.trivial, 'false');
      assert.equal(r.parsed.reason, 'frontmatter_override_downgraded');
      assert.match(r.parsed.downgrade_reason, /lines_over_50/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('frontmatter override downgraded when lockfile present', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'a\n');
      writeFileSync(join(dir, 'yarn.lock'), '{}\n');
      git(dir, 'add', 'a.ts', 'yarn.lock');
      const r = runScript('trivial', {
        CLASSIFY_SOURCE_PATH: dir,
        CLASSIFY_SERVICES_IN_PHASE: '1',
        CLASSIFY_FRONTMATTER_TRIVIAL: '1',
      });
      assert.equal(r.parsed.trivial, 'false');
      assert.match(r.parsed.downgrade_reason, /lockfile/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// additive subcommand
// ===========================================================================
describe('classify-phase.sh additive', () => {
  test('additive=true when only new files added', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'newfile.ts'), 'x\n');
      git(dir, 'add', 'newfile.ts');
      const r = runScript('additive', { CLASSIFY_SOURCE_PATH: dir });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.additive, 'true');
      assert.equal(r.parsed.modified_count, '0');
      assert.equal(r.parsed.deleted_count, '0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('additive=false when existing file is modified', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'baseline.txt'), 'x\nmore\n');
      const r = runScript('additive', { CLASSIFY_SOURCE_PATH: dir });
      assert.equal(r.parsed.additive, 'false');
      assert.equal(r.parsed.modified_count, '1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('additive=false when a file is deleted', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'extra.txt'), 'y\n');
      git(dir, 'add', 'extra.txt');
      git(dir, 'commit', '-q', '-m', 'add extra');
      rmSync(join(dir, 'extra.txt'));
      const r = runScript('additive', { CLASSIFY_SOURCE_PATH: dir });
      assert.equal(r.parsed.additive, 'false');
      assert.equal(r.parsed.deleted_count, '1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// compilable subcommand
// ===========================================================================
describe('classify-phase.sh compilable', () => {
  test('compilable=false when only docs/yaml/css', () => {
    const r = runScript('compilable', {
      CLASSIFY_FILES: 'README.md\nconfig.yaml\nstyles.css',
    });
    assert.equal(r.code, 0);
    assert.equal(r.parsed.compilable, 'false');
    assert.match(r.parsed.extensions, /md|yaml|css/);
  });

  test('compilable=true when .ts files present', () => {
    const r = runScript('compilable', {
      CLASSIFY_FILES: 'src/foo.ts\nsrc/bar.ts',
    });
    assert.equal(r.parsed.compilable, 'true');
  });

  test('compilable=true when package.json forces it', () => {
    const r = runScript('compilable', {
      CLASSIFY_FILES: 'package.json\nREADME.md',
    });
    assert.equal(r.parsed.compilable, 'true');
    assert.equal(r.parsed.forcing_file, 'package.json');
  });

  test('compilable=true when tsconfig.json forces it', () => {
    const r = runScript('compilable', {
      CLASSIFY_FILES: 'tsconfig.json\nREADME.md',
    });
    assert.equal(r.parsed.compilable, 'true');
    assert.equal(r.parsed.forcing_file, 'tsconfig.json');
  });

  test('compilable=false when only data .json (no package.json)', () => {
    const r = runScript('compilable', {
      CLASSIFY_FILES: 'config/data.json\nfixtures/seed.json',
    });
    assert.equal(r.parsed.compilable, 'false');
  });

  test('compilable=false when CLASSIFY_FILES is empty', () => {
    const r = runScript('compilable', { CLASSIFY_FILES: '' });
    assert.equal(r.parsed.compilable, 'false');
    assert.equal(r.parsed.reason, 'no_files');
  });
});

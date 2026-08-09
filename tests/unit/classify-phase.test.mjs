// tests/unit/classify-phase.test.mjs
//
// Tests for bin/classify-phase.sh — the 3 subcommands (mode | trivial |
// compilable) that replace inline Bash classifiers in
// execute-task.md Steps 7c.1, 7e, and 8a.5.
//
// Run: `node --test tests/unit/classify-phase.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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

  test('tdd when FR count ≤ 5 and single service', () => {
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
      assert.equal(r.parsed.mode, 'tdd');
      assert.equal(r.parsed.fr_nfr_count, '3');
      assert.equal(r.parsed.frontmatter_override, 'none');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tdd when FR count > 5', () => {
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
      assert.equal(r.parsed.mode, 'tdd');
      assert.equal(r.parsed.fr_nfr_count, '7');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tdd when multi-service even with ≤5 FRs', () => {
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
      assert.equal(r.parsed.mode, 'tdd');
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
      assert.equal(r.parsed.mode, 'tdd');
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
      assert.equal(r.parsed.mode, 'tdd');
      assert.equal(r.parsed.frontmatter_override, 'horizontal');
      assert.equal(r.parsed.reason, 'legacy_mode_override');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('legacy Mode: horizontal frontmatter maps to tdd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-mode-'));
    const path = join(dir, 'phase.md');
    writeFileSync(path, `# Phase 01\n\n**Mode: horizontal**\n\n## Requirements (immutable)\n- FR-1: x\n`);
    const r = runScript('mode', { CLASSIFY_PHASE_FILE: path, CLASSIFY_SERVICES_IN_PHASE: '2' });
    assert.equal(r.parsed.mode, 'tdd');
    assert.equal(r.parsed.reason, 'legacy_mode_override');
    rmSync(dir, { recursive: true, force: true });
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

describe('classify-phase.sh all', () => {
  function writePhase(dir, contents) {
    const path = join(dir, 'phase.md');
    writeFileSync(path, contents);
    return path;
  }

  function runAll(dir, phasePath, extraEnv = {}) {
    return runScript('all', {
      CLASSIFY_PHASE_FILE: phasePath,
      CLASSIFY_SOURCE_PATH: dir,
      CLASSIFY_SERVICES_IN_PHASE: '1',
      ...extraEnv,
    });
  }

  function expectedFrontmatterTrivial(modeParsed) {
    return modeParsed.frontmatter_override === 'trivial' ? '1' : '0';
  }

  function assertAgreesWithSeparateSubcommands(dir, phasePath) {
    const all = runAll(dir, phasePath);
    const mode = runScript('mode', {
      CLASSIFY_PHASE_FILE: phasePath,
      CLASSIFY_SERVICES_IN_PHASE: '1',
    });
    const trivial = runScript('trivial', {
      CLASSIFY_SOURCE_PATH: dir,
      CLASSIFY_SERVICES_IN_PHASE: '1',
      CLASSIFY_FRONTMATTER_TRIVIAL: expectedFrontmatterTrivial(mode.parsed),
    });

    assert.equal(all.code, 0);
    for (const key of ['mode', 'fr_nfr_count', 'frontmatter_override', 'docs_validation', 'docs_rejection_reason']) {
      assert.equal(all.parsed[key], mode.parsed[key], `mode key ${key}`);
    }
    assert.equal(all.parsed.mode_reason, mode.parsed.reason);
    for (const key of ['trivial', 'lines_changed', 'files_changed', 'has_lockfile', 'has_migration', 'has_dts', 'has_tsconfig', 'downgrade_reason']) {
      assert.equal(all.parsed[key], trivial.parsed[key], `trivial key ${key}`);
    }
    assert.equal(all.parsed.trivial_reason, trivial.parsed.reason);
    assert.equal(all.parsed.reason, undefined);
    return all;
  }

  test('agrees with mode + trivial on a plain tdd phase', () => {
    const dir = setupRepo();
    try {
      const phase = writePhase(dir, '# Phase 01\n\n## Requirements (immutable)\n- FR-1: implement the handler\n');
      writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
      const all = assertAgreesWithSeparateSubcommands(dir, phase);
      assert.equal(all.parsed.mode, 'tdd');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('agrees with mode + trivial on a validated docs phase', () => {
    const dir = setupRepo();
    try {
      const phase = writePhase(dir, '# Phase 01\n**Mode: docs**\n\n## Requirements (immutable)\n- Update the README\n');
      const all = assertAgreesWithSeparateSubcommands(dir, phase);
      assert.equal(all.parsed.mode, 'docs');
      assert.equal(all.parsed.mode_reason, 'frontmatter_override_validated');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('agrees with mode + trivial on a rejected docs override', () => {
    const dir = setupRepo();
    try {
      const phase = writePhase(dir, '# Phase 01\n**Mode: docs**\n\n## Requirements (immutable)\n- Implement the controller\n');
      const all = assertAgreesWithSeparateSubcommands(dir, phase);
      assert.equal(all.parsed.mode, 'tdd');
      assert.equal(all.parsed.mode_reason, 'docs_override_rejected');
      assert.equal(all.parsed.docs_validation, 'failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('derives the frontmatter-trivial override internally', () => {
    const dir = setupRepo();
    try {
      const phase = writePhase(dir, '# Phase 01\n**Mode: trivial**\n\n## Requirements (immutable)\n- FR-1: rename a constant\n');
      writeFileSync(join(dir, 'big.ts'), Array.from({ length: 60 }, (_, i) => `const v${i} = ${i};`).join('\n'));
      git(dir, 'add', 'big.ts');
      const all = assertAgreesWithSeparateSubcommands(dir, phase);
      assert.equal(all.parsed.frontmatter_override, 'trivial');
      assert.equal(all.parsed.trivial, 'false');
      assert.equal(all.parsed.trivial_reason, 'frontmatter_override_downgraded');
      assert.match(all.parsed.downgrade_reason, /lines_over_50/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ignores a caller-supplied CLASSIFY_FRONTMATTER_TRIVIAL', () => {
    const dir = setupRepo();
    try {
      const phase = writePhase(dir, '# Phase 01\n\n## Requirements (immutable)\n- FR-1: implement the handler\n');
      writeFileSync(join(dir, 'lots.ts'), Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`).join('\n'));
      git(dir, 'add', 'lots.ts');
      const all = runAll(dir, phase, { CLASSIFY_FRONTMATTER_TRIVIAL: '1' });
      assert.equal(all.parsed.frontmatter_override, 'none');
      assert.equal(all.parsed.trivial, 'false');
      assert.equal(all.parsed.trivial_reason, 'size_gate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('trivial keys are meaningless on a clean tree, which is why 7c.1 ignores them', () => {
    const dir = setupRepo();
    try {
      const phase = writePhase(dir, '# Phase 01\n\n## Requirements (immutable)\n- FR-1: implement a large handler\n');
      const all = runAll(dir, phase);
      assert.equal(all.parsed.lines_changed, '0');
      assert.equal(all.parsed.files_changed, '0');
      assert.equal(all.parsed.trivial, 'true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('errors when the source path is missing', () => {
    const dir = setupRepo();
    try {
      const phase = writePhase(dir, '# Phase 01\n\n## Requirements (immutable)\n- FR-1: x\n');
      const r = runScript('all', {
        CLASSIFY_PHASE_FILE: phase,
        CLASSIFY_SOURCE_PATH: join(dir, 'nope'),
        CLASSIFY_SERVICES_IN_PHASE: '1',
      });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /source path not found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('execute-task derives PHASE_IS_TRIVIAL post-Green, never from the pre-dispatch call', () => {
  const workflow = readFileSync(
    join(__dirname, '..', '..', 'jelou', 'workflows', 'execute-task.md'),
    'utf8',
  );

  const section = (startHeader, endHeader) => {
    const start = workflow.indexOf(startHeader);
    assert.notEqual(start, -1, `missing section: ${startHeader}`);
    const end = workflow.indexOf(endHeader, start + startHeader.length);
    assert.notEqual(end, -1, `missing terminator: ${endHeader}`);
    return workflow.slice(start, end);
  };

  const step7c = section('### 7c. Open the phase', '### 7d. TDD Cycle');
  const step7e = section('### 7e —', '## Step 8 — Final Validation');

  test('7c classifies the mode only — never triviality', () => {
    assert.match(step7c, /classify-phase\.sh mode/);
    assert.doesNotMatch(step7c, /classify-phase\.sh (all|trivial)/);
    assert.doesNotMatch(step7c, /\*\*Store\*\*:[\s\S]*PHASE_IS_TRIVIAL/);
    assert.match(step7c, /mode=docs\|tdd/);
    assert.match(step7c, /frontmatter_override=/);
  });

  test('7c states why the pre-dispatch pass cannot touch the diff', () => {
    assert.match(step7c, /It never\s+touches `git diff`/);
  });

  test('7e classifies triviality after Green and owns PHASE_IS_TRIVIAL', () => {
    assert.match(step7e, /classify-phase\.sh all/);
    assert.match(step7e, /After Green is verified/);
    assert.match(step7e, /\*\*Store\*\*: `PHASE_IS_TRIVIAL`/);
  });

  test('7e states the diff-dependence that forces the ordering', () => {
    assert.match(step7e, /This is why it runs here and not at 7c/);
    assert.match(step7e, /trivial=true. on a clean tree/);
    assert.match(step7e, /silently disable 8a\.3/);
  });

  test('the frontmatter override is re-derived by the script, not threaded by the orchestrator', () => {
    assert.match(step7e, /re-derives the `mode: trivial` frontmatter override internally/);
    assert.doesNotMatch(workflow, /CLASSIFY_FRONTMATTER_TRIVIAL/);
  });

  test('the workflow never tells the reader to skip the post-Green triviality call', () => {
    assert.doesNotMatch(workflow, /do NOT invoke\s*`?bin\/classify-phase\.sh (trivial|all)/i);
    assert.doesNotMatch(workflow, /Known trade — the triviality result/);
  });
});

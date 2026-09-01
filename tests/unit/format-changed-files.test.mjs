// tests/unit/format-changed-files.test.mjs
//
// Tests for bin/format-changed-files.sh — the host-side lint/format script
// invoked by execute-task.md Step 7e / 7de. Verifies pre-flight, filtering,
// detection chain (package.json scripts → JS/TS default),
// and dry-run behavior.
//
// Run: `node --test tests/unit/format-changed-files.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'bin', 'format-changed-files.sh');

function parseOutput(stdout) {
  const out = {};
  for (const line of stdout.split('\n')) {
    if (!line.includes('=')) continue;
    const idx = line.indexOf('=');
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function runScript(env) {
  const result = spawnSync('bash', [SCRIPT_PATH], {
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

function mktmp(prefix = 'format-changed-files-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('format-changed-files.sh — pre-flight', () => {
  test('fails when FORMAT_SOURCE_PATH does not exist', () => {
    const r = runScript({
      FORMAT_SOURCE_PATH: '/nonexistent-xyz-12345',
      FORMAT_CHANGED_FILES: 'a.ts',
    });
    assert.equal(r.code, 1);
    assert.equal(r.parsed.status, 'failed');
    assert.equal(r.parsed.reason, 'source_path_missing');
  });

  test('errors when FORMAT_SOURCE_PATH env var missing', () => {
    const r = runScript({ FORMAT_CHANGED_FILES: 'a.ts' });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /FORMAT_SOURCE_PATH required/);
  });

  test('errors when FORMAT_CHANGED_FILES env var missing', () => {
    const dir = mktmp();
    try {
      const r = runScript({ FORMAT_SOURCE_PATH: dir });
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /FORMAT_CHANGED_FILES required/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('format-changed-files.sh — file filtering', () => {
  test('skips when FORMAT_CHANGED_FILES is empty', () => {
    const dir = mktmp();
    try {
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: '',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.status, 'skip');
      assert.equal(r.parsed.reason, 'no_files');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips when all listed files are missing on disk', () => {
    const dir = mktmp();
    try {
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts\nb.ts\nc.ts',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.status, 'skip');
      assert.equal(r.parsed.reason, 'no_files');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips when no format command can be detected (Python-only dir)', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'mod.py'), 'print("hi")\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'mod.py',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.status, 'skip');
      assert.equal(r.parsed.reason, 'no_command_detected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('format-changed-files.sh — detection chain (dry-run)', () => {
  test('prefers package.json `format` script', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'true', 'lint:fix': 'true' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
        FORMAT_DRY_RUN: '1',
      });
      assert.equal(r.code, 0, `expected ok, got: ${r.stdout}\n${r.stderr}`);
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.detection_source, 'package_script');
      assert.match(r.parsed.command, /npm run format/);
      assert.match(r.parsed.command, /a\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('falls back to package.json `lint:fix` when no `format` script', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { 'lint:fix': 'true' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
        FORMAT_DRY_RUN: '1',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.detection_source, 'package_script');
      assert.match(r.parsed.command, /npm run lint:fix/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('falls back to npx eslint default when package.json has no relevant scripts', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { build: 'tsc' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
        FORMAT_DRY_RUN: '1',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.detection_source, 'default_eslint');
      assert.match(r.parsed.command, /npx eslint --fix/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('files_count reflects filtered list', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'true' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      writeFileSync(join(dir, 'b.ts'), 'x\n');
      // c.ts is in the list but missing on disk → filtered out
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts\nb.ts\nc.ts',
        FORMAT_DRY_RUN: '1',
      });
      assert.equal(r.code, 0);
      assert.equal(r.parsed.files_count, '2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('format-changed-files.sh — changed_by_format', () => {
  test('reports 0 when the formatter is a no-op', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'true' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
      });
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.changed_by_format, '0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('counts only files the formatter rewrote', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'fmt.sh'), 'printf "formatted\\n" > a.ts\n');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'sh fmt.sh' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      writeFileSync(join(dir, 'b.ts'), 'y\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts\nb.ts',
      });
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.changed_by_format, '1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('idempotent rewrite with identical content counts 0', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'fmt.sh'), 'printf "x\\n" > a.ts\n');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'sh fmt.sh' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
      });
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.changed_by_format, '0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dry-run emits no changed_by_format', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'true' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
        FORMAT_DRY_RUN: '1',
      });
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.changed_by_format, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('format-changed-files.sh — execution', () => {
  test('runs npm script and returns ok with files_count', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'true' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
      });
      assert.equal(r.code, 0, `expected ok, got: ${r.stdout}\n${r.stderr}`);
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.files_count, '1');
      assert.match(r.parsed.command, /npm run format/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns failed when format command exits non-zero', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'x',
        scripts: { format: 'false' },
      }));
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
      });
      assert.equal(r.code, 2);
      assert.equal(r.parsed.status, 'failed');
      assert.equal(r.parsed.reason, 'format_failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('format-changed-files.sh — FORMAT_CONVENTIONS is inert', () => {
  // CONVENTIONS.md left the detection chain with the codebase-docs removal.
  // The env var is no longer read; a stale caller that still exports it must
  // neither change detection nor crash the script (it runs under `set -u`).
  const CONVENTIONS = [
    '# Conventions',
    '',
    '## Format',
    '',
    'Run `npx prettier --write` against staged files.',
    '',
  ].join('\n');

  test('package.json still wins when a CONVENTIONS.md format command is exported', () => {
    const dir = mktmp();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { format: 'true' } }));
      const convPath = join(dir, 'CONVENTIONS.md');
      writeFileSync(convPath, CONVENTIONS);
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.ts',
        FORMAT_CONVENTIONS: convPath,
        FORMAT_DRY_RUN: '1',
      });
      assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
      assert.equal(r.parsed.detection_source, 'package_script');
      assert.match(r.parsed.command, /npm run format --/);
      assert.doesNotMatch(r.parsed.command, /prettier/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a non-JS project with a CONVENTIONS.md format command now skips', () => {
    const dir = mktmp();
    try {
      const convPath = join(dir, 'CONVENTIONS.md');
      writeFileSync(convPath, CONVENTIONS);
      writeFileSync(join(dir, 'a.py'), 'x = 1\n');
      const r = runScript({
        FORMAT_SOURCE_PATH: dir,
        FORMAT_CHANGED_FILES: 'a.py',
        FORMAT_CONVENTIONS: convPath,
        FORMAT_DRY_RUN: '1',
      });
      assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
      assert.equal(r.parsed.status, 'skip');
      assert.equal(r.parsed.reason, 'no_command_detected');
      assert.equal(r.parsed.detection_source, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the script source no longer mentions CONVENTIONS at all', () => {
    const src = readFileSync(SCRIPT_PATH, 'utf8');
    assert.doesNotMatch(src, /FORMAT_CONVENTIONS/);
    assert.doesNotMatch(src, /CONVENTIONS\.md/);
    assert.doesNotMatch(src, /detection_source=conventions|DETECTION_SOURCE="conventions"/);
  });
});

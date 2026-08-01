import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}

describe('.codex-plugin/plugin.json — bundled skills', () => {
  const plugin = readJson('.codex-plugin/plugin.json');

  test('declares the generated skill mirror', () => {
    assert.equal(plugin.skills, './.codex/skills/');
  });

  test('the declared skills path exists and holds native skills', () => {
    const skillsDir = resolve(ROOT, plugin.skills);
    assert.ok(existsSync(skillsDir), `${plugin.skills} does not exist`);
    const entries = readdirSync(skillsDir).filter((name) => name.startsWith('jlu-'));
    assert.ok(entries.length > 0, 'no jlu-* skills in the declared mirror');
    for (const entry of entries) {
      assert.ok(
        existsSync(join(skillsDir, entry, 'SKILL.md')),
        `${entry} has no SKILL.md`,
      );
    }
  });
});

describe('.agents/plugins/marketplace.json — Codex marketplace manifest', () => {
  const marketplace = readJson('.agents/plugins/marketplace.json');

  test('names the marketplace and exposes a display name', () => {
    assert.equal(marketplace.name, 'jelou-spec-plugin');
    assert.ok(marketplace.interface.displayName);
  });

  test('lists the jlu plugin for the Codex product', () => {
    const jlu = marketplace.plugins.find((p) => p.name === 'jlu');
    assert.ok(jlu, 'no jlu plugin entry');
    assert.deepEqual(jlu.policy.products, ['CODEX']);
    assert.equal(jlu.policy.installation, 'AVAILABLE');
  });

  test('the plugin source path resolves to the repo root manifest', () => {
    const jlu = marketplace.plugins.find((p) => p.name === 'jlu');
    assert.equal(jlu.source.source, 'local');
    const pluginRoot = resolve(ROOT, jlu.source.path);
    assert.ok(existsSync(join(pluginRoot, '.codex-plugin/plugin.json')));
  });

  test('the marketplace plugin name matches the plugin manifest', () => {
    assert.equal(marketplace.plugins[0].name, readJson('.codex-plugin/plugin.json').name);
  });
});

describe('install route documentation', () => {
  function read(relPath) {
    return readFileSync(join(ROOT, relPath), 'utf8');
  }

  test('INVOCATION.md warns that the two Codex install routes double-register', () => {
    const src = read('INVOCATION.md');
    assert.match(src, /\*\*Pick one route\*\*/);
    assert.match(src, /bin\/install-codex\.sh/);
    assert.match(src, /codex plugin marketplace add/);
  });

  test('setup documents CODEX_SKILLS_DIR alongside --codex-target', () => {
    const src = read('setup');
    assert.match(src, /--codex-target <path>/);
    assert.match(src, /CODEX_SKILLS_DIR/);
  });

  test('the installer honours CODEX_SKILLS_DIR for the global destination', () => {
    const src = read('bin/install-codex.sh');
    assert.match(src, /SKILLS_DIR="\$\{CODEX_SKILLS_DIR:-\$HOME\/\.agents\/skills\}"/);
  });

  test('.gitignore excludes the project-local skill install target', () => {
    assert.match(read('.gitignore'), /^\.agents\/skills\/$/m);
  });
});

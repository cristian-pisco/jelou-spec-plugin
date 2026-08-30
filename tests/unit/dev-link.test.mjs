// tests/unit/dev-link.test.mjs
//
// Run: `node --test tests/unit/dev-link.test.mjs`
//
// Covers the pre-release dev-link tooling: the manifest load rules that
// `claude plugin validate` does not enforce, detection of the legacy installer's
// shadow copies in the global Claude directories, working-tree-vs-release drift,
// and the CLI surface that turns those into a session.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  auditManifest,
  checkAgentFrontmatter,
  checkHookWiring,
  checkMarketplaceManifest,
  checkPluginManifest,
  checkSkillFrontmatter,
  inventory,
  listSkillDirs,
} from '../../bin/lib/dev-link/manifest.mjs';
import {
  CURRENT,
  RETIRED,
  isRemovable,
  removalPlan,
  scanShadows,
  shadowFindings,
} from '../../bin/lib/dev-link/shadows.mjs';
import { diffSurface, diffAgainstInstalled } from '../../bin/lib/dev-link/drift.mjs';
import { checkMirrors } from '../../bin/lib/dev-link/mirrors.mjs';
import {
  installedFindings,
  launchArgv,
  launchCommand,
  parsePluginList,
} from '../../bin/lib/dev-link/claude-cli.mjs';
import { main as devLinkMain, parseArgs } from '../../bin/dev-link.mjs';

const ids = (findings) => findings.map((f) => f.id).sort();

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'jlu-dev-link-'));
  return dir;
}

function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function pluginFixture({ hooks, skills = {}, agents = {}, marketplaceName = 'jlu' } = {}) {
  const root = tempDir();
  const manifest = { name: 'jlu', description: 'fixture', version: '1.0.0' };
  if (hooks !== undefined) manifest.hooks = hooks;
  write(root, '.claude-plugin/plugin.json', JSON.stringify(manifest));
  write(
    root,
    '.claude-plugin/marketplace.json',
    JSON.stringify({ name: 'fixture', plugins: [{ name: marketplaceName, source: './', version: '1.0.0' }] }),
  );
  write(root, 'hooks/hooks.json', JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/guard.mjs"' }] }] },
  }));
  write(root, 'bin/guard.mjs', 'export default 1;\n');
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'agents'), { recursive: true });
  for (const [name, body] of Object.entries(skills)) write(root, `skills/${name}/SKILL.md`, body);
  for (const [name, body] of Object.entries(agents)) write(root, `agents/${name}.md`, body);
  return root;
}

const skillDoc = (name, description = 'does a thing') => `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`;
const agentDoc = (name, description = 'does a thing') => `---\nname: ${name}\ndescription: ${description}\ntools: Read\n---\n\nbody\n`;

describe('manifest — the load rules claude plugin validate does not enforce', () => {
  test('a hooks field pointing at the auto-loaded hooks.json is rejected', () => {
    const root = pluginFixture({ hooks: './hooks/hooks.json' });
    assert.deepEqual(ids(checkPluginManifest(root)), ['hooks-duplicate']);
    rmSync(root, { recursive: true, force: true });
  });

  test('the same rule applies to the array form and to a path without the leading dot', () => {
    for (const hooks of [['./hooks/hooks.json'], 'hooks/hooks.json']) {
      const root = pluginFixture({ hooks });
      assert.deepEqual(ids(checkPluginManifest(root)), ['hooks-duplicate'], JSON.stringify(hooks));
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an additional hooks file is allowed — only the standard path duplicates', () => {
    const root = pluginFixture({ hooks: './hooks/extra.json' });
    assert.deepEqual(checkPluginManifest(root), []);
    rmSync(root, { recursive: true, force: true });
  });

  test('a manifest with no hooks field passes', () => {
    const root = pluginFixture();
    assert.deepEqual(checkPluginManifest(root), []);
    rmSync(root, { recursive: true, force: true });
  });

  test('an unreadable manifest is a single terminal finding', () => {
    const root = tempDir();
    assert.deepEqual(ids(checkPluginManifest(root)), ['manifest-unreadable']);
    write(root, '.claude-plugin/plugin.json', '{not json');
    assert.deepEqual(ids(checkPluginManifest(root)), ['manifest-unreadable']);
    rmSync(root, { recursive: true, force: true });
  });

  test('a manifest without a name loses the skill and agent namespace', () => {
    const root = tempDir();
    write(root, '.claude-plugin/plugin.json', JSON.stringify({ description: 'x' }));
    assert.deepEqual(ids(checkPluginManifest(root)), ['manifest-no-name']);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('manifest — hook targets must exist in the plugin root', () => {
  test('a reachable ${CLAUDE_PLUGIN_ROOT} target passes', () => {
    const root = pluginFixture();
    assert.deepEqual(checkHookWiring(root), []);
    rmSync(root, { recursive: true, force: true });
  });

  test('a hook pointing at a deleted script is caught', () => {
    const root = pluginFixture();
    rmSync(join(root, 'bin/guard.mjs'));
    assert.deepEqual(ids(checkHookWiring(root)), ['hook-target-missing']);
    rmSync(root, { recursive: true, force: true });
  });

  test('an unparseable hooks file is reported, and an absent one is not', () => {
    const root = pluginFixture();
    write(root, 'hooks/hooks.json', '{broken');
    assert.deepEqual(ids(checkHookWiring(root)), ['hooks-unparseable']);
    rmSync(join(root, 'hooks/hooks.json'));
    assert.deepEqual(checkHookWiring(root), []);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('manifest — marketplace entry agreement', () => {
  test('a marketplace entry naming something other than the plugin renames the namespace', () => {
    const root = pluginFixture({ marketplaceName: 'jlu-dev' });
    assert.deepEqual(ids(checkMarketplaceManifest(root)), ['marketplace-name-drift']);
    rmSync(root, { recursive: true, force: true });
  });

  test('a source path that does not exist is caught', () => {
    const root = pluginFixture();
    write(root, '.claude-plugin/marketplace.json', JSON.stringify({ plugins: [{ name: 'jlu', source: './nope' }] }));
    assert.deepEqual(ids(checkMarketplaceManifest(root)), ['marketplace-source-missing']);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('manifest — skill and agent frontmatter', () => {
  test('a skill whose declared name drifts from its directory is caught', () => {
    const root = pluginFixture({ skills: { ship: skillDoc('shipp') } });
    assert.deepEqual(ids(checkSkillFrontmatter(root)), ['skill-name-drift']);
    rmSync(root, { recursive: true, force: true });
  });

  test('a skill with no description cannot be routed to', () => {
    const root = pluginFixture({ skills: { ship: '---\nname: ship\n---\n\nbody\n' } });
    assert.deepEqual(ids(checkSkillFrontmatter(root)), ['skill-no-description']);
    rmSync(root, { recursive: true, force: true });
  });

  test('an agent whose declared name drifts from its filename is caught', () => {
    const root = pluginFixture({ agents: { 'jlu-tdd-cycle': agentDoc('jlu-tdd') } });
    assert.deepEqual(ids(checkAgentFrontmatter(root)), ['agent-name-drift']);
    rmSync(root, { recursive: true, force: true });
  });

  test('a well-formed tree audits clean', () => {
    const root = pluginFixture({ skills: { ship: skillDoc('ship') }, agents: { 'jlu-tdd-cycle': agentDoc('jlu-tdd-cycle') } });
    assert.deepEqual(auditManifest(root), []);
    assert.deepEqual(inventory(root), { skills: ['ship'], agents: ['jlu-tdd-cycle'], hookEvents: ['PreToolUse'] });
    rmSync(root, { recursive: true, force: true });
  });
});

describe('the real repository satisfies its own load rules', () => {
  test('auditManifest finds nothing in this tree', () => {
    assert.deepEqual(auditManifest(process.cwd()), []);
  });

  test('every shipped skill directory carries a SKILL.md', () => {
    assert.ok(listSkillDirs(process.cwd()).length > 0);
  });
});

function homeFixture({ skills = {}, agents = [], legacyRoot = false } = {}) {
  const home = tempDir();
  for (const [name, body] of Object.entries(skills)) write(home, `.claude/skills/${name}/SKILL.md`, body);
  for (const name of agents) write(home, `.claude/agents/${name}.md`, agentDoc(name));
  if (legacyRoot) write(home, '.claude/jelou/workflows/ship.md', '# stale\n');
  return home;
}

const jluSkillCopy = (name) => `---\nname: ${name}\ndescription: d\n---\n\nRead <plugin-root>/jelou/workflows/${name}.md\n`;

describe('shadows — the legacy installer copies that outlive a release', () => {
  test('a copy of a live skill is classified as shadowing, a copy of a dropped one as retired', () => {
    const root = pluginFixture({ skills: { ship: skillDoc('ship') } });
    const home = homeFixture({ skills: { ship: jluSkillCopy('ship'), 'rollback-phase': jluSkillCopy('rollback-phase') } });
    const scan = scanShadows({ root, home });
    assert.deepEqual(scan.skills.map((s) => [s.name, s.status]), [['rollback-phase', RETIRED], ['ship', CURRENT]]);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('a third-party skill without the plugin provenance marker is left alone', () => {
    const root = pluginFixture({ skills: { ship: skillDoc('ship') } });
    const home = homeFixture({ skills: { ship: '---\nname: ship\ndescription: gstack ship\n---\n\nunrelated\n' } });
    assert.deepEqual(scanShadows({ root, home }).skills, []);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('an agent the plugin retired is still dispatchable from the global directory', () => {
    const root = pluginFixture({ agents: { 'jlu-tdd-cycle': agentDoc('jlu-tdd-cycle') } });
    const home = homeFixture({ agents: ['jlu-tdd-cycle', 'jlu-legacy-runner', 'unrelated-agent'] });
    const scan = scanShadows({ root, home });
    assert.deepEqual(scan.agents.map((a) => [a.name, a.status]), [['jlu-legacy-runner', RETIRED], ['jlu-tdd-cycle', CURRENT]]);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('a clean home produces no findings', () => {
    const root = pluginFixture({ skills: { ship: skillDoc('ship') } });
    const home = homeFixture();
    assert.deepEqual(shadowFindings(scanShadows({ root, home })), []);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('the frozen jelou/ fallback root is reported but never removed by default', () => {
    const root = pluginFixture();
    const home = homeFixture({ legacyRoot: true });
    const scan = scanShadows({ root, home });
    assert.deepEqual(ids(shadowFindings(scan)), ['legacy-plugin-root']);
    assert.deepEqual(removalPlan(scan), []);
    assert.deepEqual(removalPlan(scan, { includeLegacyRoot: true }), [join(home, '.claude', 'jelou')]);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('removal is confined to the global skills, agents and jelou directories', () => {
    const home = '/home/someone';
    assert.ok(isRemovable('/home/someone/.claude/skills/ship', home));
    assert.ok(isRemovable('/home/someone/.claude/agents/jlu-tdd-cycle.md', home));
    assert.equal(isRemovable('/home/someone/.claude/settings.json', home), false);
    assert.equal(isRemovable('/etc/passwd', home), false);
  });
});

describe('drift — what a session would see differently', () => {
  test('added, removed and changed files are reported per surface', () => {
    const left = tempDir();
    const right = tempDir();
    write(left, 'a.md', 'same');
    write(right, 'a.md', 'same');
    write(left, 'b.md', 'new');
    write(right, 'c.md', 'gone');
    write(left, 'd.md', 'v2');
    write(right, 'd.md', 'v1');
    assert.deepEqual(diffSurface(left, right), { added: ['b.md'], removed: ['c.md'], changed: ['d.md'] });
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  });

  test('an absent install path yields no comparison rather than a crash', () => {
    assert.deepEqual(diffAgainstInstalled({ root: process.cwd(), installPath: null }), { available: false });
  });
});

describe('mirrors — Codex and OpenCode have no --plugin-dir', () => {
  test('a failing --check run becomes a drift finding per runtime', () => {
    const fail = () => { throw new Error('drift'); };
    assert.deepEqual(ids(checkMirrors({ root: '.', exec: fail })), ['mirror-drift-codex', 'mirror-drift-opencode']);
  });

  test('a passing --check run produces nothing', () => {
    assert.deepEqual(checkMirrors({ root: '.', exec: () => '' }), []);
  });
});

describe('claude CLI surface', () => {
  test('the launch argv loads the tree from disk under the installed namespace', () => {
    assert.deepEqual(launchArgv('/repo'), ['--plugin-dir', '/repo']);
    assert.deepEqual(launchArgv('/repo', ['-p', 'hi']), ['--plugin-dir', '/repo', '-p', 'hi']);
    assert.equal(launchCommand('/repo', [], { JLU_CLAUDE_CLI: 'claude-next' }), 'claude-next --plugin-dir /repo');
  });

  test('load errors reported by plugin list become findings', () => {
    const stdout = JSON.stringify([{ id: 'jlu@jelou-spec-plugin', version: '0.3.359', enabled: true, errors: ['Hook load failed: Duplicate hooks file detected'] }]);
    const parsed = parsePluginList(stdout);
    assert.equal(parsed.found, true);
    assert.deepEqual(ids(installedFindings(parsed)), ['installed-load-error']);
  });

  test('a disabled install is a warning, and an absent one is neither', () => {
    const disabled = parsePluginList(JSON.stringify([{ id: 'jlu@jelou-spec-plugin', version: '1.0.0', enabled: false }]));
    assert.deepEqual(ids(installedFindings(disabled)), ['installed-disabled']);
    assert.deepEqual(installedFindings(parsePluginList('[]')), []);
  });

  test('non-JSON output means the CLI is unavailable, not that the plugin is healthy', () => {
    assert.deepEqual(parsePluginList('command not found'), { available: false, reason: 'plugin list did not return JSON' });
  });
});

describe('dev-link CLI', () => {
  test('status is the default command and options parse', () => {
    assert.equal(parseArgs([]).command, 'status');
    assert.equal(parseArgs(['doctor']).command, 'doctor');
    assert.equal(parseArgs(['clean-shadows', '--apply']).apply, true);
    assert.deepEqual(parseArgs(['launch', '--', '-p', 'hi']).passthrough, ['-p', 'hi']);
    assert.match(parseArgs(['--nope']).error, /unknown option/);
  });

  test('clean-shadows lists without deleting until --apply', () => {
    const root = pluginFixture({ skills: { ship: skillDoc('ship') } });
    const home = homeFixture({ skills: { ship: jluSkillCopy('ship') } });
    const shadow = join(home, '.claude', 'skills', 'ship');

    const dry = [];
    assert.equal(devLinkMain(['clean-shadows', '--root', root, '--home', home], { out: (s) => dry.push(s) }), 1);
    assert.ok(existsSync(shadow), 'dry run must not delete');
    assert.ok(dry.join('\n').includes(shadow));

    const applied = [];
    assert.equal(devLinkMain(['clean-shadows', '--root', root, '--home', home, '--apply'], { out: (s) => applied.push(s) }), 0);
    assert.equal(existsSync(shadow), false);

    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('doctor exits non-zero on an error finding and zero on a clean tree', () => {
    const runner = () => ({ ok: false, stdout: '', error: 'not installed' });
    const broken = pluginFixture({ hooks: './hooks/hooks.json' });
    const clean = pluginFixture();
    const home = homeFixture();
    const sink = () => {};
    assert.equal(devLinkMain(['doctor', '--root', broken, '--home', home], { out: sink, runner }), 1);
    assert.equal(devLinkMain(['doctor', '--root', clean, '--home', home], { out: sink, runner }), 0);
    rmSync(broken, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('launch --print-command hands over the session instead of taking it', () => {
    const lines = [];
    assert.equal(devLinkMain(['launch', '--root', '/repo', '--print-command'], { out: (s) => lines.push(s) }), 0);
    assert.deepEqual(lines, ['claude --plugin-dir /repo']);
  });
});

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const SURFACE_DIRS = ['jelou', 'agents', 'skills'];
const SHELL_FORM = /\$\{?PLUGIN_ROOT(?::-[^}\s]*)?\}?\/bin\/([a-z0-9-]+\.mjs)/g;
const NODE_BIN = /\bnode\s+(\S*?)bin\/([a-z0-9-]+\.mjs)/g;
const DISPATCH_WINDOW_LINES = 14;

const DISPATCH_PROSE = new Map([
  [
    'jelou/workflows/goal.md → jlu-backend-e2e-runner → MUST NOT short-circuit',
    'the Guardrails section restates the mandatory-dispatch policy; the payload is specified ' +
      'at step 11b.2, which is the site that must carry the input.',
  ],
]);

function markdownSurfaces() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.md')) out.push(rel.split('\\').join('/'));
    }
  };
  for (const dir of SURFACE_DIRS) walk(dir);
  return out.sort();
}

function shellFormInvocations() {
  const found = new Set();
  for (const surface of markdownSurfaces()) {
    for (const match of read(surface).matchAll(SHELL_FORM)) {
      found.add(`${surface} → ${match[1]}`);
    }
  }
  return found;
}

function agentFiles() {
  return readdirSync(join(ROOT, 'agents'))
    .filter((entry) => entry.endsWith('.md'))
    .sort();
}

function inputsSection(text) {
  const out = [];
  let inside = false;
  for (const line of text.split('\n')) {
    const heading = /^#{2,6}\s+(.*)$/.exec(line);
    if (heading) inside = /^inputs\b/i.test(heading[1].trim());
    else if (inside) out.push(line);
  }
  return out.join('\n');
}

function binInvokingAgents() {
  const out = new Map();
  for (const file of agentFiles()) {
    const invocations = [...read(`agents/${file}`).matchAll(NODE_BIN)].map(([, prefix, bin]) => ({ prefix, bin }));
    if (invocations.length) out.set(basename(file, '.md'), invocations);
  }
  return out;
}

function pluginRootDeclaringAgents() {
  return agentFiles()
    .filter((file) => /<PLUGIN_ROOT>/.test(inputsSection(read(`agents/${file}`))))
    .map((file) => basename(file, '.md'));
}

function workflowFiles() {
  return readdirSync(join(ROOT, 'jelou/workflows'))
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `jelou/workflows/${entry}`)
    .sort();
}

function dispatchSites(agent) {
  const pattern = new RegExp(
    String.raw`(?<!re-)\b(dispatch|dispatches|spawn|spawns)\b[\s\S]{0,90}?\x60?${agent}\x60?`,
    'gi',
  );
  const sites = [];
  for (const workflow of workflowFiles()) {
    const text = read(workflow);
    const lines = text.split('\n');
    for (const match of text.matchAll(pattern)) {
      const index = text.slice(0, match.index + match[0].length).split('\n').length - 1;
      const window = [];
      for (let cursor = index; cursor < Math.min(lines.length, index + DISPATCH_WINDOW_LINES); cursor++) {
        if (cursor > index && /^#{1,6}\s/.test(lines[cursor])) break;
        window.push(lines[cursor]);
      }
      sites.push({
        workflow,
        line: index + 1,
        text: lines[index].trim(),
        passesPluginRoot: /PLUGIN_ROOT/.test(window.join('\n')),
      });
    }
  }
  return sites;
}

function proseKey(agent, site) {
  for (const key of DISPATCH_PROSE.keys()) {
    const [workflow, named, snippet] = key.split(' → ');
    if (workflow === site.workflow && named === agent && site.text.includes(snippet)) return key;
  }
  return null;
}

describe('plugin-root resolution — the PLUGIN_ROOT shell form is banned outright', () => {
  test('no surface invokes a bin through ${PLUGIN_ROOT}', () => {
    assert.deepEqual(
      [...shellFormInvocations()].sort(),
      [],
      'no runtime exports PLUGIN_ROOT, so these collapse to ./bin/<script> inside the user repo. ' +
        'A workflow, reference, template or skill resolves the root from its own path; an agent ' +
        'cannot, so it declares <PLUGIN_ROOT> as an input and the dispatcher passes it. ' +
        'See jelou/references/plugin-root.md',
    );
  });
});

describe('plugin-root dispatch contract — a bin-invoking agent is handed the root', () => {
  const invoking = binInvokingAgents();
  const declaring = pluginRootDeclaringAgents();

  test('some agent invokes a bin, so this suite is actually guarding something', () => {
    assert.ok(invoking.size > 0, 'no agent matched the node-bin invocation pattern — the scanner is broken');
  });

  for (const [agent, invocations] of invoking) {
    test(`${agent} builds every bin path from <PLUGIN_ROOT>`, () => {
      const wrong = invocations
        .filter(({ prefix }) => !/<PLUGIN_ROOT>\/$/.test(prefix.replace(/^["'\x60]/, '')))
        .map(({ prefix, bin }) => `${prefix}bin/${bin}`);
      assert.deepEqual(
        wrong,
        [],
        `agents/${agent}.md must invoke bundled bins as "<PLUGIN_ROOT>/bin/<script>.mjs". A bare or ` +
          'relative path resolves against the user service repo, where the script does not exist.',
      );
    });

    test(`${agent} declares <PLUGIN_ROOT> as a received input`, () => {
      assert.ok(
        declaring.includes(agent),
        `agents/${agent}.md invokes ${invocations.map(({ bin }) => bin).join(', ')} but no Inputs ` +
          'section declares <PLUGIN_ROOT>. An agent cannot derive the plugin root from its own path, ' +
          'so the value has to arrive from the dispatcher — declare it or the invocation is unresolvable.',
      );
    });
  }

  for (const agent of declaring) {
    test(`every dispatch of ${agent} passes PLUGIN_ROOT`, () => {
      const sites = dispatchSites(agent);
      const gaps = sites
        .filter((site) => !site.passesPluginRoot && !proseKey(agent, site))
        .map((site) => `${site.workflow}:${site.line}`);
      assert.deepEqual(
        gaps,
        [],
        `${agent} declares <PLUGIN_ROOT> as an input, so every workflow that dispatches it must pass ` +
          'the value. A dispatch that omits it fails at runtime with MODULE_NOT_FOUND from a path the ' +
          'user never wrote, and nothing else in the suite notices. Add it within ' +
          `${DISPATCH_WINDOW_LINES} lines of the dispatch, or declare the match as prose in DISPATCH_PROSE.`,
      );
    });
  }

  test('every DISPATCH_PROSE exclusion still matches a real dispatch match', () => {
    for (const [key, why] of DISPATCH_PROSE) {
      const [workflow, agent, snippet] = key.split(' → ');
      assert.ok(why.length > 40, `${key} needs a real justification, not a placeholder`);
      assert.ok(declaring.includes(agent), `${key} names ${agent}, which no longer declares <PLUGIN_ROOT>`);
      const matched = dispatchSites(agent).filter(
        (site) => site.workflow === workflow && site.text.includes(snippet),
      );
      assert.equal(
        matched.length,
        1,
        `${key} matched ${matched.length} dispatch matches — the prose moved or changed, so the ` +
          'exclusion is stale. Re-point it or drop it.',
      );
    }
  });
});

describe('plugin-root reference — states the rule once, and only once', () => {
  const reference = 'jelou/references/plugin-root.md';
  const body = read(reference);

  test('no other surface restates the rule', () => {
    const tells = [/two levels above/i, /no runtime exports/i, /never fall back to `\$PLUGIN_ROOT`/i];
    const offenders = [];
    for (const surface of markdownSurfaces()) {
      if (surface === reference) continue;
      const text = read(surface);
      const hits = tells.filter((t) => t.test(text)).length;
      if (hits >= 2) offenders.push(surface);
    }
    assert.deepEqual(
      offenders,
      [],
      `${reference} is the single source for this rule. A surface that restates it drifts from the ` +
        'reference silently, and only the reference is tested. Angle-bracket placeholders are ' +
        'self-evident and every agent already knows the path it read the surface from, so the ' +
        'restatement buys nothing — delete it and let the reference carry the rule.',
    );
  });

  test('names the layout invariant for every surface kind', () => {
    for (const fragment of [
      '<root>/jelou/workflows/',
      '<root>/agents/',
      '<root>/skills/',
      '<root>/.codex/skills/',
      '<root>/bin/',
    ]) {
      assert.ok(body.includes(fragment), `${reference} does not document ${fragment}`);
    }
  });

  test('covers all six install paths', () => {
    for (const fragment of [
      'codex plugin add',
      'bin/install-codex.sh',
      'bin/install-opencode.sh',
      '$CODEX_HOME',
      '$OPENCODE_HOME',
      'marketplace',
    ]) {
      assert.ok(body.includes(fragment), `${reference} does not cover ${fragment}`);
    }
  });

  test('forbids the shell form and scopes CLAUDE_PLUGIN_ROOT to hooks', () => {
    assert.match(body, /Never use `\$\{PLUGIN_ROOT:-\.\}`/);
    assert.match(body, /hooks\/hooks\.json/);
  });

  test('states the shipping requirement with both installers and the test', () => {
    assert.match(body, /FEATURE_BINS/);
    assert.match(body, /installer-manifest\.test\.mjs/);
  });

  test('states the agent dispatch contract and names its guard', () => {
    assert.match(body, /declared input/i);
    assert.match(body, /plugin-root-resolution\.test\.mjs/);
  });
});

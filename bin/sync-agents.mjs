#!/usr/bin/env node
// bin/sync-agents.mjs
//
// Regenerate .opencode/agents/*.md from agents/*.md (canonical source).
//
// Usage:
//   node bin/sync-agents.mjs           # write mode: regenerate mirror
//   node bin/sync-agents.mjs --check   # CI mode: exit 1 on drift, no writes

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { renderOpencodeAgent } from './lib/agent-frontmatter.mjs';

const cwd = process.cwd();
const SOURCE_DIR = join(cwd, 'agents');
const DEST_DIR = join(cwd, '.opencode/agents');
const CHECK_MODE = process.argv.includes('--check');

function listMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md'));
}

function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(2);
  }

  if (!existsSync(DEST_DIR)) {
    if (CHECK_MODE) {
      console.error(`Dest directory missing: ${DEST_DIR}`);
      console.error('Run `node bin/sync-agents.mjs` to regenerate.');
      process.exit(1);
    }
    mkdirSync(DEST_DIR, { recursive: true });
  }

  const sources = new Set(listMd(SOURCE_DIR));
  const dests = new Set(listMd(DEST_DIR));
  const drift = [];
  let written = 0;

  for (const name of sources) {
    const raw = readFileSync(join(SOURCE_DIR, name), 'utf8');
    const expected = renderOpencodeAgent(raw);
    const destPath = join(DEST_DIR, name);
    const current = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;

    if (CHECK_MODE) {
      if (current !== expected) {
        drift.push({ name, reason: current === null ? 'missing' : 'stale' });
      }
    } else if (current !== expected) {
      writeFileSync(destPath, expected);
      written += 1;
    }
  }

  for (const name of dests) {
    if (!sources.has(name)) {
      if (CHECK_MODE) drift.push({ name, reason: 'orphan' });
      // Write mode leaves orphans alone — owner removes them deliberately.
    }
  }

  if (CHECK_MODE && drift.length > 0) {
    console.error(`sync-agents --check failed (${drift.length} drift):`);
    for (const d of drift) console.error(`  ${d.name} (${d.reason})`);
    console.error('Run `node bin/sync-agents.mjs` to regenerate.');
    process.exit(1);
  }

  if (!CHECK_MODE) {
    console.log(
      `sync-agents: ${sources.size} agents (${written} written) synced to .opencode/agents/`,
    );
  }
}

main();

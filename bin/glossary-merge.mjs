#!/usr/bin/env node
// bin/glossary-merge.mjs
//
// Merges per-service candidate fragments under <glossary>/.tmp/*.candidates.json
// into <glossary>/candidates.json. Deletes fragments after a successful merge.
//
// Usage:
//   node bin/glossary-merge.mjs --glossary-dir <abs-path-to-glossary-dir>
//
// Exits 0 on success, non-zero on error. Prints a short summary on success.

import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--glossary-dir') {
      args.glossaryDir = argv[++i];
    }
  }
  if (!args.glossaryDir) {
    console.error('error: --glossary-dir <path> is required');
    process.exit(2);
  }
  return args;
}

function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function emptyState() {
  return { version: 1, updated_at: new Date().toISOString(), candidates: [], promoted: [], dropped: [] };
}

function indexBy(arr, key) {
  const m = new Map();
  for (const item of arr) m.set(item[key], item);
  return m;
}

function unionEvidence(existing, incoming) {
  const seen = new Set(existing.map(e => `${e.service ?? ''}|${e.path}|${e.line ?? ''}|${e.kind}`));
  for (const ev of incoming) {
    const key = `${ev.service ?? ''}|${ev.path}|${ev.line ?? ''}|${ev.kind}`;
    if (!seen.has(key)) {
      existing.push(ev);
      seen.add(key);
    }
  }
  return existing;
}

function mergeCandidate(existing, incoming, serviceId, scannedCommit) {
  if (!existing) {
    return {
      term: incoming.term,
      first_seen_commit: scannedCommit,
      first_seen_at: new Date().toISOString(),
      discovered_in_services: [serviceId],
      evidence: incoming.evidence.map(e => ({ ...e, service: serviceId })),
      heuristic_confidence: incoming.heuristic_confidence,
      status: 'candidate'
    };
  }
  if (!existing.discovered_in_services.includes(serviceId)) {
    existing.discovered_in_services.push(serviceId);
  }
  unionEvidence(existing.evidence, incoming.evidence.map(e => ({ ...e, service: serviceId })));
  // Highest confidence wins.
  const order = { high: 3, medium: 2, low: 1 };
  if ((order[incoming.heuristic_confidence] ?? 0) > (order[existing.heuristic_confidence] ?? 0)) {
    existing.heuristic_confidence = incoming.heuristic_confidence;
  }
  return existing;
}

function main() {
  const { glossaryDir } = parseArgs(process.argv);
  const tmpDir = join(glossaryDir, '.tmp');
  const candidatesPath = join(glossaryDir, 'candidates.json');

  if (!existsSync(glossaryDir)) {
    mkdirSync(glossaryDir, { recursive: true });
  }

  const state = readJsonOr(candidatesPath, emptyState());
  const droppedTerms = new Set(state.dropped.map(d => d.term));
  const promotedTerms = new Set(state.promoted.map(p => p.term));
  const candIndex = indexBy(state.candidates, 'term');

  let fragmentsRead = 0;
  let added = 0;
  let updated = 0;
  let skipped = 0;

  if (existsSync(tmpDir)) {
    const fragments = readdirSync(tmpDir).filter(f => f.endsWith('.candidates.json'));
    for (const file of fragments) {
      const fragPath = join(tmpDir, file);
      const frag = JSON.parse(readFileSync(fragPath, 'utf8'));
      fragmentsRead++;
      for (const c of frag.candidates ?? []) {
        if (droppedTerms.has(c.term) || promotedTerms.has(c.term)) {
          skipped++;
          continue;
        }
        const existing = candIndex.get(c.term);
        const merged = mergeCandidate(existing, c, frag.service_id, frag.scanned_commit);
        if (existing) {
          updated++;
        } else {
          state.candidates.push(merged);
          candIndex.set(merged.term, merged);
          added++;
        }
      }
      // location_updates are just evidence enrichments; same merge logic.
      for (const u of frag.location_updates ?? []) {
        const existing = candIndex.get(u.term);
        if (!existing) continue; // Only enrich known candidates; canonical-side enrichment is the curator's job.
        unionEvidence(existing.evidence, u.evidence.map(e => ({ ...e, service: frag.service_id })));
        if (!existing.discovered_in_services.includes(frag.service_id)) {
          existing.discovered_in_services.push(frag.service_id);
        }
      }
    }
    // Cleanup: delete fragments only after all reads succeed.
    for (const file of fragments) rmSync(join(tmpDir, file));
    // Remove tmp dir if empty.
    try { rmSync(tmpDir, { recursive: false }); } catch { /* not empty — leave alone */ }
  }

  state.updated_at = new Date().toISOString();
  writeFileSync(candidatesPath, JSON.stringify(state, null, 2) + '\n');

  console.log(`glossary-merge: fragments=${fragmentsRead} added=${added} updated=${updated} skipped=${skipped}`);
}

main();

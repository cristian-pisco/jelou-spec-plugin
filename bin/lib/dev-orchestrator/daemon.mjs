#!/usr/bin/env node
// bin/lib/dev-orchestrator/daemon.mjs
//
// Long-running monitor for /jlu:start-dev. Polls TMUX, diffs pane captures,
// runs readiness probes, and emits JSONL events.
//
// Argv: --workspace-id <id> --slug <slug> --window <name> --config <abs>
//
// Lifecycle:
//   - acquire lock; write PID
//   - emit daemon_started
//   - loop tick = defaults.poll_interval_ms
//   - SIGHUP → reload config → emit daemon_reload
//   - SIGTERM → release lock → emit daemon_stopping → exit 0
//   - if window disappears → release lock → exit 0

import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { listWindows, listPanes, capturePane } from './tmux.mjs';
import { effectiveDefaults, effectiveFailurePatterns, readConfig } from './config.mjs';
import {
  acquireLock, releaseLock, writePid,
  eventsLogPath, windowNameFilePath
} from './state-daemon.mjs';
import { compilePatterns, matchLines, Cooldown } from './patterns-matcher.mjs';
import { probeHttp, probeTcp } from './readiness.mjs';
import { notifyOs } from './notify.mjs';
import { appendEvent, EVENT_TYPES } from './events.mjs';

function parseArgv(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--workspace-id') out.workspaceId = argv[++i];
    else if (argv[i] === '--slug') out.slug = argv[++i];
    else if (argv[i] === '--window') out.windowName = argv[++i];
    else if (argv[i] === '--config') out.configPath = argv[++i];
  }
  return out;
}

function tmuxRunner(args, opts = {}) {
  return spawnSync('tmux', args, { encoding: 'utf8', ...opts });
}

function emit(logPath, evt) {
  appendEvent(logPath, evt);
}

function diffLines(prev, current) {
  if (!prev) return current.split(/\r?\n/);
  if (current.startsWith(prev)) return current.slice(prev.length).split(/\r?\n/).filter(Boolean);
  // Reset (capture rolled over) — treat all of `current` as new.
  return current.split(/\r?\n/);
}

async function tick(ctx) {
  const { logPath, opts, windowName, paneState, readyState, captures, cooldown, runtimeNotifier } = ctx;
  const wins = listWindows(tmuxRunner);
  const win = wins.find(w => w.name === windowName);
  if (!win) {
    emit(logPath, { type: 'daemon_stopping', slug: opts.slug, reason: 'window-gone' });
    return { stop: true };
  }

  const target = `${win.session}:${windowName}`;
  const panes = listPanes({ window: target, runner: tmuxRunner });

  // Pane diff vs previous list.
  const prevTitles = Object.keys(paneState);
  const curTitles = panes.map(p => p.title);
  if (prevTitles.length && JSON.stringify(prevTitles.sort()) !== JSON.stringify(curTitles.sort())) {
    emit(logPath, {
      type: EVENT_TYPES.panes_changed,
      slug: opts.slug,
      added: curTitles.filter(t => !prevTitles.includes(t)),
      removed: prevTitles.filter(t => !curTitles.includes(t))
    });
  }

  // Per-pane processing.
  const cfg = ctx.config;
  for (const pane of panes) {
    const svc = (cfg.services || []).find(s => (s.panel && s.panel.title) === pane.title || s.name === pane.title);
    if (!svc) continue; // not a tracked service

    if (!paneState[pane.title]) {
      paneState[pane.title] = { id: pane.id, started: true, dead: false };
      emit(logPath, { type: EVENT_TYPES.pane_started, slug: opts.slug, service: svc.name, pane_id: pane.id });
    }

    if (pane.dead && !paneState[pane.title].dead) {
      paneState[pane.title].dead = true;
      emit(logPath, { type: EVENT_TYPES.pane_dead, slug: opts.slug, service: svc.name, pane_id: pane.id });
      const cdKey = `${svc.name}:hard`;
      if (cooldown.allow(cdKey)) {
        notifyOs({
          title: `jlu-dev: ${svc.name} failed`,
          body: `pane died — Run /jlu-diagnose ${svc.name}`,
          urgency: 'critical',
          runner: runtimeNotifier
        });
      }
      continue;
    }

    if (paneState[pane.title].dead) continue;

    // Capture-pane diff and pattern match.
    const out = capturePane({ target: `${target}.${panes.indexOf(pane)}`, lines: 200 }, tmuxRunner);
    const newLines = diffLines(captures[pane.title], out);
    captures[pane.title] = out;
    const compiled = compilePatterns(effectiveFailurePatterns(cfg, svc));
    const hits = matchLines(compiled, newLines);
    for (const hit of hits) {
      emit(logPath, { type: EVENT_TYPES.pattern_match, slug: opts.slug, service: svc.name, pattern: hit.pattern, line: hit.line });
    }

    // Readiness.
    if (svc.readiness && !(readyState[svc.name] && readyState[svc.name].ready)) {
      readyState[svc.name] = readyState[svc.name] || { tries: 0, started: Date.now() };
      const probe = svc.readiness.type === 'http'
        ? await probeHttp({ url: svc.readiness.url, expectStatus: svc.readiness.expect_status || 200, timeoutMs: 1000 })
        : await probeTcp({ host: svc.readiness.host, port: svc.readiness.port, timeoutMs: 1000 });
      readyState[svc.name].tries++;
      if (probe.ok) {
        readyState[svc.name].ready = true;
        emit(logPath, { type: EVENT_TYPES.ready, slug: opts.slug, service: svc.name });
      } else {
        const elapsed = (Date.now() - readyState[svc.name].started) / 1000;
        const limit = svc.readiness.timeout_seconds || effectiveDefaults(cfg).readiness_timeout_seconds;
        if (elapsed >= limit && !readyState[svc.name].failed) {
          readyState[svc.name].failed = true;
          emit(logPath, { type: EVENT_TYPES.readiness_failed, slug: opts.slug, service: svc.name, attempts: readyState[svc.name].tries });
          const cdKey = `${svc.name}:hard`;
          if (cooldown.allow(cdKey)) {
            notifyOs({
              title: `jlu-dev: ${svc.name} failed readiness`,
              body: `Run /jlu-diagnose ${svc.name}`,
              urgency: 'critical',
              runner: runtimeNotifier
            });
          }
        }
      }
    }
  }

  return { stop: false };
}

async function main() {
  const opts = parseArgv(process.argv);
  if (!opts.workspaceId || !opts.slug || !opts.windowName || !opts.configPath) {
    process.stderr.write('daemon: missing required argv\n');
    process.exit(2);
  }

  const lockResult = acquireLock(opts);
  if (!lockResult.acquired) {
    process.stderr.write(`daemon: lock held by pid ${lockResult.holderPid}\n`);
    process.exit(0);
  }

  writePid(opts, process.pid);
  writeFileSync(windowNameFilePath(opts), opts.windowName + '\n', 'utf8');

  let cfg = readConfig(opts.configPath);
  const logPath = eventsLogPath(opts);

  emit(logPath, { type: EVENT_TYPES.daemon_started, slug: opts.slug, pid: process.pid });

  const runtimeNotifier = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...o });
  const ctx = {
    config: cfg, opts, logPath, windowName: opts.windowName,
    paneState: {}, readyState: {}, captures: {},
    cooldown: Cooldown(effectiveDefaults(cfg).notification_cooldown_seconds),
    runtimeNotifier
  };

  let stop = false;
  process.on('SIGHUP', () => {
    try {
      cfg = readConfig(opts.configPath);
      ctx.config = cfg;
      emit(logPath, { type: EVENT_TYPES.daemon_reload, slug: opts.slug });
    } catch (e) {
      process.stderr.write(`daemon: SIGHUP reload failed: ${e.message}\n`);
    }
  });
  process.on('SIGTERM', () => { stop = true; });
  process.on('SIGINT', () => { stop = true; });

  while (!stop) {
    try {
      const r = await tick(ctx);
      if (r.stop) stop = true;
    } catch (e) {
      process.stderr.write(`daemon: tick error: ${e.stack || e.message}\n`);
    }
    if (stop) break;
    await new Promise(r => setTimeout(r, effectiveDefaults(cfg).poll_interval_ms));
  }

  releaseLock(opts);
  emit(logPath, { type: 'daemon_stopping', slug: opts.slug });
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`daemon: fatal: ${e.stack || e.message}\n`);
  process.exit(1);
});

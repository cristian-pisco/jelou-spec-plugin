// bin/lib/dev-orchestrator/config.mjs
//
// Read / write / validate jlu-services.json. Atomic writes via tmpfile + rename.
// Hand-rolled validation (no external deps) covering the rules in the schema doc.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertInt(errors, ctx, key, val, { min, max } = {}) {
  if (val === undefined) return;
  if (!Number.isInteger(val)) {
    errors.push(`${ctx}.${key} must be an integer (got ${JSON.stringify(val)})`);
    return;
  }
  if (min !== undefined && val < min) errors.push(`${ctx}.${key} must be >= ${min} (got ${val})`);
  if (max !== undefined && val > max) errors.push(`${ctx}.${key} must be <= ${max} (got ${val})`);
}

function assertAllowedKeys(errors, ctx, obj, allowed) {
  for (const k of Object.keys(obj || {})) {
    if (!allowed.has(k)) errors.push(`${ctx} has unknown key: ${JSON.stringify(k)}`);
  }
}

const ALLOWED_SERVICE_KEYS = new Set(['name', 'path', 'command', 'env_file', 'depends_on', 'readiness', 'runtime', 'log_failure_patterns', 'panel']);
const ALLOWED_DEFAULTS_KEYS = new Set(['log_failure_patterns', 'readiness_timeout_seconds', 'log_capture_lines', 'poll_interval_ms', 'notification_cooldown_seconds', 'window_prefix']);
const ALLOWED_PANEL_KEYS = new Set(['title', 'color']);
const ALLOWED_RUNTIME_KEYS = new Set(['type', 'compose_file', 'compose_service', 'exec_template']);
const ALLOWED_READINESS_HTTP_KEYS = new Set(['type', 'url', 'expect_status', 'timeout_seconds']);
const ALLOWED_READINESS_TCP_KEYS = new Set(['type', 'host', 'port', 'timeout_seconds']);

export const DEFAULTS = Object.freeze({
  log_failure_patterns: [
    'EADDRINUSE',
    'Cannot find module',
    'ENOENT.*node_modules',
    'ECONNREFUSED',
    'no such file or directory',
    'container .* not running',
    'service ".*" is not running'
  ],
  readiness_timeout_seconds: 30,
  log_capture_lines: 100,
  poll_interval_ms: 2000,
  notification_cooldown_seconds: 60,
  window_prefix: ''
});

export function validateConfig(cfg) {
  const errors = [];

  if (!cfg || typeof cfg !== 'object') {
    return { valid: false, errors: ['config must be an object'] };
  }

  if (cfg.version !== 1) {
    errors.push(`version must be 1 (got ${JSON.stringify(cfg.version)})`);
  }

  if (!Array.isArray(cfg.services)) {
    errors.push('services must be an array');
    return { valid: false, errors };
  }

  const seen = new Set();
  cfg.services.forEach((svc, idx) => {
    const ctx = `services[${idx}]`;
    if (!svc || typeof svc !== 'object') {
      errors.push(`${ctx} must be an object`);
      return;
    }
    assertAllowedKeys(errors, ctx, svc, ALLOWED_SERVICE_KEYS);
    if (typeof svc.name !== 'string' || !NAME_RE.test(svc.name)) {
      errors.push(`${ctx}.name must match /^[a-z0-9][a-z0-9-]*$/ (got ${JSON.stringify(svc.name)})`);
    } else if (seen.has(svc.name)) {
      errors.push(`${ctx}.name duplicate: ${svc.name}`);
    } else {
      seen.add(svc.name);
    }
    if (typeof svc.path !== 'string' || !svc.path.length) errors.push(`${ctx}.path must be a non-empty string`);
    if (typeof svc.command !== 'string' || !svc.command.length) errors.push(`${ctx}.command must be a non-empty string`);
    if (svc.env_file !== undefined && svc.env_file !== null && typeof svc.env_file !== 'string') {
      errors.push(`${ctx}.env_file must be string or null`);
    }
    if (svc.depends_on !== undefined && !Array.isArray(svc.depends_on)) {
      errors.push(`${ctx}.depends_on must be an array of strings`);
    }
    if (svc.log_failure_patterns) {
      if (!Array.isArray(svc.log_failure_patterns)) {
        errors.push(`${ctx}.log_failure_patterns must be an array`);
      } else {
        svc.log_failure_patterns.forEach((p, pi) => {
          try { new RegExp(p, 'i'); }
          catch (e) { errors.push(`${ctx}.log_failure_patterns[${pi}] invalid regex: ${e.message}`); }
        });
      }
    }
    if (svc.panel) {
      assertAllowedKeys(errors, `${ctx}.panel`, svc.panel, ALLOWED_PANEL_KEYS);
    }
    if (svc.runtime) {
      const r = svc.runtime;
      assertAllowedKeys(errors, `${ctx}.runtime`, r, ALLOWED_RUNTIME_KEYS);
      if (r.type !== 'host' && r.type !== 'docker-compose') {
        errors.push(`${ctx}.runtime.type must be "host" or "docker-compose"`);
      }
      if (r.type === 'docker-compose') {
        if (typeof r.compose_file !== 'string' || !r.compose_file) errors.push(`${ctx}.runtime.compose_file required for docker-compose`);
        if (typeof r.compose_service !== 'string' || !r.compose_service) errors.push(`${ctx}.runtime.compose_service required for docker-compose`);
      }
    }
    if (svc.readiness) {
      const r = svc.readiness;
      assertInt(errors, `${ctx}.readiness`, 'timeout_seconds', r.timeout_seconds, { min: 1 });
      if (r.type === 'http') {
        assertAllowedKeys(errors, `${ctx}.readiness`, r, ALLOWED_READINESS_HTTP_KEYS);
        if (typeof r.url !== 'string') errors.push(`${ctx}.readiness.url required for http`);
        assertInt(errors, `${ctx}.readiness`, 'expect_status', r.expect_status);
      } else if (r.type === 'tcp') {
        assertAllowedKeys(errors, `${ctx}.readiness`, r, ALLOWED_READINESS_TCP_KEYS);
        if (typeof r.host !== 'string') errors.push(`${ctx}.readiness.host required for tcp`);
        if (!Number.isInteger(r.port)) {
          errors.push(`${ctx}.readiness.port required for tcp`);
        } else {
          assertInt(errors, `${ctx}.readiness`, 'port', r.port, { min: 1, max: 65535 });
        }
      } else {
        errors.push(`${ctx}.readiness.type must be "http" or "tcp"`);
      }
    }
  });

  if (cfg.defaults) {
    assertAllowedKeys(errors, 'defaults', cfg.defaults, ALLOWED_DEFAULTS_KEYS);
    assertInt(errors, 'defaults', 'poll_interval_ms', cfg.defaults.poll_interval_ms, { min: 250 });
    assertInt(errors, 'defaults', 'readiness_timeout_seconds', cfg.defaults.readiness_timeout_seconds, { min: 1 });
    assertInt(errors, 'defaults', 'log_capture_lines', cfg.defaults.log_capture_lines, { min: 1 });
    assertInt(errors, 'defaults', 'notification_cooldown_seconds', cfg.defaults.notification_cooldown_seconds, { min: 0 });
    if (cfg.defaults.window_prefix !== undefined && typeof cfg.defaults.window_prefix !== 'string') {
      errors.push(`defaults.window_prefix must be a string (got ${JSON.stringify(cfg.defaults.window_prefix)})`);
    }
    if (cfg.defaults.log_failure_patterns) {
      cfg.defaults.log_failure_patterns.forEach((p, i) => {
        try { new RegExp(p, 'i'); }
        catch (e) { errors.push(`defaults.log_failure_patterns[${i}] invalid regex: ${e.message}`); }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function readConfig(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

export function writeConfigAtomic(absPath, cfg) {
  const v = validateConfig(cfg);
  if (!v.valid) {
    const err = new Error(`refusing to write invalid config:\n${v.errors.join('\n')}`);
    err.code = 'INVALID_CONFIG';
    throw err;
  }
  const dir = dirname(absPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${absPath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  renameSync(tmp, absPath);
}

export function effectiveDefaults(cfg) {
  return { ...DEFAULTS, ...(cfg.defaults || {}) };
}

export function effectiveFailurePatterns(cfg, service) {
  const eff = effectiveDefaults(cfg);
  const merged = [...(eff.log_failure_patterns || []), ...(service.log_failure_patterns || [])];
  return [...new Set(merged)];
}

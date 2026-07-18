import { readFileSync } from 'node:fs';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED_SERVICE_KEYS = new Set(['name', 'path', 'command', 'mode', 'compose_file', 'compose_service', 'port_mappings', 'readiness', 'peers']);
const ALLOWED_MODES = new Set(['exec', 'start', 'compose']);
const ALLOWED_MAPPING_KEYS = new Set(['internal', 'port_env', 'primary']);

function assertPort(errors, ctx, val) {
  if (!Number.isInteger(val) || val < 1 || val > 65535) {
    errors.push(`${ctx} must be a port in 1..65535 (got ${JSON.stringify(val)})`);
  }
}

export function validateStack(stack) {
  const errors = [];
  if (!stack || typeof stack !== 'object') {
    return { valid: false, errors: ['stack must be an object'] };
  }
  if (!Number.isInteger(stack.basePort) || stack.basePort < 1 || stack.basePort > 65535) {
    errors.push(`stack.basePort must be a port in 1..65535 (got ${JSON.stringify(stack.basePort)})`);
  }
  if (typeof stack.composeNetworkAlias !== 'string' || stack.composeNetworkAlias.length === 0) {
    errors.push('stack.composeNetworkAlias must be a non-empty string');
  }
  if (!Array.isArray(stack.services) || stack.services.length === 0) {
    errors.push('stack.services must be a non-empty array');
    return { valid: false, errors };
  }
  const names = new Set();
  for (const svc of stack.services) {
    if (svc && typeof svc.name === 'string') names.add(svc.name);
  }
  const seen = new Set();
  stack.services.forEach((svc, idx) => {
    const ctx = `services[${idx}]`;
    if (!svc || typeof svc !== 'object') {
      errors.push(`${ctx} must be an object`);
      return;
    }
    for (const k of Object.keys(svc)) {
      if (!ALLOWED_SERVICE_KEYS.has(k)) errors.push(`${ctx} has unknown key: ${JSON.stringify(k)}`);
    }
    if (typeof svc.name !== 'string' || !NAME_RE.test(svc.name)) {
      errors.push(`${ctx}.name must match ${NAME_RE} (got ${JSON.stringify(svc.name)})`);
    } else if (seen.has(svc.name)) {
      errors.push(`${ctx}.name is a duplicate: ${svc.name}`);
    } else {
      seen.add(svc.name);
    }
    if (typeof svc.path !== 'string' || svc.path.length === 0) errors.push(`${ctx}.path must be a non-empty string`);
    if (typeof svc.command !== 'string' || svc.command.length === 0) errors.push(`${ctx}.command must be a non-empty string`);
    if (!ALLOWED_MODES.has(svc.mode)) errors.push(`${ctx}.mode must be one of ${[...ALLOWED_MODES].join(', ')}`);
    if (typeof svc.compose_file !== 'string' || svc.compose_file.length === 0) errors.push(`${ctx}.compose_file must be a non-empty string`);
    if (typeof svc.compose_service !== 'string' || svc.compose_service.length === 0) errors.push(`${ctx}.compose_service must be a non-empty string`);
    if (!svc.readiness || typeof svc.readiness !== 'object' || typeof svc.readiness.url !== 'string' || svc.readiness.url.length === 0) {
      errors.push(`${ctx}.readiness.url must be a non-empty string`);
    }
    if (!Array.isArray(svc.port_mappings) || svc.port_mappings.length === 0) {
      errors.push(`${ctx}.port_mappings must be a non-empty array`);
    } else {
      let primaries = 0;
      svc.port_mappings.forEach((m, j) => {
        const mctx = `${ctx}.port_mappings[${j}]`;
        for (const k of Object.keys(m || {})) {
          if (!ALLOWED_MAPPING_KEYS.has(k)) errors.push(`${mctx} has unknown key: ${JSON.stringify(k)}`);
        }
        assertPort(errors, `${mctx}.internal`, m && m.internal);
        if (typeof m.port_env !== 'string' || m.port_env.length === 0) errors.push(`${mctx}.port_env must be a non-empty string`);
        if (m.primary === true) primaries += 1;
      });
      if (primaries !== 1) errors.push(`${ctx}.port_mappings must have exactly one primary (got ${primaries})`);
    }
    if (svc.peers !== undefined) {
      if (typeof svc.peers !== 'object' || svc.peers === null || Array.isArray(svc.peers)) {
        errors.push(`${ctx}.peers must be an object`);
      } else {
        for (const [target, envVar] of Object.entries(svc.peers)) {
          if (!names.has(target)) errors.push(`${ctx}.peers references unregistered service: ${target}`);
          if (typeof envVar !== 'string' || envVar.length === 0) errors.push(`${ctx}.peers.${target} must map to a non-empty env var name`);
        }
      }
    }
  });
  const fe = stack.frontend;
  if (fe && fe.envLocal && typeof fe.envLocal === 'object') {
    for (const [key, spec] of Object.entries(fe.envLocal)) {
      if (!spec || typeof spec !== 'object' || typeof spec.service !== 'string') {
        errors.push(`frontend.envLocal.${key} must be an object with a service string`);
      } else if (!names.has(spec.service)) {
        errors.push(`frontend.envLocal.${key} references unregistered service: ${spec.service}`);
      }
    }
  }
  const au = stack.auth;
  if (au) {
    if (au.dashboardService !== undefined && !names.has(au.dashboardService)) {
      errors.push(`auth.dashboardService references unregistered service: ${au.dashboardService}`);
    }
    for (const v of (Array.isArray(au.verify) ? au.verify : [])) {
      if (!v || typeof v.service !== 'string' || !names.has(v.service)) {
        errors.push(`auth.verify references unregistered service: ${v && v.service}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function loadStack(absPath) {
  const stack = JSON.parse(readFileSync(absPath, 'utf8'));
  const { valid, errors } = validateStack(stack);
  if (!valid) {
    const err = new Error(`invalid stack registry: ${errors.join('; ')}`);
    err.code = 'INVALID_STACK';
    throw err;
  }
  return stack;
}

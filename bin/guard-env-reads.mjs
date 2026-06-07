#!/usr/bin/env node
// PreToolUse guard for env-file reads (wired via hooks/hooks.json).
//
// Reading a real .env into the conversation puts live secrets (tokens, API
// keys, client secrets) in the model context. Combined with login-automation
// code (Playwright auth fixtures), that content fingerprint has triggered
// API-level Usage Policy rejections that kill the session — every subsequent
// request re-sends the poisoned context and fails. This guard makes the
// hygiene rule deterministic: env-file contents never enter the transcript;
// agents check vars by NAME via quiet bash and edit via sed -i / append.
//
// Stdin: PreToolUse JSON ({ tool_name, tool_input, cwd }).
// Stdout: permissionDecision JSON on deny; nothing on allow.
// Escape hatch for humans (never suggest it to agents): JLU_ENV_GUARD=off.

import { pathToFileURL } from 'node:url';

const POLICY = 'env hygiene: secrets in context have caused Usage Policy session kills';

const TEMPLATE_SUFFIXES = new Set(['example', 'sample', 'template', 'dist']);
const PRINTERS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'tac',
  'strings', 'od', 'xxd', 'hexdump',
]);
const GREPPERS = new Set(['grep', 'egrep', 'fgrep', 'rg']);
const WRAPPERS = new Set(['sudo', 'command', 'nice', 'time', 'env']);

const allow = () => ({ decision: 'allow' });
const deny = (reason) => ({ decision: 'deny', reason: `jlu env guard: ${reason}` });

const HOW_INSTEAD =
  'Check a var by name: `grep -qE \'^VAR_NAME=\' .env.e2e`. ' +
  'Append: `printf \'%s\\n\' \'VAR=value\' >> .env.e2e`. ' +
  'Modify in place: `sed -i \'s/^VAR=.*/VAR=new/\' .env.e2e`. ' +
  'Never print env-file contents into the conversation';

function stripQuotes(token) {
  return token.replace(/^['"]|['"]$/g, '');
}

function isEnvFile(token) {
  const base = stripQuotes(token).split('/').pop();
  const m = /^\.env(?:\.(.+))?$/.exec(base);
  if (!m) return false;
  return !TEMPLATE_SUFFIXES.has(m[1] ?? '');
}

export function classifyRead(filePath) {
  if (typeof filePath !== 'string' || !isEnvFile(filePath)) return allow();
  return deny(
    `reading '${filePath}' would load live secrets into the model context (${POLICY}). ${HOW_INSTEAD}.`,
  );
}

// Quote-aware segment split on ; | && || — same approach as guard-test-commands.
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === ';' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      if (ch === '&') i += 1;
      if (ch === '|' && command[i + 1] === '|') i += 1;
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.replace(/^[\s(]+/, '').trim()).filter(Boolean);
}

function tokenize(segment) {
  return segment.trim().split(/\s+/).filter(Boolean);
}

function effectiveTokens(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { i += 1; continue; }
    if (WRAPPERS.has(stripQuotes(token).split('/').pop())) { i += 1; continue; }
    return tokens.slice(i);
  }
  return [];
}

function hasQuietishFlag(tokens) {
  return tokens.some((t) => {
    if (/^--(quiet|silent|files-with-matches|files-without-match|count)$/.test(t)) return true;
    return /^-[A-Za-z]+$/.test(t) && /[qlLc]/.test(t);
  });
}

export function classifyBashCommand(command) {
  if (typeof command !== 'string' || !/\.env/.test(command)) return allow();

  for (const segment of splitSegments(command)) {
    const tokens = effectiveTokens(tokenize(segment));
    if (tokens.length === 0) continue;
    const cmd = stripQuotes(tokens[0]).split('/').pop();
    const rest = tokens.slice(1);
    const envArgs = rest.filter(isEnvFile);
    if (envArgs.length === 0) continue;

    if (PRINTERS.has(cmd)) {
      return deny(
        `\`${cmd} ${envArgs[0]}\` prints live secrets into the model context (${POLICY}). ${HOW_INSTEAD}.`,
      );
    }
    if (GREPPERS.has(cmd) && !hasQuietishFlag(rest)) {
      return deny(
        `\`${cmd}\` over ${envArgs[0]} without -q/-l/-c echoes matched lines — values included — into the model context (${POLICY}). ${HOW_INSTEAD}.`,
      );
    }
    if (cmd === 'sed' && !rest.some((t) => /^-[A-Za-z]*i/.test(t))) {
      return deny(
        `\`sed\` over ${envArgs[0]} without -i streams file contents into the model context (${POLICY}). ${HOW_INSTEAD}.`,
      );
    }
    if (cmd === 'awk') {
      return deny(
        `\`awk\` over ${envArgs[0]} prints file contents into the model context (${POLICY}). ${HOW_INSTEAD}.`,
      );
    }
  }
  return allow();
}

async function main() {
  if (process.env.JLU_ENV_GUARD === 'off') return;

  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }

  let verdict = allow();
  if (payload?.tool_name === 'Read') {
    verdict = classifyRead(payload?.tool_input?.file_path);
  } else if (payload?.tool_name === 'Bash') {
    verdict = classifyBashCommand(payload?.tool_input?.command);
  }

  if (verdict.decision === 'deny') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
    }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

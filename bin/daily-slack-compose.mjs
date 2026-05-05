#!/usr/bin/env node
// bin/daily-slack-compose.mjs
//
// Deterministic placeholder substitution for the daily-slack message body.
// Reads the channel template body, the auto-rendered fields (achieved_goals,
// not_achieved_goals, short_term_goals) from --render JSON, and the manual
// fields (energy, meetings, etc.) from --manual JSON. Replaces every
// {{placeholder}} with the corresponding value via plain string replacement
// — never regex, never LLM rewriting — and prints the composed body.
//
// Unknown placeholders are left intact so they remain visible in the preview
// instead of being silently blanked. Render keys override manual keys on
// collision (auto fields are authoritative).
//
// Usage:
//   node bin/daily-slack-compose.mjs \
//     --template <path-to-template.md> \
//     --render <path-to-render.json> \
//     --manual <path-to-manual.json>

import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--template') args.template = argv[++i];
    else if (argv[i] === '--render') args.render = argv[++i];
    else if (argv[i] === '--manual') args.manual = argv[++i];
  }
  const missing = [];
  if (!args.template) missing.push('--template');
  if (!args.render) missing.push('--render');
  if (!args.manual) missing.push('--manual');
  if (missing.length) {
    console.error(`error: required arg(s) missing: ${missing.join(', ')}`);
    process.exit(2);
  }
  return args;
}

function compose(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const template = readOrDie(args.template, '--template');
  const render = parseJsonOrDie(readOrDie(args.render, '--render'), '--render');
  const manual = parseJsonOrDie(readOrDie(args.manual, '--manual'), '--manual');
  const values = { ...manual, ...render };
  process.stdout.write(compose(template, values));
}

main();

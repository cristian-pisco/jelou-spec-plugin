#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { argv, stdout, stderr, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;

function die(msg, code = 1) {
  stderr.write(`ERROR: ${msg}\n`);
  exit(code);
}

function parseArgs(rawArgs) {
  const out = { file: null, sections: [] };
  for (const arg of rawArgs) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) die(`unexpected argument: ${arg}`);
    const [, flag, value] = m;
    if (flag === 'file') {
      if (!value || value.trim() === '') die('--file requires a markdown file path');
      out.file = value.trim();
    } else if (flag === 'section') {
      if (!value || value.trim() === '') die('--section requires a non-empty section name');
      out.sections.push(value.trim());
    } else {
      die(`unknown flag: --${flag} (expected --file, --section)`);
    }
  }
  return out;
}

function indexSections(content) {
  const byName = new Map();
  let current = null;
  for (const line of content.split('\n')) {
    const m = line.match(HEADING);
    if (m && m[1].length <= 2) {
      current = null;
      if (m[1].length === 2) {
        const key = m[2].trim().toLowerCase();
        current = { lines: [line] };
        if (!byName.has(key)) byName.set(key, current);
      }
      continue;
    }
    if (current) current.lines.push(line);
  }
  return byName;
}

export function extractSections(content, names) {
  const byName = indexSections(content);
  const found = [];
  const missing = [];
  for (const name of names) {
    const section = byName.get(name.trim().toLowerCase());
    if (section) found.push(section.lines.join('\n').replace(/\s+$/, ''));
    else missing.push(name);
  }
  return { found, missing };
}

function main() {
  const { file, sections } = parseArgs(argv.slice(2));
  if (!file) die('--file is required');
  if (sections.length === 0) die('at least one --section is required');
  if (!existsSync(file) || !statSync(file).isFile()) die(`file not found: ${file}`, 2);

  const { found, missing } = extractSections(readFileSync(file, 'utf8'), sections);
  if (missing.length > 0) {
    die(`section(s) not found in ${file}: ${missing.map((s) => `## ${s}`).join(', ')}`, 3);
  }
  stdout.write(`${found.join('\n\n')}\n`);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

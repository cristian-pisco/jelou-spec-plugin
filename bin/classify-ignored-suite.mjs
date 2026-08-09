#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function die(msg, code = 1) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function git(repo, gitArgs, input) {
  return spawnSync('git', ['-C', repo, ...gitArgs], { input, encoding: 'utf8' });
}

function findExclusion(repo, suitePath) {
  const res = git(repo, ['check-ignore', '-v', '-z', '--stdin'], `${suitePath}\0`);
  if (res.error) die(`could not run git: ${res.error.message}`, 3);
  if (res.status === 1) return null;
  if (res.status !== 0) die(`git check-ignore failed: ${(res.stderr || '').trim()}`, 3);
  const fields = res.stdout.split('\0');
  if (fields.length < 4) die(`unparseable git check-ignore output for ${suitePath}`, 3);
  return { file: fields[0], line: fields[1], rule: fields[2] };
}

function isTracked(repo, file) {
  return git(repo, ['ls-files', '--error-unmatch', '--', file], '').status === 0;
}

const args = parseArgs(process.argv);
const suitePath = args.path;
const repo = args.repo;

if (typeof suitePath !== 'string' || suitePath === '') die('--path=<suite-path> required', 2);
if (typeof repo !== 'string' || repo === '') die('--repo=<repo-or-worktree-root> required', 2);
if (!existsSync(repo) || !statSync(repo).isDirectory()) {
  die(`repo not found or not a directory: ${repo}`, 2);
}

const exclusion = findExclusion(repo, suitePath);

let result;
if (exclusion === null) {
  result = { status: 'not_ignored', rule: null, source: null, action: 'commit', caveat: null };
} else {
  const source = `${exclusion.file}:${exclusion.line}`;
  if (isTracked(repo, exclusion.file)) {
    result = {
      status: 'repo_rule',
      rule: exclusion.rule,
      source,
      action: 'leave_uncommitted',
      caveat: `Generated suite exists locally at ${suitePath} but is excluded by committed rule '${exclusion.rule}' from ${source} — it is not part of this PR.`,
    };
  } else {
    result = {
      status: 'local_rule',
      rule: exclusion.rule,
      source,
      action: 'force_add',
      caveat: `Generated suite at ${suitePath} was force-added over the local, uncommitted rule '${exclusion.rule}' from ${source}, which does not decide what this PR contains.`,
    };
  }
}

process.stdout.write(JSON.stringify(result, null, 2) + '\n');

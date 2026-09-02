#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function die(msg, code = 2) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

const AGENT_TYPES = [
  'tdd-cycle',
  'proposal-agent',
  'test-writer',
  'build-validator',
  'git-agent',
  'implementer',
];

const PHASE_AWARE_AGENTS = new Set(['tdd-cycle', 'test-writer', 'implementer']);

const TEST_TIER_BY_AGENT = { 'tdd-cycle': '1', 'test-writer': '2' };

const SHARED_CONSTRAINTS = [
  'Read `SUBAGENT_BASELINE` (path in `## CONTEXT`) before your first action. It is the authoritative operational baseline — context discipline, the Docker ban, test worker caps, the waiting rules, the three-strike rule, and the reporting format. The constraints below restate the load-bearing ones for this dispatch and never override it.',
  'Stay inside `SERVICE_SOURCE_PATH`. Do not edit another service\'s source tree, the task artifacts under `TASK_DIR`, or the plugin repository.',
  'Write zero comments in any code you author or edit — no line comments, no doc-comments or JSDoc on any declaration, no "why" notes. Use self-documenting names or an extracted helper instead.',
  'Docker is forbidden: no Testcontainers, no `docker` / `docker compose` / `podman`, no container-exec prefix on any command. Everything runs on the host runtime.',
  'Every test invocation names explicit test file paths and carries the runner worker cap (`jest --maxWorkers=2` or `--runInBand`, `vitest run --pool=threads --poolOptions.threads.maxThreads=2`, `playwright --workers=1`, `node --test <one file>`, `pytest -n 2`). Never the bare package test script, never `--watch`, never `--coverage`.',
  'One heavy process at a time, and never sleep a fixed duration to wait for one. Run it in the foreground under an explicit timeout, or in the background and wait for its completion signal; sleep only as the sampling interval of a loop that polls a condition you do not own.',
  'Never run `git push --force`, `git reset --hard`, `git rebase`, `git checkout` of a base branch (`main` / `master` / `alpha`), `git branch -D`, or `git commit --no-verify`.',
  'Refuse rather than bend: if a constraint here blocks the task, stop and say so in your report. After 5 rounds on the same failure, stop and report `status: blocked` with the hypotheses tried and the evidence that ruled each one out.',
];

const AGENT_CONSTRAINTS = {
  'tdd-cycle': [
    'RED before GREEN, always. No production line may be written before a test that fails for the right reason exists and has been observed failing.',
    'One vertical slice at a time. A surface batch (rejections plus boundary cases) counts as a single slice.',
    'Never weaken, skip, or delete a test to reach GREEN. If a test must change, record it under `Test Rewrites` with the spec quote that justifies it.',
    'Implement only what this phase requires. Do not start a later phase, and never edit the phase file\'s `## Requirements` or `## Acceptance` sections — they are immutable.',
  ],
  'test-writer': [
    'You author tests only. Never write or edit production code — if the tests cannot be written without it, refuse and report why.',
    'Tests assume every real dependency is already running on the host. If one is not, mark the test skipped with the reason; never start a service, a database, or a container yourself.',
  ],
  implementer: [
    'Never edit a test file to make it pass. The tests are the specification; if a test is genuinely wrong, report it and stop.',
    'Write the minimum code that turns the failing tests green. No speculative features, no abstractions for single-use code.',
  ],
  'build-validator': [
    'Build, type-check, lint, and format only. Never change a test expectation or a behavioral assertion to make the build pass.',
    'Fix only errors the build itself reports, and only in the files it names. Everything else is a finding for the report, not an edit.',
  ],
  'proposal-agent': [
    'You write planning artifacts only (`PROPOSAL.md`, phase files, stories). Never touch service source code or tests.',
    'Every phase you emit traces to at least one SPEC requirement, is small enough for one TDD cycle, and never depends on a later phase.',
  ],
  'git-agent': [
    'Operate only on the task branch named in `## CONTEXT`. Never create, switch, merge, or delete a branch, and never push to a base branch.',
    'Never bypass a hook. If a pre-commit hook rejects the commit, report its output verbatim and stop — fixing the code is another agent\'s job.',
  ],
};

const PROCEDURES = {
  'tdd-cycle': [
    'Read `PHASE_FILE`, then only the parts of the service source you need. Grep before you read.',
    'Derive every requirement\'s case matrix from the DTO / type surface and from `## CASE MATRIX` below, then order the slices.',
    'Per slice: write the failing test, run it and observe RED, write the minimum code, run it again and observe GREEN. One test file per run, with the worker cap.',
    'When every requirement is green, run this phase\'s test files once together to confirm nothing regressed.',
    'Do not commit, do not push, do not format the repository — the orchestrator owns those steps.',
  ],
  'test-writer': [
    'Read the requirements handed to you, then two or three neighbouring test files to copy the repository\'s test conventions.',
    'Author the tests, covering the full case matrix for every requirement that validates or types input.',
    'Run only the test files you wrote, with explicit paths and the worker cap. Report failures — do not fix them by writing production code.',
  ],
  implementer: [
    'Reproduce the reported failure first, running only the named test files with the worker cap.',
    'Find the root cause before editing. From round 3 on, apply the root-cause procedure in `systematic-debugging.md` before each fix.',
    'Apply the minimum fix, re-run the same test files, and report the exact command you ran.',
  ],
  'build-validator': [
    'Detect the service\'s build / type-check command from its manifest (`package.json` scripts, `tsconfig.json`, `Makefile`) and run it, capturing output through `tail`.',
    'Long error chains have one root error and many cascades — fix the root, then re-run before touching anything else.',
    'Re-run the build after the last fix and report the final exit status.',
  ],
  'proposal-agent': [
    'Read `SPEC` and the service `TASK_CONTEXT`, then grep the service source for the modules each phase touches; do not read the whole service.',
    'Write the global strategy pass first (affected services, execution strategy, dependency order), then the per-service phase breakdown.',
    'Emit one phase file per phase under `TASK_DIR/services/<service>/phases/`, each carrying `**Needs:**`, `## Requirements (immutable)`, and `## Acceptance (immutable)`.',
  ],
  'git-agent': [
    'Verify you are on `TASK_BRANCH` before anything else. If you are not, stop and report it.',
    'Stage exactly the declared files, commit with the conventional-commit message you were given, and push the task branch.',
    'Report the resulting commit SHA and the file count.',
  ],
};

const RETURNS = {
  'tdd-cycle': [
    'A `TDD Cycle Report — Phase <NN>` containing: `Status` (GREEN | blocked), a per-slice table (slice, test file, RED observed, GREEN observed), `Files Modified`, `Tests Written`, `Refactor Candidates`, `Test Rewrites`, `Test Objections`, `Deviations from Expected Approach`, `Tier 2 Deferred`, and a final `Command:` line with the exact invocation you ran. The last four default to the literal `None`.',
  ],
  'test-writer': [
    'A report containing: `Status`, `Tests Written` (paths), `Requirements Covered`, `Requirements Not Covered` (with reason), `Skipped Tests` (with the missing dependency), and a final `Command:` line.',
  ],
  implementer: [
    'A report containing: `Status` (GREEN | blocked), `Root Cause`, `Files Modified`, `Rounds` (what you tried and the evidence that ruled each hypothesis out), and a final `Command:` line.',
  ],
  'build-validator': [
    'A report containing: `Status` (PASS | FAIL | SKIP with reason), `Errors Fixed`, `Files Modified`, `Remaining Findings`, and a final `Command:` line.',
  ],
  'proposal-agent': [
    'A report containing: `Phases Written` (path per phase), `Execution Strategy`, `Dependency Order`, `Open Questions`, and `Requirements Not Covered` (defaults to the literal `None`).',
  ],
  'git-agent': [
    'A report containing: `Status` (committed | aborted with reason), `Commit SHA`, `Files Committed`, `Branch`, and the exact git commands you ran.',
  ],
};

function stripHtmlComments(lines) {
  const out = [];
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true;
      continue;
    }
    out.push(line);
  }
  return out;
}

function sectionBody(content, headingPattern, stopPattern) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (stopPattern.test(lines[i])) break;
    body.push(lines[i]);
  }
  return stripHtmlComments(body).join('\n').trim();
}

function phaseIdFromFilename(filename) {
  const stem = basename(filename).replace(/\.md$/, '');
  const m = stem.match(/^(\d+[a-z]?)-/);
  return m ? m[1] : stem;
}

function phaseTitle(content, phaseId) {
  const m = content.match(/^#\s+(.+?)\s*$/m);
  if (!m) return `Phase ${phaseId}`;
  return m[1].trim().replace(/^Phase\s+\S+?:\s*/, '');
}

function requirementLabels(requirementsBody) {
  if (!requirementsBody) return [];
  const labels = [];
  for (const line of requirementsBody.split('\n')) {
    const m = line.match(/^-\s*\**((?:FR|NFR|SC)-\d+[a-z]?)/);
    if (m && !labels.includes(m[1])) labels.push(m[1]);
  }
  return labels;
}

function readPhaseFile(path) {
  const content = readFileSync(path, 'utf8');
  const id = phaseIdFromFilename(path);
  return {
    path,
    id,
    title: phaseTitle(content, id),
    requirements: sectionBody(content, /^##\s+Requirements\b/, /^##\s/),
    acceptance: sectionBody(content, /^##\s+Acceptance\b/, /^##\s/),
    artifacts: sectionBody(content, /^###\s+Artifacts\b/, /^#{2,3}\s/),
    status: (content.match(/^###\s+Status:\s*(.+?)\s*$/m) || [null, 'unknown'])[1],
  };
}

function precedingPhaseFiles(phasesDir, targetFilename) {
  if (!existsSync(phasesDir)) return [];
  return readdirSync(phasesDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .filter((f) => f < targetFilename)
    .map((f) => join(phasesDir, f));
}

function bulletList(items) {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function renderContext(ctx) {
  const rows = [
    ['PLUGIN_ROOT', ctx.pluginRoot],
    ['SUBAGENT_BASELINE', ctx.subagentBaseline],
    ['TASK_DIR', ctx.taskDir],
    ['TASK_SLUG', ctx.taskSlug],
    ['SERVICE_ID', ctx.serviceId],
    ['SERVICE_SOURCE_PATH', ctx.serviceSourcePath],
    ['TASK_BRANCH', ctx.taskBranch],
    ['SPEC', ctx.specPath],
    ['PROPOSAL', ctx.proposalPath],
    ['TASK_CONTEXT', ctx.taskContextPath],
    ['PHASE_FILE', ctx.phaseFilePath],
    ['PHASE_ID', ctx.phaseId],
    ['PHASE_TITLE', ctx.phaseTitleText],
    ['TEST_TIER', ctx.testTier],
    ['REPORT_DIR', ctx.reportDir],
  ];
  const body = rows.filter(([, value]) => value).map(([key, value]) => `- ${key}: ${value}`);
  return `## CONTEXT\n${body.join('\n')}`;
}

function renderExistingFoundation(serviceId, preceding) {
  if (preceding.length === 0) {
    return `## EXISTING FOUNDATION\nNone — this is the first phase of ${serviceId} in this task.`;
  }
  const blocks = preceding.map((phase) => {
    const lines = [`### Phase ${phase.id}: ${phase.title}`];
    lines.push(`- Status: ${phase.status}`);
    const labels = requirementLabels(phase.requirements);
    if (labels.length > 0) lines.push(`- Covered: ${labels.join(', ')}`);
    if (phase.artifacts) {
      lines.push('- Artifacts:');
      for (const line of phase.artifacts.split('\n')) {
        lines.push(line === '' ? '' : `  ${line}`);
      }
    }
    return lines.join('\n');
  });
  return `## EXISTING FOUNDATION\nAlready built and committed by earlier phases of this service. Reuse it; do not re-implement or re-test it.\n\n${blocks.join('\n\n')}`;
}

function renderCaseMatrix(acceptance) {
  if (!acceptance) return null;
  return `## CASE MATRIX\nEvery bullet below is a required test case, copied from the phase file's \`## Acceptance\` section. The labels map to the case-matrix floor (success / rejection / realistic / boundary). A missing case is a defect, not restraint.\n\n${acceptance}`;
}

function renderHardConstraints(agent) {
  const all = [...SHARED_CONSTRAINTS, ...AGENT_CONSTRAINTS[agent]];
  return `## HARD CONSTRAINTS\n${bulletList(all)}`;
}

function tasksField(tasksContent, label) {
  if (!tasksContent) return null;
  const m = tasksContent.match(new RegExp(`^-\\s*${label}:\\s*(.+?)\\s*$`, 'm'));
  if (!m) return null;
  const value = m[1].trim();
  return value.startsWith('(') ? null : value;
}

function worktreePath(tasksContent, serviceId) {
  if (!tasksContent) return null;
  const body = sectionBody(tasksContent, /^##\s+Worktrees\b/, /^##\s/);
  if (!body) return null;
  for (const line of body.split('\n')) {
    const m = line.match(/^-\s*([A-Za-z0-9._-]+):\s*(.+?)\s*$/);
    if (m && m[1] === serviceId) return m[2].replace(/\s*\([^)]*\)\s*$/, '').trim();
  }
  return null;
}

const args = parseArgs(process.argv);

const agent = args.agent;
if (!agent || agent === true) die('--agent required (one of: ' + AGENT_TYPES.join(', ') + ')');
if (!AGENT_TYPES.includes(agent)) {
  die(`unknown --agent: ${agent} (expected one of: ${AGENT_TYPES.join(', ')})`);
}

const taskDirArg = args['task-dir'];
if (!taskDirArg || taskDirArg === true) die('--task-dir required');
const taskDir = resolve(taskDirArg);
if (!existsSync(taskDir) || !statSync(taskDir).isDirectory()) {
  die(`task dir not found or not a directory: ${taskDir}`);
}

const serviceId = args.service;
if (!serviceId || serviceId === true) die('--service required');
const serviceDir = join(taskDir, 'services', serviceId);
if (!existsSync(serviceDir) || !statSync(serviceDir).isDirectory()) {
  die(`service '${serviceId}' not found under ${join(taskDir, 'services')}`);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(args['plugin-root'] && args['plugin-root'] !== true
  ? args['plugin-root']
  : join(scriptDir, '..'));

const phaseFileArg = args['phase-file'];
if (agent === 'tdd-cycle' && (!phaseFileArg || phaseFileArg === true)) {
  die('--phase-file required for --agent=tdd-cycle');
}
let phaseFilePath = null;
if (phaseFileArg && phaseFileArg !== true && PHASE_AWARE_AGENTS.has(agent)) {
  phaseFilePath = resolve(phaseFileArg);
  if (!existsSync(phaseFilePath) || !statSync(phaseFilePath).isFile()) {
    die(`phase file not found: ${phaseFilePath}`);
  }
}

const notesFileArg = args['notes-file'];
let notesBody = null;
if (notesFileArg && notesFileArg !== true) {
  const notesPath = resolve(notesFileArg);
  if (!existsSync(notesPath) || !statSync(notesPath).isFile()) {
    die(`notes file not found: ${notesPath}`);
  }
  const raw = readFileSync(notesPath, 'utf8').trim();
  notesBody = raw === '' ? null : raw;
}

const tasksPath = join(taskDir, 'TASKS.md');
const tasksContent = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8') : null;
const slugMatch = tasksContent ? tasksContent.match(/^#\s+Task:\s*(.+?)\s*$/m) : null;
const taskSlug = slugMatch ? slugMatch[1].trim() : basename(taskDir);

const phasesDir = join(serviceDir, 'phases');

const phase = phaseFilePath ? readPhaseFile(phaseFilePath) : null;
const preceding = phase
  ? precedingPhaseFiles(phasesDir, basename(phaseFilePath)).map(readPhaseFile)
  : [];

const ctx = {
  pluginRoot,
  subagentBaseline: join(pluginRoot, 'jelou', 'references', 'subagent-base.md'),
  taskDir,
  taskSlug,
  serviceId,
  serviceSourcePath: worktreePath(tasksContent, serviceId),
  taskBranch: tasksField(tasksContent, 'Primary branch'),
  specPath: existsSync(join(taskDir, 'SPEC.md')) ? join(taskDir, 'SPEC.md') : null,
  proposalPath: existsSync(join(taskDir, 'PROPOSAL.md')) ? join(taskDir, 'PROPOSAL.md') : null,
  taskContextPath: existsSync(join(serviceDir, 'context.md')) ? join(serviceDir, 'context.md') : null,
  phaseFilePath,
  phaseId: phase ? phase.id : null,
  phaseTitleText: phase ? phase.title : null,
  testTier: TEST_TIER_BY_AGENT[agent] || null,
  reportDir: phase ? join(phasesDir, `${phase.id}-reports`) : join(phasesDir, 'final-reports'),
};

const headline = phase
  ? `# DISPATCH: ${agent} — ${serviceId} — phase ${phase.id}`
  : `# DISPATCH: ${agent} — ${serviceId}`;

const sections = [headline, renderContext(ctx)];

if (phase) {
  sections.push(`## PHASE ${phase.id} REQUIREMENTS (immutable)\n${phase.requirements || 'The phase file declares no requirements section — read PHASE_FILE before acting.'}`);
  sections.push(renderExistingFoundation(serviceId, preceding));
  const caseMatrix = renderCaseMatrix(phase.acceptance);
  if (caseMatrix) sections.push(caseMatrix);
}

sections.push(renderHardConstraints(agent));
sections.push(`## PROCEDURE\n${bulletList(PROCEDURES[agent])}`);
sections.push(`## RETURN\n${RETURNS[agent].join('\n\n')}`);
if (notesBody) sections.push(`## ORCHESTRATOR NOTES\n${notesBody}`);

process.stdout.write(`${sections.join('\n\n')}\n`);

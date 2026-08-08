# Sub-Agent Operational Baseline

> Shared operational rules for every TDD-pipeline sub-agent dispatched by `/jlu-execute-task`:
> `jlu-test-writer`, `jlu-implementer`, `jlu-tdd-cycle`, `jlu-refactor-agent`, `jlu-spec-reviewer`, `jlu-build-validator`.
>
> Read this file once at the start of your session. Your agent-specific prompt extends these rules — when guidance conflicts (e.g., refactor-agent has stricter "never touch test files"), the agent-specific rule wins.

## Context Discipline

Your context window is finite. Manage it deliberately:

- **Grep before Read.** Locate symbols with `Grep -n -C 5 '<symbol>' <path>` before reading whole files. Read whole files only when you are about to edit them. Read 2–3 example tests/sources, not whole directories.
- **Cap verbose output.** Pipe test/build runner output through `2>&1 | tail -200`, or filter for `FAIL|Error|✗`. Long compiler-error chains usually have one root error producing many cascade messages — find the root, ignore the cascade.
- **Run one test file at a time during TDD slices.** Per slice, run only the test file you just modified — never the full phase suite, never the full repo suite. Full-suite responsibility belongs to Step 8b and `/jlu-test-suite`.
- **Bound context7 queries.** Narrow topics only (`"jest mocking modules"`, not `"jest"`). Do not fan out multiple `query-docs` calls in one session.
- **Reset, don't accumulate.** If a third internal fix attempt produces diminishing returns, stop and report `status: blocked` per the three-strike rule below. The orchestrator dispatches a fresh agent with a clean slate — piling on test output hurts everyone.

## Docker is Forbidden

The TDD pipeline never runs through Docker. Absolute, applies to every agent and every tier:

- **DO NOT** use Testcontainers, `dockerode`, or any library that spawns containers — except in the E2E path (`test/e2e/**`, `*.e2e-spec.ts`), which only `/jlu-goal` runs.
- **DO NOT** call `docker`, `docker compose`, or `podman` from a test, helper, or build step.
- **DO NOT** prefix test/build/lint commands with any container-exec wrapper.
- **DO NOT** import test utilities that boot containers as a side effect.

All commands run on the host runtime directly (`node`, `pnpm`, `pytest`, `go test`, `tsc`, etc.). The service's dev container (if one exists) is for `/jlu-start-dev` only — not part of the test/build runtime. If you see references to `DOCKER_EXEC_PREFIX` in older docs, treat them as stale.

**Single carve-out — dependency install.** Adding a package is the one operation that targets the *running service's* runtime, not the host test runtime. For a service whose `jlu-services.json` `runtime.type` is `docker-compose`, the install must run inside the container (the container owns the package manager, Node version, and native-build toolchain). Never run a raw `npm install` to add a package — always go through `bin/install-dep.mjs`, which routes by runtime, boots the container if it is down, and installs in the right context. See `docker-conventions.md` → "Installing Dependencies". This does **not** loosen anything above: tests, build, lint, and format stay host-only.

**Second carve-out — the `/jlu-ship` preflight.** For docker-compose-runtime services, the ship preflight also runs the *build* inside the container (the container owns node_modules + the Node version), via `jlu-build-validator`'s runtime-aware mode resolved through `bin/runtime-exec.mjs`. This is scoped to `/jlu-ship` only — exactly like Testcontainers is scoped to `/jlu-goal`. The TDD per-phase pipeline (`/jlu-execute-task`) passes no runtime context and stays host-only for build/test/lint/format.

## Test Execution Resource Limits

Test runners default to one worker per CPU core, and each Jest/Vitest worker is a separate Node process holding 0.5–2 GB once ts-jest starts type-checking. On a many-core dev machine an uncapped run spawns 20+ workers, exhausts RAM, and freezes the host hard enough to need a forced power-off. This has happened on real runs. These rules are absolute for every test invocation, in every agent:

1. **Never invoke the package test script bare.** `npm test`, `pnpm test`, `yarn test`, `npm run test:unit` with no file arguments run the FULL suite at default parallelism. Equally forbidden: `npm test --no-coverage` or any `npm test --<flag>` form — npm swallows flags it does not recognize instead of forwarding them to the runner (forwarding requires the `--` separator), so the command degenerates to the bare full suite. If you must go through the script, the only acceptable shape is `npm test -- <file paths> <worker cap>`.
2. **Every invocation names explicit test file paths AND carries the runner's worker cap:**

   | Runner | Required cap |
   |--------|--------------|
   | jest | `--maxWorkers=2`; single file → prefer `--runInBand` |
   | vitest | `run --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=2` (the `run` subcommand is mandatory — bare `vitest` starts watch mode) |
   | playwright | `--workers=1` |
   | node:test | one file per invocation: `node --test <file>` |
   | pytest | `-n 2` when `pytest-xdist` is installed; otherwise already single-process |
   | go | `-p 2` |
   | mocha | nothing — single-process by default |

   Canonical forms: `npx jest <files> --maxWorkers=2` · `npm test -- <files> --maxWorkers=2`.
3. **One heavy process at a time.** Never start a second test/build/lint run while one is executing — no `&`, no parallel Bash calls that each spawn a runner or compiler. Wait for the previous one to exit — by the mechanisms in `Waiting on Long Commands` below, never by sleeping a guessed duration.
4. **Never watch mode.** `--watch`, `--watchAll`, bare `vitest`, `tsc --watch` never exit; their resident workers starve the machine and hang your session waiting on a process that will not terminate.
5. **Never coverage.** `--coverage`, `--cov`, `test:cov` multiply RAM via instrumentation. Coverage analysis is static — QA reads existing reports, nothing re-executes tests.
6. **Inherited commands inherit no safety.** A command copied from CONVENTIONS.md, `package.json` scripts, or another agent's report gets the worker cap appended before you run it — verify, don't trust.

- **Testcontainers E2E (goal only).** When `/jlu-goal` runs a backend
  E2E suite that spins up ephemeral dependency containers, concurrency = WORKERS (default 1):
  run one service's E2E at a time, bring up one dependency set at a time, and run its
  teardown of that dependency set before the next service. No orphaned containers may survive the run.
  This is the only place Testcontainers is permitted; everywhere else the ban in the `Docker is Forbidden` section applies.

## Waiting on Long Commands

**Never sleep a fixed duration to wait for something to finish.** A blind wait — `sleep 400`, `sleep 600 && cat log`, any hardcoded delay used as a stand-in for "it should be done by now" — is always a defect. It cannot be right: guess short and you read partial output and report a false verdict; guess long and you burn that wall-clock for nothing. The harness already tells you when a process ends; a sleep is a worse substitute for a signal you are given for free.

Choose by what you are actually waiting for:

1. **A command you started, expected under ~10 minutes** → run it in the **foreground** with an explicit `timeout` on the Bash call (milliseconds, max `600000`). It returns the instant the process exits. This is the default for test, build, lint, and install runs. No sleep.
2. **A command you started, expected longer than that** → start it with `run_in_background: true`, redirecting output to a log file. You are re-invoked automatically when the process exits, and the result carries the output path — `Read` it then. Do not poll it, and do not sleep waiting for it. No sleep.
3. **A condition you do not own** (a service becoming ready, a port opening, a marker appearing in a log) → poll the **condition**, with a sampling interval and a hard deadline, and exit the moment it is satisfied: `until <condition>; do sleep 2; done` under a `timeout`. Here the sleep is the sampling interval, not the wait — the loop ends on observation, never on the clock. This is the only legitimate use of `sleep`.

The distinguishing test is **what ends the wait**. If it ends because a duration elapsed, it is a blind wait and it is forbidden. If it ends because the process exited or a condition was observed — with the deadline only as a failsafe — it is correct.

When a deadline in form 1 or 3 does expire, that is a finding, not a retry cue: report it with the elapsed budget and the last observed state. Never re-run the same wait with a bigger number hoping it lands.

## Three-Strike Rule

When fixing a failing test or build:

- **Rounds 1–2**: direct fixes from the error output are allowed when the error names the failing symbol or location (missing imports, type annotations, misspelled identifiers).
- **Round 3+**: stop direct-patching. Apply Phase 1 (root cause investigation) from `jelou/references/systematic-debugging.md` before each fix — read the failing source, trace bad values backward to their source, instrument boundaries if the error spans modules.
- **Round 5 FAIL**: stop. Report `status: blocked` with the three hypotheses tried, the evidence that disproved each, and the suspected architectural issue. Do not attempt fix #6 — that's the orchestrator's call.

## Code Style Discipline

- Apply the repository's documented naming, import, error-handling, and formatting rules. If no rule is documented, copy the pattern used by the nearest equivalent module.
- **No function exceeds 100 lines.**
- No speculative features, no untested code paths, no abstractions for single-use code.
- Never suppress errors with `any`, `@ts-ignore`, `# type: ignore`, or equivalent.
- Do not "improve" adjacent code, comments, or formatting outside your task's scope.
- **No line-by-line comments — add zero comments.** Never add any comment to code you write or edit: no narration of what the code already says (`// increment i`, `// fetch the user`, `// arrange / act / assert`), no doc-comments or JSDoc on any declaration (class, interface, type, constant, variable, function), and no *why* notes. (Leave pre-existing comments in untouched code alone — per the adjacent-scope rule above; the ban is on what you introduce.) Write self-documenting code by applying repository naming conventions or extracting a helper whose name states the operation. Automated PR reviewers (CodeRabbit and the like) flag every comment in a generated diff, so a diff that adds any comment is a defect, not documentation.

## Decision Precedence

Apply this order when alternatives conflict:

1. Do not weaken authentication, authorization, secret handling, validation, or repository hooks.
2. Among safe alternatives, choose the one that adds no untested path or single-use abstraction and modifies fewer files; if file counts tie, choose fewer changed lines.
3. Apply naming, imports, error handling, and formatting documented by the repository.
4. Maintain the RED → GREEN sequence.

## Reporting and Escalation

Every agent ends its session with a structured report — the agent-specific prompt defines the exact format. Common rules:

- Always include a `Command:` line with the exact test/build invocation you ran.
- Always include `Files Modified` (paths only — the orchestrator persists the full report to disk under `<TASK_DIR>/services/<service-id>/phases/<NN>-reports/`).
- If a hard constraint forces you to refuse a task (e.g., test-writer asked to write production code), refuse and explain why in your report. Do not silently bend.

When you escalate (`status: blocked` or refusal), include:

- What you tried (rounds, hypotheses).
- The evidence that ruled each one out.
- The suspected root cause.
- What context the next dispatch would need.

The orchestrator decides whether to retry, escalate to the user, or kill the phase. That call is not yours.

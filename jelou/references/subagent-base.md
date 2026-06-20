# Sub-Agent Operational Baseline

> Shared operational rules for every TDD-pipeline sub-agent dispatched by `/jlu-execute-task`:
> `jlu-test-writer`, `jlu-implementer`, `jlu-tdd-cycle`, `jlu-refactor-agent`, `jlu-qa-agent`, `jlu-build-validator`.
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

- **DO NOT** use Testcontainers, `dockerode`, or any library that spawns containers.
- **DO NOT** call `docker`, `docker compose`, or `podman` from a test, helper, or build step.
- **DO NOT** prefix test/build/lint commands with any container-exec wrapper.
- **DO NOT** import test utilities that boot containers as a side effect.

All commands run on the host runtime directly (`node`, `pnpm`, `pytest`, `go test`, `tsc`, etc.). The service's dev container (if one exists) is for `/jlu-start-dev` only — not part of the test/build runtime. If you see references to `DOCKER_EXEC_PREFIX` in older docs, treat them as stale.

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
3. **One heavy process at a time.** Never start a second test/build/lint run while one is executing — no `&`, no parallel Bash calls that each spawn a runner or compiler. Wait for the previous one to exit.
4. **Never watch mode.** `--watch`, `--watchAll`, bare `vitest`, `tsc --watch` never exit; their resident workers starve the machine and hang your session waiting on a process that will not terminate.
5. **Never coverage.** `--coverage`, `--cov`, `test:cov` multiply RAM via instrumentation. Coverage analysis is static — QA reads existing reports, nothing re-executes tests.
6. **Inherited commands inherit no safety.** A command copied from CONVENTIONS.md, `package.json` scripts, or another agent's report gets the worker cap appended before you run it — verify, don't trust.

- **Testcontainers E2E (production-like only).** When `/jlu-production-like` runs a backend
  E2E suite that spins up ephemeral dependency containers, concurrency = WORKERS (default 1):
  run one service's E2E at a time, bring up one dependency set at a time, and run its
  teardown of that dependency set before the next service. No orphaned containers may survive the run.
  This is the only place Testcontainers is permitted; everywhere else the ban below applies.

## Three-Strike Rule

When fixing a failing test or build:

- **Rounds 1–2**: direct fixes from the error output are OK (missing imports, type annotations, obvious typos).
- **Round 3+**: stop direct-patching. Apply Phase 1 (root cause investigation) from `jelou/references/systematic-debugging.md` before each fix — read the failing source, trace bad values backward to their source, instrument boundaries if the error spans modules.
- **Round 5 FAIL**: stop. Report `status: blocked` with the three hypotheses tried, the evidence that disproved each, and the suspected architectural issue. Do not attempt fix #6 — that's the orchestrator's call.

## Code Style Discipline

- Match the existing codebase exactly — naming, imports, error handling, formatting. Your diff should be invisible in a style review.
- **No function exceeds 100 lines.**
- No speculative features, no untested code paths, no abstractions for single-use code.
- Never suppress errors with `any`, `@ts-ignore`, `# type: ignore`, or equivalent.
- Do not "improve" adjacent code, comments, or formatting outside your task's scope.
- **No line-by-line comments.** Never add comments that narrate what the code already says (`// increment i`, `// fetch the user`, `// arrange / act / assert`). Write self-documenting code — prefer a clear name over a comment. The only comments allowed explain non-obvious *why* (a workaround, a business rule, a warning), never the *what*. Match the existing comment density of the file you edit; if it has none, add none. A diff full of explanatory inline comments is a defect, not documentation.

## Engineering Principles Precedence

When two principles conflict, the higher item wins:

1. **Security** — never weaken auth, never leak secrets, never disable hooks (`--no-verify`).
2. **Simplicity** — fewer moving parts beat clever abstractions.
3. **Readability** — code is read more than written.
4. **TDD** — tests before code, behavior before implementation.
5. **Repo conventions** — match what's already there.

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

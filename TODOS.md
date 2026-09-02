# TODOS

## Enforce a context budget on agent source exploration

- **Priority:** P0
- **What:** Restore a measurable ceiling on how much context a phase dispatch pulls in, now that the generated codebase docs are gone. Two parts: (1) instrument per-phase token spend so the cap is set from data, not a guess; (2) emit a numeric `explore_budget` from `bin/task-setup.mjs` and render it as an explicit limit in the dispatch prompt (`bin/build-dispatch-prompt.mjs`), replacing the qualitative "read 2-3 example tests" guidance in `jelou/references/subagent-base.md` -> Context Discipline.
- **Why:** The doc-cache removal (v0.3.364) deleted the pipeline's ONLY enforced context bound. `bin/task-setup.mjs` used to cap the injected payload at 32000 chars (~8k tokens) and degrade to paths past the cap, so the per-phase increment was provably bounded. The replacement is prose only: nothing measures, caps, or warns. Three independent review specialists (confidence 8/7/7) flagged that net context per dispatch may have gone UP, and with no telemetry the only signal would be the bill.
- **Pros:** Restores a real ceiling; makes the cost of the doc removal observable instead of assumed; the sharpest case (`jlu-proposal-agent` grepping cross-service callers with no result limit) gets a bound.
- **Cons:** New machinery on a subsystem whose last change was a deletion; the number is meaningless until the instrumentation exists, so part (1) genuinely blocks part (2).
- **Context:** Old bound lived in `buildDocsPayload` / `--docs-budget` in `bin/task-setup.mjs` (see the v0.3.364 diff for the exact shape). Worst offenders to measure first: `agents/jlu-proposal-agent.md` Pass 1 (cross-service dependency mapping, unbounded grep over every affected service), then `agents/jlu-tdd-cycle.md` (re-derives framework/naming/structure on every phase with no cross-phase dedup — the old path derived it once per task).
- **Depends on / blocked by:** per-phase token instrumentation must land first; the cap is set from its numbers.

## Restore formatting for non-Node services

- **Priority:** P1
- **What:** Teach `bin/format-changed-files.sh` to detect a formatter from the manifest: `pyproject.toml` with `[tool.ruff]`/`[tool.black]` -> `ruff format` / `black`; `go.mod` -> `gofmt -w`; `Cargo.toml` -> `rustfmt`. Gate each on `command -v` and add dry-run fixtures to `tests/unit/format-changed-files.test.mjs`.
- **Why:** v0.3.364 deleted the CONVENTIONS.md detection branch, whose awk accepted `black|ruff|gofmt|rustfmt`. That was the ONLY path by which a Python, Go or Rust service ever got formatted. The surviving chain is package.json-only, so those services now hit `status=skip reason=no_command_detected` at every phase close -- silently, because the skip path is deliberately quiet.
- **Pros:** Restores the capability from the manifest instead of a hand-written doc, which is strictly better than what it replaced; mirrors the introspection v0.3.364 already added to test-suite.md Step 4.
- **Cons:** Each formatter needs its own `command -v` guard and fixture; no non-Node service in this workspace exercises it today, so the first real test is a live run.
- **Context:** Mirror the detection ladder in `jelou/workflows/test-suite.md` Step 4, which got this treatment in the same release. The file header comment already (wrongly) describes the gap as intended: "a Python/Go service with no package.json".
- **Depends on / blocked by:** nothing.

## Prune stale bin/ scripts on installer upgrade

- **Priority:** P1
- **What:** Add a prune loop to `bin/install-codex.sh` and `bin/install-opencode.sh` that walks the destination bin directory and removes anything absent from `$PLUGIN_DIR/bin/`, mirroring the existing skill (line ~56) and agent (line ~61) prune steps. Better: drive the bin copy from one shared manifest that both installers and `tests/unit/installer-manifest.test.mjs` read.
- **Why:** Both installers prune stale skills and agents but populate bin via an explicit `cp` list with no prune. On `/jlu-update` from v0.3.363, the deleted `bin/extract-doc-sections.mjs` survives in the user's install indefinitely -- executable and importable -- even though the repo deleted it. `cp -R "$PLUGIN_DIR/jelou/."` is additive the same way, so every future workflow deletion will linger too.
- **Pros:** Closes a whole class of deletion drift, not just this one file; makes the installed state match the repo.
- **Cons:** Installer logic is the riskiest code in the repo to get wrong, and a prune loop that misfires deletes a working install.
- **Context:** `tests/unit/installer-manifest.test.mjs` only checks the source tree and the installer text, never the installed state, so CI cannot currently see this class of drift. Any fix should add a test that installs to a temp dir twice across a simulated deletion.
- **Depends on / blocked by:** nothing.

## Retire the pre-0.3.364 service-docs.md cache on in-flight tasks

- **Priority:** P1
- **What:** Extend the no-read guard in `jelou/workflows/load-context.md` and `jelou/workflows-opencode/load-context.md` to also exclude `services/<service-id>/service-docs.md`, and have `bin/task-setup.mjs` unlink a stale `service-docs.md` when it finds one.
- **Why:** v0.3.364's guard is scoped to `<workspace>/services/<id>/codebase/`. A task started before that release has the old doc cache at `<TASK_DIR>/services/<id>/service-docs.md` -- a verbatim copy of CONVENTIONS.md plus two STRUCTURE.md sections -- which is inside the task dir, outside the guarded prefix. load-context Step 5 globs all task artifacts and lists them for on-demand reading, so resuming a mid-flight task re-injects exactly the content the release removed.
- **Pros:** Makes the removal hold for tasks that predate it, which is the only population where it currently leaks.
- **Cons:** Deleting an artifact the user may still want to read; an exclusion in the workflow prose may be enough without the unlink.
- **Context:** Nothing in v0.3.364 deletes, ignores, or migrates existing `service-docs.md` files. Found by red-team review of the v0.3.364 diff.
- **Depends on / blocked by:** nothing.

## Validate the Mode: trivial phase override

- **Priority:** P1
- **What:** Give `**Mode: trivial**` the same validation treatment `**Mode: docs**` already has in `bin/classify-phase.sh` (which checks requirements against `CODE_CHANGE_VERBS` and emits `docs_override_rejected`). Also tighten the frontmatter `elif` at line ~83: it treats ANY `---` in the file as a frontmatter fence, so a `mode:` line after any horizontal rule is honored.
- **Why:** v0.3.364 fixed a BSD-sed bug that had made the Mode override extraction a no-op on macOS. Side effect: `**Mode: docs**` and `**Mode: trivial**` in phase files were dead strings on every Mac and are now live. `trivial` relaxes the triviality gate from <=20 LOC/<=3 files to <=50 lines and skips the Step 8a.3 refactor pass -- and unlike `docs` it has NO validation at all. Phase files are authored by the proposal agent from SPEC text, which can originate in repo or issue content.
- **Pros:** Closes an unvalidated quality-gate bypass that just became reachable on half the developer machines.
- **Cons:** Tightening a gate that has been live on Linux CI all along may fail phase files that currently pass there.
- **Context:** Found by adversarial review of v0.3.364 (finding F7), which confirmed the mechanism empirically: BSD grep -E accepts `\s`, BSD sed -E does not, so pre-fix OVERRIDE was the literal string `**Mode: trivial**` and matched no branch.
- **Depends on / blocked by:** nothing.

## Migrate the prose shared-reuse boots (goal/start-dev) onto the codified executor

- **Priority:** P2
- **What:** Replace the prose shared-reuse boot steps in `env-lifecycle.md` (consumed by goal/start-dev) with calls into `bin/lib/boot-engine/execute-shared-reuse.mjs`, leaving ONE deterministic executor for all three consumers.
- **Why:** Boot-certification leaves two implementations of the same contract (prose + module); they will drift over time (outside-voice finding, eng review 2026-07-22). A single executor eliminates the "agent improvised the boot" bug class.
- **Pros:** Deterministic, testable boots in goal/start-dev; closes the boot-consolidation roadmap; boot fixes land once.
- **Cons:** Rewrites the plugin's most sensitive live-validated boot path; regression risk in reuse-or-reboot/frontend-fresh; large diff deserving its own spec-review cycle.
- **Context:** The executor was born in the boot-certification feature with mechanics-parity tests against `env-lifecycle.md` — those tests are the bridge that prevents drift until this migration. Note the executor's verify mode replaces the reuse-or-reboot decision with probe-and-leave; the migration must add the real reuse/reboot branch (frontend fresh, env-stale) as a separate mode. Start with goal 8b/boot loop, then start-dev.
- **Depends on / blocked by:** boot-certification merged + live acceptance green (batch run in jelou-projects).

## Post-batch environment provisioning assistant

- **Priority:** P3
- **What:** An optional step after the certification batch that reads the `derived-unverified` causes from the report table (missing `.env`, deps, image) and proposes/executes the obvious fixes (copy `.env.example`, install deps with the detected package manager, build the image) before re-verifying.
- **Why:** The first batch run in jelou-projects will leave several services unmarked due to missing environment; today the remedy is manual per service.
- **Pros:** Turns WARNs into certified services with no manual work; reuses the verifier's structural preflight (which already classifies the exact cause).
- **Cons:** Executes more repo code automatically (installs); may hide environment problems worth seeing; speculative until the first batch produces data.
- **Context:** The migration batch run produces a per-cause count in the B8 certification table — that count decides whether this is worth building. The preflight already emits structured causes; the assistant would be a consumer of that table. Start with the most frequent causes.
- **Depends on / blocked by:** real data from the first migration batch (cause counts by type).

## Approach C: worktrees por fase (paralelismo intra-servicio)

- **Priority:** P3
- **What:** Worktree git por fase para despachar fases del mismo servicio en paralelo: merge al cierre de ola vía `jlu-conflict-resolver`, rework de Step 7j/`finalize-phase.sh` para commits post-merge y re-verificación Green.
- **Why:** Única forma segura de paralelizar el caso mono-servicio (premisa P4 del design doc del lote de velocidad): dos agentes sobre el mismo checkout es el modo de falla documentado por la industria. El invariante del chunker (≤1 fase por servicio por chunk, lote 1) es prerequisito ya cumplido — Approach C solo lo relaja para fases con worktree propio.
- **Pros:** Techo de velocidad real para el caso común (tareas mono-servicio); alineado con el consenso de worktree-isolation.
- **Cons:** XL (~3 semanas humano / 5-6 tareas CC); rediseña el camino de commits y la verificación Green; overhead de merge puede comerse la ganancia en fases cortas.
- **Context:** Diseño completo en `~/.gstack/projects/cristian-pisco-jelou-spec-plugin/cristianp-main-design-20260807-232622.md` (Approach C + Open Question 1). Criterio de activación medible: tras 2+ semanas de métricas P7 con el lote 1 activo, el camino crítico intra-servicio representa >50% del wall-clock de las tareas medidas. Sin ese umbral, no se construye.
- **Depends on / blocked by:** lote 1 de velocidad mergeado + métricas P7 acumuladas.

## Completed

### Full installer whitelist audit (Codex/OpenCode)

- **Completed:** v0.3.331 (2026-08-03)
- Closed by the plugin-root/installer reachability sweep. `tests/unit/installer-manifest.test.mjs` now enforces the end state this item described: every `bin/*.mjs|sh` referenced by `jelou/`, `agents/` or `skills/` must be copied by BOTH installers or be declared in `DELIBERATELY_UNSHIPPED` with a written justification, and a second test asserts every declared exclusion is still referenced and still absent.

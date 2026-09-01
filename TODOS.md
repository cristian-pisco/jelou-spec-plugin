# TODOS

## Enforce a context budget on agent source exploration

- **Priority:** P0
- **What:** Restore a measurable ceiling on how much context a phase dispatch pulls in, now that the generated codebase docs are gone. Two parts: (1) instrument per-phase token spend so the cap is set from data, not a guess; (2) emit a numeric `explore_budget` from `bin/task-setup.mjs` and render it as an explicit limit in the dispatch prompt (`bin/build-dispatch-prompt.mjs`), replacing the qualitative "read 2-3 example tests" guidance in `jelou/references/subagent-base.md` -> Context Discipline.
- **Why:** The doc-cache removal (v0.3.364) deleted the pipeline's ONLY enforced context bound. `bin/task-setup.mjs` used to cap the injected payload at 32000 chars (~8k tokens) and degrade to paths past the cap, so the per-phase increment was provably bounded. The replacement is prose only: nothing measures, caps, or warns. Three independent review specialists (confidence 8/7/7) flagged that net context per dispatch may have gone UP, and with no telemetry the only signal would be the bill.
- **Pros:** Restores a real ceiling; makes the cost of the doc removal observable instead of assumed; the sharpest case (`jlu-proposal-agent` grepping cross-service callers with no result limit) gets a bound.
- **Cons:** New machinery on a subsystem whose last change was a deletion; the number is meaningless until the instrumentation exists, so part (1) genuinely blocks part (2).
- **Context:** Old bound lived in `buildDocsPayload` / `--docs-budget` in `bin/task-setup.mjs` (see the v0.3.364 diff for the exact shape). Worst offenders to measure first: `agents/jlu-proposal-agent.md` Pass 1 (cross-service dependency mapping, unbounded grep over every affected service), then `agents/jlu-tdd-cycle.md` (re-derives framework/naming/structure on every phase with no cross-phase dedup — the old path derived it once per task).
- **Depends on / blocked by:** per-phase token instrumentation must land first; the cap is set from its numbers.

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

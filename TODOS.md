# TODOS

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

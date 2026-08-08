# TODOS

## Migrate the prose shared-reuse boots (goal/ui-qa) onto the codified executor

- **Priority:** P2
- **What:** Replace the prose shared-reuse boot steps in `env-lifecycle.md` (consumed by goal/ui-qa/start-dev) with calls into `bin/lib/boot-engine/execute-shared-reuse.mjs`, leaving ONE deterministic executor for all three consumers.
- **Why:** Boot-certification leaves two implementations of the same contract (prose + module); they will drift over time (outside-voice finding, eng review 2026-07-22). A single executor eliminates the "agent improvised the boot" bug class.
- **Pros:** Deterministic, testable boots in goal/ui-qa; closes the boot-consolidation roadmap; boot fixes land once.
- **Cons:** Rewrites the plugin's most sensitive live-validated boot path; regression risk in reuse-or-reboot/frontend-fresh; large diff deserving its own spec-review cycle.
- **Context:** The executor was born in the boot-certification feature with mechanics-parity tests against `env-lifecycle.md` — those tests are the bridge that prevents drift until this migration. Note the executor's verify mode replaces the reuse-or-reboot decision with probe-and-leave; the migration must add the real reuse/reboot branch (frontend fresh, env-stale) as a separate mode. Start with goal 8b/boot loop, then ui-qa-run.
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

## Dedup de las dos pasadas de spec-reviewer (8c + ship)

- **Priority:** P3
- **What:** Tras la fusión del lote de velocidad, `jlu-spec-reviewer` corre dos veces por tarea: Step 8c de execute-task (`MODE: final-qa`) y Step 6 de ship (`MODE: compliance`). Evaluar consolidarlas en una.
- **Why:** Dos pasadas estáticas finales sobre código muy solapado son costo redundante si los datos muestran que el compliance de ship no encuentra nada que el 8c no encontró ya.
- **Pros:** Un dispatch menos por tarea; simplifica ship; cierra el arco de P9 (un solo verificador) con evidencia.
- **Cons:** Ship corre en otro contexto (post-cherry-pick, por servicio) — la equivalencia no es obvia; tocar ship sin datos sería especulación.
- **Context:** Nota post-fusión en Tarea 2 item 9 del design doc del lote de velocidad. Criterio medible desde los reports: si en 2-3 tareas reales los findings de la pasada de ship son subconjunto de los de 8c, la pasada de ship se elimina o se reduce a un check de cherry-pick.
- **Depends on / blocked by:** lote 1 completo (Tareas 1 y 2) mergeado + 2-3 tareas reales con ambas pasadas registradas.

## Completed

### Full installer whitelist audit (Codex/OpenCode)

- **Completed:** v0.3.331 (2026-08-03)
- Closed by the plugin-root/installer reachability sweep. `tests/unit/installer-manifest.test.mjs` now enforces the end state this item described: every `bin/*.mjs|sh` referenced by `jelou/`, `agents/` or `skills/` must be copied by BOTH installers or be declared in `DELIBERATELY_UNSHIPPED` with a written justification, and a second test asserts every declared exclusion is still referenced and still absent.

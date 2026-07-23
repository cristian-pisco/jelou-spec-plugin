# TODOS

## Full installer whitelist audit (Codex/OpenCode)

- **What:** Reconcile the ~50 `bin/*.mjs|sh` files referenced by `jelou/workflows/` + `agents/` against the ~10 the installers copy, deciding per binary: ship it, or declare the step non-portable in the runtime contract.
- **Why:** On Codex/OpenCode, `<plugin-root>` resolves to `$CODEX_HOME`, whose `bin/` contains only the whitelist — any workflow invoking an unlisted bin fails with file-not-found on those runtimes (found during boot-certification; `derive-dev-block.mjs` had been referenced by goal 8b for weeks without ever being shipped).
- **Pros:** Closes an entire class of silent tri-runtime breakage; the boot-certification import-graph test already provides the enforcement mechanics.
- **Cons:** Large sweep (~45 binaries, some with deep import chains: trace-*, daily-slack-*, e2e-*); some steps may belong in a Claude-Code-only allowlist instead of being shipped.
- **Context:** `tests/unit/installer-manifest.test.mjs` validates the shipped manifest plus import-graph closure; extending it to "every workflow-referenced bin is in the manifest or in a declared non-portable allowlist" is the end state. Start by inventorying which workflows actually run from Codex/OpenCode.
- **Depends on / blocked by:** boot-certification merged (provides the base test).

## Migrate the prose shared-reuse boots (goal/ui-qa) onto the codified executor

- **What:** Replace the prose shared-reuse boot steps in `env-lifecycle.md` (consumed by goal/ui-qa/start-dev) with calls into `bin/lib/boot-engine/execute-shared-reuse.mjs`, leaving ONE deterministic executor for all three consumers.
- **Why:** Boot-certification leaves two implementations of the same contract (prose + module); they will drift over time (outside-voice finding, eng review 2026-07-22). A single executor eliminates the "agent improvised the boot" bug class.
- **Pros:** Deterministic, testable boots in goal/ui-qa; closes the boot-consolidation roadmap; boot fixes land once.
- **Cons:** Rewrites the plugin's most sensitive live-validated boot path; regression risk in reuse-or-reboot/frontend-fresh; large diff deserving its own spec-review cycle.
- **Context:** The executor was born in the boot-certification feature with mechanics-parity tests against `env-lifecycle.md` — those tests are the bridge that prevents drift until this migration. Note the executor's verify mode replaces the reuse-or-reboot decision with probe-and-leave; the migration must add the real reuse/reboot branch (frontend fresh, env-stale) as a separate mode. Start with goal 8b/boot loop, then ui-qa-run.
- **Depends on / blocked by:** boot-certification merged + live acceptance green (batch run in jelou-projects).

## Post-batch environment provisioning assistant

- **What:** An optional step after the certification batch that reads the `derived-unverified` causes from the report table (missing `.env`, deps, image) and proposes/executes the obvious fixes (copy `.env.example`, install deps with the detected package manager, build the image) before re-verifying.
- **Why:** The first batch run in jelou-projects will leave several services unmarked due to missing environment; today the remedy is manual per service.
- **Pros:** Turns WARNs into certified services with no manual work; reuses the verifier's structural preflight (which already classifies the exact cause).
- **Cons:** Executes more repo code automatically (installs); may hide environment problems worth seeing; speculative until the first batch produces data.
- **Context:** The migration batch run produces a per-cause count in the B8 certification table — that count decides whether this is worth building. The preflight already emits structured causes; the assistant would be a consumer of that table. Start with the most frequent causes.
- **Depends on / blocked by:** real data from the first migration batch (cause counts by type).

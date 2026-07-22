# Risk Classification Rubric

Use this when a Sonar cluster doesn't obviously fit MECHANICAL / STRUCTURAL / SECURITY / SKIP. Classification is at the **cluster** level (see Step 8.3 in jelou/workflows/resolve-pr.md), not per individual issue.

## Rule families → default bucket

### Almost always MECHANICAL (auto-apply)
- `*:S1128` Unused imports
- `*:S1481` Unused local variables (only if the initializer is pure)
- `*:S1854` Dead stores (same caveat — RHS must be pure)
- `*:S1192` String literal duplication → extract constant **within a single file**. Cross-file duplication of the same literal is STRUCTURAL (decision needed: which module owns the constant?).
- `*:S125` Commented-out code (delete)
- `*:S1488` Local variable returned immediately → inline
- `typescript:S2933` `readonly` for fields never reassigned
- `javascript:S3504` `var` → `let`/`const`
- `javascript:S3358` Nested ternary → extract
- `python:S1481` Unused variable
- `java:S1118` Utility class missing private constructor

Mechanical, single-file, no semantic change.

### Usually MECHANICAL but verify
- `*:S2068` Hardcoded credentials → MECHANICAL only if the literal is clearly a placeholder/test fixture; otherwise SECURITY.
- `*:S1186` Empty methods → MECHANICAL when the empty method is dead and can be removed, or when the target repo has an established empty-body idiom to apply; STRUCTURAL if Sonar expects behavior. Never resolve by adding an explanatory comment — generated diffs carry zero comments (plugin no-comments doctrine).
- Renaming for naming convention (`*:S100`, `*:S116`) — MECHANICAL for private symbols, STRUCTURAL for anything exported/public API.

### Always STRUCTURAL (plan + question approval required)
- `common-*:DuplicatedBlocks` — duplicated blocks across files. See **Duplication playbook** below.
- `*:S4144` Methods with identical implementations.
- `*:S1871` Branches with identical bodies (if/case).
- `*:S3776` Cognitive complexity. See **Cognitive complexity playbook** below.
- "Extract method" / "split function" / "class too large" — design call, never mechanical.
- Public API renames or signature changes.
- Anything that crosses files or changes async/error/exception semantics.

### Always SECURITY (Step 8.5 hotspot flow)
- Anything tagged `bug` or `vulnerability` regardless of severity.
- Anything tagged `security`, `cwe`, `owasp`, `sans-top25`.
- Concurrency rules (`*:S2445`, `*:S3046`, race condition / synchronization).
- SQL / NoSQL injection rules.
- Regex DoS (`*:S5852`).
- Crypto rules (weak hash, deprecated cipher).
- Resource leaks (`*:S2095`) — closing resources can change error propagation.
- Exception handling (`*:S1166`, `*:S2221`) — swallowing/unwrapping changes behavior.
- Async/promise rules (`*:S4123`, `*:S6544`).
- All hotspots.

### Often SKIP (record reason)
- Generated code, vendored deps, fixtures.
- Issues that require a dependency upgrade to fix properly.
- Style rules contradicted by the repo's actual conventions (check `.eslintrc`, `.prettierrc`, agent instruction docs such as `CLAUDE.md`/`AGENTS.md`, and neighboring files).

**Mode-dependent**: preexisting issues on lines the PR didn't touch are:
- In **deep** mode: included if they share a root cause with a PR issue (same cluster).
- In **shallow** mode: SKIP with reason `out-of-scope-shallow-mode`.

## Duplication playbook

Duplication clusters are the most common source of "surface fixes." A real fix removes the duplication, not just one copy of it.

For each duplication cluster:

1. **Confirm the extent.** Use SonarQube MCP `get_duplications` to get all blocks. Read every block in full — the snippets must be semantically equivalent, not just textually similar.
2. **Identify the abstraction.** Ask: what is the *meaning* of this duplicated code? It usually maps to one of:
   - **Pure function** — same input/output, no I/O. Extract to a util module.
   - **Domain operation** — has side effects but they're consistent. Extract to a service/use-case class.
   - **Cross-cutting concern** — logging, validation, auth checks. Extract to a decorator/middleware/aspect.
   - **Template** — same shape with small variations. Extract via strategy pattern or higher-order function.
3. **Locate the new home.** The abstraction must live where all current call sites can import it without creating a circular dependency. Common landing spots: `lib/`, `shared/`, `domain/<area>/`, `utils/`.
4. **Name it.** A bad name is a sign the abstraction is wrong — if you can't name the function in <5 words, the cluster might actually be 2 different operations that happen to look alike. Split or skip.
5. **Plan the migration.** Every call site updates atomically. List them in execution order. New tests must cover the extracted function before the migration is considered complete.
6. **Anti-pattern check.** Reject the refactor if:
   - The "duplicated" blocks diverge in error handling, ordering, or invariants — they only look alike.
   - The abstraction would have >3 boolean flags / mode parameters.
   - Extraction would force a layering violation (e.g., domain depending on framework).
   - The blocks live in unrelated bounded contexts that should not share code.
   - In those cases SKIP with the reason recorded.

## Cognitive complexity playbook

`S3776` and similar are not "extract any method." They're "find the natural seam." Don't extract just to get under the threshold.

For each complexity cluster:

1. **Read the entire function.** Then write down its responsibility in one sentence. If you can't, the function is doing too much — extraction will help. If you can, extraction should preserve that single sentence.
2. **Find natural seams.** Candidates:
   - Validation block at the top → `validateXxx()`
   - Lookup block → `findXxx()` / `resolveXxx()`
   - Branch that handles a specific case → `handleXxxCase()`
   - Loop body that's non-trivial → extracted iteratee
   - Side-effect block at the end → `persistXxx()` / `notifyXxx()`
3. **Reject premature extraction.** If the extracted helper would only be called from one place and accept >4 parameters or return >2 outputs, it's not a real seam. SKIP.
4. **Preserve invariants.** Before extracting, list the function's invariants (ordering, exception types, transactional boundaries). The plan must show how each survives.
5. **Don't chase the score.** A function at complexity 16 (threshold 15) might be best left alone than fragmented. If the seam is artificial, mark SKIP with reason `complexity-threshold-marginal-no-natural-seam` — the justification goes in the report, never as an in-code suppression comment (plugin no-comments doctrine).
6. **Re-check after.** Step 8.7 must confirm the new helpers are themselves below the threshold. If extraction just moved complexity into a new function, redo.

## Feasibility checks (apply to every cluster)

Before any work:

1. **Do the lines still exist?** Sonar's snapshot can lag the PR head. Re-read the file.
2. **Is there a justifying comment?** `// noqa`, `// eslint-disable`, `// sonar:ignore`, or any free-text "we do this because X" within 5 lines → STOP and SKIP with reason.
3. **Are there tests?** A function with no test coverage cannot be refactored safely. For STRUCTURAL clusters, the STRUCTURAL plan (Step 8.5) must include the missing tests before extraction.
4. **Is it a hot path or public boundary?** Controllers, route handlers, middleware, exported library surface — bump the cluster up one bucket (MECHANICAL → STRUCTURAL, STRUCTURAL → require user confirmation even with approved plan).
5. **Does the fix change observable behavior?** If yes, it belongs in STRUCTURAL with an explicit invariant section in the plan.

## SKIP reasons (record one short sentence)

Examples:
- "Preexisting, no shared root cause with PR issues (shallow mode)"
- "False positive — pattern is intentional, see comment at line N"
- "Fix requires upgrading library X to v2, out of scope"
- "Rule contradicts repo convention in .eslintrc"
- "Test file fixture, magic number is the test data"
- "Duplication looks textual but blocks diverge in error handling"
- "Complexity threshold marginal, no natural seam found"
- "User rejected proposed plan, no alternative provided"

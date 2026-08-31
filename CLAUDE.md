## Pre-push checklist (main branch)

Before pushing to `main` — directly or via merge — the unit test suite MUST pass.

Run: `npm test` (equivalent to `node --test tests/unit/*.test.mjs`)

Also run: `npm run check-sync` to confirm the runtime mirrors are in sync with their canonical sources — `.opencode/agents/` with `agents/` (OpenCode) and `.codex/agents/` + `.codex/skills/` with `agents/` + `skills/` (Codex). After editing any `agents/*.md` or `skills/*/SKILL.md`, run `npm run sync` to regenerate both mirrors.

Also run: `npm run verify-load` — the plugin-load gate. `npm test` proves the scripts behave; it does not prove Claude Code will accept the manifest. Version 0.3.359 shipped a `hooks` reference the runtime auto-loads on its own, and every install reported `failed to load` with a green suite and a passing `claude plugin validate`. The gate is offline and CI-safe: it checks the manifest load rules, hook target reachability, skill and agent frontmatter, and mirror drift, and skips the CLI-dependent step cleanly when `claude` is absent. Exit `1` means the tree would not load — do not push.

Before releasing a change to any skill, agent, or hook, exercise the working tree in a real session: `jlu-dev` from any directory, or directly `claude --plugin-dir "$PWD"`. That loads this tree under the `jlu:` namespace, outranking the installed release for that session only. Testing after publishing is testing in production. Run `/dev-link` (project-scoped skill) once per machine to install the `jlu-dev` helper and verify it loads in the shell you actually run; `bin/install-dev-link.sh` is the same thing without a session.

Optional (opt-in, advisory only): when `OPENROUTER_API_KEY` is set you may also run `node bin/trace-regress.mjs` — the Stage-4 golden-set regression gate. It re-scores the golden examples with the LLM judge and compares against `tests/golden/baseline.json`, exiting `4` if agent-prompt quality has regressed. Without the key it SKIPS cleanly (exit 0) and prints a warning, so it never blocks the mandatory `npm test` + `check-sync` flow. This is not a hard gate yet — `tests/golden/` is still synthetic seed data (see `tests/golden/README.md`), so treat any exit-4 as advisory friction, not a stop.

If any of these fails, do not push. Fix the failure first. Never push with a red suite.

## Code style — no line-by-line comments

When writing or editing code anywhere (this repo, generated PRs, agent output), write
**zero comments**. Do NOT add line-by-line comments that narrate what the code already
says (`// increment i`, `// return the user`, `// arrange / act / assert`), do NOT add
doc-comments or JSDoc on any declaration (class, interface, type, constant, variable,
function), and do NOT add *why* notes. Write self-documenting code: clear names, or an
extracted well-named helper, over comments. Automated PR reviewers (CodeRabbit and the
like) flag every comment in a generated diff, so a diff that adds any comment is a
defect, not documentation.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review

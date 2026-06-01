## Pre-push checklist (main branch)

Before pushing to `main` — directly or via merge — the unit test suite MUST pass.

Run: `npm test` (equivalent to `node --test tests/unit/*.test.mjs`)

Also run: `node bin/sync-agents.mjs --check` to confirm `.opencode/agents/` is in sync with `agents/`.

If either fails, do not push. Fix the failure first. Never push with a red suite — `release after every push to main` means a broken push becomes a broken release.

## Code style — no line-by-line comments

When writing or editing code anywhere (this repo, generated PRs, agent output), do NOT
add line-by-line comments that narrate what the code already says (`// increment i`,
`// return the user`, `// arrange / act / assert`). Write self-documenting code: clear
names over comments. The only comments allowed explain non-obvious *why* — a workaround,
a business rule, a warning — never the *what*. Match the existing comment density of the
file being edited; if a file has no comments, add none. This applies to commits and PRs:
a diff full of explanatory inline comments is a defect, not documentation.

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

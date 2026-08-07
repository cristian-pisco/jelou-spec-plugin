# Resolving the Plugin Root and Invoking a Bundled Bin

> Canonical rule for every workflow, agent and skill that runs a script from `bin/`. There is
> exactly one correct way to do it, and one form that is always wrong. Cite this file instead of
> restating the rule.

## The layout invariant

Every install path lays the plugin out the same way. Given the absolute path of the surface file
you are executing, the plugin root is a fixed number of directories above it:

| Surface | Path | Root is |
|---|---|---|
| Workflow | `<root>/jelou/workflows/<name>.md` | two levels up |
| Reference | `<root>/jelou/references/<name>.md` | two levels up |
| Template | `<root>/jelou/templates/<name>.md` | two levels up |
| Agent | `<root>/agents/<name>.md` | one level up |
| Claude Code skill | `<root>/skills/<name>/SKILL.md` | two levels up |
| Codex skill | `<root>/.codex/skills/jlu-<name>/SKILL.md` | three levels up |

And from that root, `bin/` is always a direct child:

```
<root>/bin/<script>.mjs
<root>/bin/<script>.sh
<root>/bin/lib/<area>/<module>.mjs
```

This holds on all six install paths, which is why the rule is safe to depend on:

| Install path | Root |
|---|---|
| Claude Code marketplace (`/plugin install`) | the plugin cache directory |
| `codex plugin add` | the plugin cache directory |
| `bin/install-codex.sh` (global) | `$CODEX_HOME`, default `~/.codex` |
| `bin/install-codex.sh <project>` | `<project>` |
| `bin/install-opencode.sh` (global) | `$OPENCODE_HOME`, default `~/.config/opencode` |
| `bin/install-opencode.sh <project>` | `<project>` |

## The rule

**Resolve the root from the path of the file you are currently executing, then build the bin path
from it.** You already know that path — you resolved it to read the file.

```bash
node "<root>/bin/<script>.mjs" <args>
```

If the resolved path does not exist, stop and report it as an install problem. Do not search for
the script elsewhere, do not fall back to a relative path, and do not skip the step silently:

```
Script not found at `<root>/bin/<script>.mjs`. The plugin install is incomplete — reinstall with `/jlu-update`.
```

## Never use `${PLUGIN_ROOT:-.}`

**No runtime exports `PLUGIN_ROOT`.** Neither installer sets it, no config file defines it, and no
harness injects it. The `:-.` default therefore always wins on Codex and OpenCode, the command
becomes `node ./bin/<script>.mjs`, and it resolves against the user's service repository — where
the script does not exist. The failure is `MODULE_NOT_FOUND` from a path the user never wrote.

The reason this form survived so long is that it *looks* like it works on Claude Code. It does not:
there, the skill resolves the plugin root in its own bootstrap phase and the agent substitutes the
real value, so the shell default is never exercised. The variable is a placeholder that happens to
be spelled like a shell variable.

`$PLUGIN_ROOT` without a default is worse, not better — it expands to empty and yields `/bin/<script>.mjs`.

`${CLAUDE_PLUGIN_ROOT}` is different and is fine **only inside `hooks/hooks.json`**, where the
Claude Code harness provides it. It is not available to workflows, agents or skills, and it does
not exist on Codex or OpenCode.

## Shipping requirement

A bin is only reachable if it is also **distributed**. `bin/install-codex.sh` and
`bin/install-opencode.sh` each carry an explicit allowlist of `cp` lines; a script absent from them
is simply not on disk after a script install, no matter how correctly the surface resolves the root.
The marketplace paths cache the whole plugin and hide this, so a gap here is invisible until
someone installs with the script.

When you add a bin that any surface invokes:

1. Add a `cp "$PLUGIN_DIR/bin/<script>.<mjs|sh>" …` line to **both** installers, plus any
   `bin/lib/**` imports and the `mkdir -p` for their directories. Shell entry points must remain
   executable after installation.
2. Add the entry point to `FEATURE_BINS` in `tests/unit/installer-manifest.test.mjs`. The existing
   import-graph closure test then fails if any transitive import is missing from an allowlist.

## Enforcement

The distribution half is now a **hard gate**, not a ratchet. `tests/unit/installer-manifest.test.mjs`
asserts that every bin any workflow, agent or skill references is shipped by **both** installers, and
names the referencing surfaces when one is missing. Adding a `node "<root>/bin/<new-script>.mjs"` line
to a surface without touching the installers fails the suite.

(That example deliberately keeps the angle brackets. The scanner matches literal `bin/<name>.mjs`
paths anywhere in a surface file, prose included, so a concrete filename written as an illustration
would be read as a real reference and reported as an unshipped bin.)

Declared exclusions live in `DELIBERATELY_UNSHIPPED`:

| Bin | Why it is not shipped |
|---|---|
| `bin/check-update.sh` | A Claude Code bootstrap used by canonical skills, which script installs do not distribute. |
| `bin/install-codex.sh` | The bootstrap installer itself, referenced only by installation documentation. |
| `bin/install-opencode.sh` | The bootstrap installer itself, referenced only by installation documentation. |
| `bin/sync-codex.mjs` | A repo-development script. It regenerates the `.codex/` mirrors from `skills/` and `agents/`, neither of which exists in an install, so shipping it would hand users a script that reads absent sources. It is referenced only as an instruction to plugin developers. |

An entry there must stay referenced by some surface and stay absent from both installers — the test
fails if an exclusion goes stale in either direction, so the list cannot quietly accumulate.

The resolution half is now a hard gate too. `tests/unit/plugin-root-resolution.test.mjs` asserts that
**no** surface invokes a bin through the shell form. The ratchet it used to carry is gone: it reached
zero, so the list became an assertion.

## Agents: the root is a declared input

An agent is the one surface the self-relative rule above cannot serve, because an agent does not
reliably know its own path. So the contract is inverted for agents:

1. The agent declares `<PLUGIN_ROOT>` as a received input, in its `## Inputs` section.
2. The agent invokes bins as `node "<PLUGIN_ROOT>/bin/<script>.mjs"`.
3. **Every workflow that dispatches it passes the value**, which the skill bootstrap already
   resolved and handed to the workflow.

Step 3 is the half that rots silently: the agent still says it needs the input, nothing passes it,
and the run dies inside a subagent. `plugin-root-resolution.test.mjs` therefore also scans
`jelou/workflows/` for dispatches of any agent that declares `<PLUGIN_ROOT>` and fails when a
dispatch does not pass it. Prose that merely restates a dispatch (a guardrail or summary sentence,
not a payload) is declared in `DISPATCH_PROSE` with a reason, and the test fails if such an entry
stops matching.

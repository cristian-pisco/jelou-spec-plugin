---
name: dev-link
description: Use to set up this working tree as the live plugin from any terminal — runs bin/install-dev-link.sh and proves the helpers actually load in the shell the user really runs. Triggers "dev link", "set up local plugin", "instalar el dev link", "probar el plugin localmente", "jlu-dev no funciona"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

You wire this repository into the user's shell so every terminal can load the working
tree as the live plugin, then you prove it worked.

This skill is project-scoped: it exists only inside `jelou-spec-plugin` and is never
shipped to plugin consumers.

## The problem it solves

Claude Code loads `jlu` from the published release. An unreleased edit to `skills/`,
`agents/`, `hooks/` or `bin/` is invisible unless the session was started with
`claude --plugin-dir <repo-root>`. Forgetting that flag does not fail — the session
silently serves the installed release, so the user tests the old code believing it is
the new code.

`bin/install-dev-link.sh` removes the chance to forget by writing `jlu-dev` and
`jlu-dev-c` into the shell startup file. Your job is that script plus the verification
it cannot do for itself: a script can write a file, but only a session can confirm the
user's terminal actually reads that file.

## Step 1 — Find the file their terminal really reads

```bash
echo "SHELL=$SHELL"; echo "current=$0"; uname -s
ls -la ~/.bashrc ~/.bash_profile ~/.zshrc ~/.profile 2>/dev/null
bin/install-dev-link.sh --detect
```

`--detect` reports where the script *would* write, derived from `uname -s` and `$SHELL`.
Treat it as a proposal, not an answer. `$SHELL` is the login shell from the password
database and goes stale — a user who switched to zsh by hand still has bash recorded.

Reconcile the three signals before writing anything. When they disagree, or when the
detected file does not exist while another one does, ask with `AskUserQuestion` rather
than guessing, and pass the answer through `--rc <path>`.

macOS deserves its own check: Terminal opens bash as a **login** shell, which reads
`~/.bash_profile` and never `~/.bashrc`. If the user is on Darwin with bash and only
`~/.bashrc` exists, writing there produces a file nothing sources — the failure looks
exactly like the script not working.

## Step 2 — Write the block

```bash
bin/install-dev-link.sh
```

Add `--rc <path>` when Step 1 concluded the detection was wrong.

Read the output. A `warning: ... already defines jlu-dev` line means a hand-written
definition exists outside the managed block; the last one loaded wins, so resolve it
before moving on — show the user the offending line and offer to remove it.

The script keeps the previous file as `<file>.jlu-dev-link.bak`, is idempotent, and
reverses with `--uninstall`.

## Step 3 — Prove the helpers load

Writing the file is not evidence. Source it in a clean shell and assert both functions
resolve to this repository:

```bash
RC="$(bin/install-dev-link.sh --detect)"
bash -c "source \"$RC\" >/dev/null 2>&1; type jlu-dev jlu-dev-c"
```

Both must report `is a function`, and the body must carry this repo's absolute path. If
sourcing fails or a function is missing, the block landed in a file the shell does not
read — return to Step 1 instead of re-running the installer.

For zsh, source with `zsh -c` instead, so the check runs the interpreter the user runs.

## Step 4 — Prove the tree loads through it

The helpers being defined does not mean the plugin loads. Gate the tree itself:

```bash
node bin/verify-plugin-load.mjs
```

Exit `1` means `jlu-dev` would open a session that cannot load what it is meant to test.
Report every defect and its fix, then STOP — a working shell alias pointed at a broken
manifest is worse than no alias, because it looks correct.

`claude plugin validate` is not a substitute: it passed on the manifest that made
0.3.359 report `failed to load` on every install.

## Step 5 — Hand over

Tell the user to open a new terminal, or to run `source <rc>`, then:

```
jlu-dev      a session with this working tree, from any directory
jlu-dev-c    the same, resuming the last conversation
```

The current session cannot become the one under test — it already built its skill list.

If the user wants a stretch where a forgotten flag cannot silently serve the released
version, offer `claude plugin uninstall jlu@jelou-spec-plugin` for the duration, and
`claude plugin install jlu@jelou-spec-plugin` to restore it. Confirm before running
either; both change state outside this repository.

## When the environment is lying

`node bin/dev-link.mjs doctor` reports load errors on the installed release, drift
between this tree and it, and `skill-shadow-*` / `agent-shadow-*` findings — copies the
legacy installer left in `~/.claude/skills/` and `~/.claude/agents/` that resolve under
their bare name next to the namespaced surfaces, so a session can route into a frozen
workflow or an agent the plugin already retired.

Removal is destructive and touches directories outside this repo. Show
`node bin/dev-link.mjs clean-shadows` (dry run, lists every path) and ask with
`AskUserQuestion` before running it with `--apply`. Never pass `--apply` unprompted.

## Other runtimes

Only Claude Code has a live `--plugin-dir`, so `jlu-dev` is Claude-only. Codex and
OpenCode read generated mirrors, which makes testing a working tree there a real copy
install:

```bash
npm run sync && ./setup --host codex --host opencode
```

`doctor` fails with `mirror-drift-*` when `.codex/` or `.opencode/` lag behind `agents/`
and `skills/`.

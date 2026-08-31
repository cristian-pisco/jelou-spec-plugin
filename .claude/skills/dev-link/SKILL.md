---
name: dev-link
description: Use to set up this working tree as the live plugin from any terminal — runs bin/install-dev-link.sh and proves the jlu-dev helpers actually load. Triggers "dev link", "set up local plugin", "instalar el dev link", "probar el plugin localmente", "jlu-dev no funciona"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

Run the installer, then prove the helpers load. The script owns which startup file to
write — do not re-derive that.

## Step 1 — Install

```bash
bin/install-dev-link.sh
```

Read the output. It names the startup file it wrote and the plugin directory it points
at; carry both into Step 2.

A `warning: ... already defines jlu-dev` line means a hand-written definition exists
outside the managed block, and the last one loaded wins. Show the user the offending
line and offer to remove it before continuing.

Pass `--rc <path>` only when the user asks for a specific file. `--uninstall` reverses
the change; the previous file is kept as `<file>.jlu-dev-link.bak`.

## Step 2 — Prove the helpers load

Writing a file is not evidence. Source it in a clean shell and assert both functions
resolve to this repository:

```bash
RC="$(bin/install-dev-link.sh --detect)"
bash -c "source \"$RC\" >/dev/null 2>&1; type jlu-dev jlu-dev-c"
```

Both must report `is a function`, and each body must carry this repo's absolute path.
Use `zsh -c` when the startup file is `~/.zshrc`, so the check runs the interpreter the
user runs.

If a function is missing, report what the installer wrote and what sourcing produced —
do not re-run the installer, it would write the same file again.

## Step 3 — Prove the tree loads through it

Defined helpers do not mean the plugin loads. Gate the tree they point at:

```bash
node bin/verify-plugin-load.mjs
```

Exit `1` means `jlu-dev` opens a session that cannot load what it is meant to test.
Report every defect and its fix, then STOP — a working alias pointed at a broken
manifest is worse than no alias, because it looks correct. `claude plugin validate` is
not a substitute: it passed on the manifest that made 0.3.359 fail to load on every
install.

## Step 4 — Hand over

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

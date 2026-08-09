# Workflow: update

> Orchestrator workflow for `/jlu-update [--ref <ref>]`
> Brings the Jelou Spec Plugin to the latest version for the current runtime.

---

You are the orchestrator for the `/jlu-update` command. Your job is to bring the plugin to
the latest version for the runtime you are running in. On Codex and OpenCode that means
pulling the shared git cache and reinstalling. On Claude Code the plugin is loaded from the
marketplace cache, so the updater drives the non-interactive plugin CLI
(`claude plugin marketplace update` then `claude plugin update jlu@jelou-spec-plugin`) and
the update is applied directly — you do not need to run `/plugin update` yourself.

The script decides the host BEFORE resolving any git cache. That order matters: a machine
with Codex or OpenCode installed also has `$JLU_HOME`, and pulling it on the `claude` host
would refresh files the marketplace runtime never loads — a no-op that prints a successful
update. If you ever see a Claude Code run report `Reinstalling into: claude` or a version
transition from the git cache, the update did NOT reach the runtime.

## Step 1 — Determine your host

Map the runtime you are running in to a `--host` value:

- Claude Code → `claude`
- Codex → `codex`
- OpenCode → `opencode`

The command file that invoked you declares which runtime you are. Use that.

## Step 2 — Locate the updater script

The updater lives in the plugin's `bin/` directory. Find the first path that exists:

1. `${JLU_HOME:-$HOME/.jelou-spec-plugin}/bin/jlu-update.sh` (the shared git cache created
   by the installer — preferred, since it is a git checkout that can be pulled)
2. Starting from the resolved `jelou/workflows/update.md`, go up one directory from
   `workflows/` and use `bin/jlu-update.sh` beside it (the runtime bootstrap installed for
   Codex and OpenCode)
3. Starting from the resolved `jelou/workflows/update.md`, go up two directories from
   `workflows/` and use `bin/jlu-update.sh` (the source or marketplace plugin checkout)

If none of the three exists, the plugin was not installed via the standard installer. Report this and
tell the user to (re)install with the one-liner:

```
curl -fsSL https://github.com/cristian-pisco/jelou-spec-plugin/raw/main/install.sh | bash -s -- --host <your-host>
```

…and, for Claude specifically, that the marketplace path is `/plugin update jlu@jelou-spec-plugin`.

## Step 3 — Run the updater

Run, passing your host from Step 1:

```bash
<resolved-script> --host <your-host>
```

Append `--ref <ref>` **only** if the user supplied a ref (a tag, branch, or commit to pin to);
omit the flag entirely otherwise, so the updater resolves the latest release itself:

```bash
<resolved-script> --host <your-host> --ref <ref>
```

On Codex/OpenCode the script pulls the shared cache to the latest release, uses the repo
where the updater script lives when no shared cache exists, or bootstraps the shared cache
if neither git checkout is available. It prints `vOLD -> vNEW` (or `Already at vX`) and
re-runs `setup --host <your-host>` to refresh that runtime's installed files. On Claude
Code it drives the plugin CLI and prints the CLI's result (e.g. `already at the latest
version` or the upgrade), then a restart reminder.

## Step 3b — Ensure E2E settings exist

After the updater returns, seed the plugin's E2E settings file so it is present without the user
ever creating it by hand. Idempotent — it creates `~/.jlu/e2e-settings.json` from the shipped
template only when absent, and never clobbers a file the user has edited:

```bash
node "<plugin-root>/bin/seed-e2e-settings.mjs"
```

This is belt-and-suspenders: the plugin's `SessionStart` hook and `/jlu-goal` also seed it,
so an update via the native plugin CLI (which does not re-run `setup`) still lands the file on the
next session or E2E run.

## Step 4 — Report

Relay the script's outcome to the user in one or two lines: the version transition (or
`already at latest`) and which host was refreshed. On Claude Code, remind the user that a
restart / new session is required to load the new version. If the script fell back to its
guidance (no git cache and no `claude` CLI, or no installer-managed cache on Codex/OpenCode),
relay that guidance verbatim — do not invent steps.

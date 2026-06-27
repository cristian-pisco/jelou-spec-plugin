# Workflow: update

> Orchestrator workflow for `/jlu-update [--ref <ref>]`
> Brings the Jelou Spec Plugin to the latest version for the current runtime.

---

You are the orchestrator for the `/jlu-update` command. Your job is to bring the plugin to
the latest version for the runtime you are running in. On Codex and OpenCode that means
pulling the shared git cache and reinstalling. On Claude Code the plugin lives in the
marketplace cache (no git cache); there the updater drives the non-interactive plugin CLI
(`claude plugin marketplace update` then `claude plugin update jlu@jelou-spec-plugin`) so
the update is applied directly — you do not need to run `/plugin update` yourself.

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
2. `<plugin-root>/bin/jlu-update.sh` (the resolved plugin root, for dev or manual installs)

If neither exists, the plugin was not installed via the standard installer. Report this and
tell the user to (re)install with the one-liner:

```
curl -fsSL https://github.com/cristian-pisco/jelou-spec-plugin/raw/main/install.sh | bash -s -- --host <your-host>
```

…and, for Claude specifically, that the marketplace path is `/plugin update jlu@jelou-spec-plugin`.

## Step 3 — Run the updater

Run, passing your host from Step 1 and forwarding a `--ref <ref>` only if the user supplied one:

```bash
<resolved-script> --host <your-host>
```

On Codex/OpenCode the script pulls the cache to the latest release, prints `vOLD -> vNEW`
(or `Already at vX`), and re-runs `setup --host <your-host>` to refresh that runtime's
installed files. On Claude Code it drives the plugin CLI and prints the CLI's result
(e.g. `already at the latest version` or the upgrade), then a restart reminder.

## Step 4 — Report

Relay the script's outcome to the user in one or two lines: the version transition (or
`already at latest`) and which host was refreshed. On Claude Code, remind the user that a
restart / new session is required to load the new version. If the script fell back to its
guidance (no git cache and no `claude` CLI, or no installer-managed cache on Codex/OpenCode),
relay that guidance verbatim — do not invent steps.

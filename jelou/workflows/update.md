# Workflow: update

> Orchestrator workflow for `/jlu-update [--ref <ref>]`
> Brings the Jelou Spec Plugin to the latest version for the current runtime.

---

You are the orchestrator for the `/jlu-update` command. Your job is to pull the latest
plugin version into the shared git cache and reinstall it for the runtime you are running
in. Claude Code has a native update path (the plugin marketplace); Codex and OpenCode do
not, so this command is their only built-in way to update.

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

The script pulls the cache to the latest release, prints `vOLD -> vNEW` (or `Already at vX`),
and re-runs `setup --host <your-host>` to refresh that runtime's installed files.

## Step 4 — Report

Relay the script's outcome to the user in one or two lines: the version transition and which
host was refreshed. If the script exited because no git cache exists, relay its guidance
verbatim (the reinstall one-liner, or `/plugin update` for Claude) — do not invent steps.

# Changelog

## [Unreleased]

- Merge spec interview into `/jlu:new-task` — interview runs inline immediately after service confirmation, worktrees created in background
- Introduce `/jlu:refine-task` — apply last-minute targeted changes to an approved spec via structured agent interview
- Remove `/jlu:refine-spec` (replaced by inline interview in `new-task` and targeted `refine-task`)
- Add agent spawning feedback pattern to all modified workflows (orchestrator notifies user before spawning any agent)
- Fix AskUserQuestion enforcement in `jlu-concerns-researcher` — Phase 2 now uses explicit round-based AskUserQuestion calls instead of plain text output
- Add AskUserQuestion mandate to all 7 workflow files (new-task, refine-task, execute-task, close-task, create-pr, extend-phase, map-codebase)
- Migrate `/jlu:sync-clickup` to ClickUp MCP server — no API key needed, auto-discovers custom fields, adds time_estimate as required field
- Remove `/jlu:publish-uh` (functionality merged into `sync-clickup`)
- Deprecate `jlu-pm-agent` and `/jlu:setup-clickup` (replaced by direct ClickUp MCP calls)
- Update `/jlu:close-task` to use ClickUp MCP tools directly for status updates

## [0.2.2]

- Add status summary (Current Status + Next Step) to `/jlu:load-context` command
- Add architecture diagrams to documentation

## [0.2.1]

- Add `/jlu:load-context` command for resuming task context in fresh sessions
- Remove `/jlu:new-project` command (replaced by workspace auto-creation in `new-task`)

## [0.2.0]

- Add `/jlu:create-pr` skill for automated pull request creation across all affected services
- Add auto version bump hook on commits via `PostToolUse` hook
- Improve integrations researcher HTTP client tracing

## [0.1.x]

- Fix marketplace.json source path for Claude Code plugin schema
- Fix plugin install commands and enhance plugin manifest

## [0.1.0]

- Initial commit: Jelou Spec Plugin for Claude Code

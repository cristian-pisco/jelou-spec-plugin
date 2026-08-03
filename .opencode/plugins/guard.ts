// OpenCode equivalent of the Claude Code PreToolUse guards (hooks/hooks.json).
//
// OpenCode has no JSON hooks config — lifecycle interception goes through a
// plugin. This reuses the SAME pure classifiers the Claude Code hooks use
// (bin/guard-*.mjs export them), so the env-poisoning and worker-cap policies
// hold under OpenCode too. To block a tool call from `tool.execute.before`,
// throw — OpenCode surfaces the message to the model so it self-corrects.
//
// The bin/ guard scripts are shipped alongside this plugin by
// bin/install-opencode.sh (copied to <target>/bin/), so the relative import
// resolves both in-repo and post-install.

import type { Plugin } from "@opencode-ai/plugin"
import { classifyCommand, defaultResolveScript } from "../../bin/guard-test-commands.mjs"
import { classifyBashCommand, classifyRead } from "../../bin/guard-env-reads.mjs"
import { trySeedSettings } from "../../bin/seed-e2e-settings.mjs"

export const JluGuardPlugin: Plugin = async ({ directory }) => {
  const baseCwd = directory ?? process.cwd()
  trySeedSettings()
  return {
    "tool.execute.before": async (input, output) => {
      const args = output?.args ?? {}

      // Shell tool: "bash" (opencode ≤1.3.x) / "shell" (opencode ≥1.16).
      if (input.tool === "bash" || input.tool === "shell") {
        const command = typeof args.command === "string" ? args.command : ""
        if (!command) return
        const cwd = typeof args.workdir === "string" ? args.workdir : baseCwd

        const envVerdict = classifyBashCommand(command, cwd)
        if (envVerdict.decision === "deny") throw new Error(envVerdict.reason)

        const testVerdict = classifyCommand(command, { cwd, resolveScript: defaultResolveScript })
        if (testVerdict.decision === "deny") throw new Error(testVerdict.reason)
        return
      }

      // File-read tool.
      if (input.tool === "read") {
        const filePath = typeof args.filePath === "string" ? args.filePath : ""
        const verdict = classifyRead(filePath)
        if (verdict.decision === "deny") throw new Error(verdict.reason)
      }
    },
  }
}

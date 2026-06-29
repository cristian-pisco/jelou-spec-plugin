// bin/lib/codex-prompt.mjs
//
// Renders a Codex CLI custom prompt (`.codex/prompts/jlu-<skill>.md`) from a
// canonical skill's frontmatter. Codex prompts are the thin per-runtime shell
// (CAPA 1) for Codex, mirroring `.opencode/commands/jlu-<skill>.md`: they
// resolve the shared workflow and apply the Codex runtime contract. The real
// logic lives in `jelou/workflows/<skill>.md`.

function stripWrappingQuotes(value) {
  const v = String(value ?? '').trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

// The skill `description` is trigger-laden ("… Triggers: a, b, c") and may carry
// escaped quotes from YAML. Codex prompts aren't implicitly triggered, so the
// description is menu cosmetics — take the first sentence, unescaped, YAML-safe.
export function cleanDescription(raw) {
  let d = stripWrappingQuotes(raw).replace(/\\"/g, '"').replace(/\\'/g, "'");
  d = d.split(/\s*Triggers?:/i)[0].trim();
  return d.replace(/\s+/g, ' ');
}

// YAML double-quoted flow scalars accept JSON-style escapes, so JSON.stringify
// produces a valid, unambiguous scalar regardless of internal quotes.
function yamlScalar(value) {
  return JSON.stringify(String(value));
}

export function renderCodexPrompt(skillName, frontmatter = {}) {
  if (!skillName) throw new Error('renderCodexPrompt requires a skill name');
  const description = cleanDescription(frontmatter.description) || `Run the jlu-${skillName} workflow`;
  const argumentHint = frontmatter['argument-hint'] !== undefined
    ? stripWrappingQuotes(frontmatter['argument-hint'])
    : undefined;

  const fm = [`description: ${yamlScalar(description)}`];
  if (argumentHint) fm.push(`argument-hint: ${yamlScalar(argumentHint)}`);

  return `---
${fm.join('\n')}
---
Resolve the workflow file in this order, and use the first one that exists:
1. \`$CODEX_HOME/jelou/workflows/${skillName}.md\` (global install; \`$CODEX_HOME\` defaults to \`~/.codex\` — resolve it to an absolute path first).
2. \`jelou/workflows/${skillName}.md\` (project-local fallback).

Resolution rules:
- Select the first existing path only; never read a lower-priority path when a higher one exists.
- If neither exists, stop and report both checked paths.
- Do not read or execute \`skills/${skillName}/SKILL.md\`; \`skills/*/SKILL.md\` files are Claude Code entry points, not Codex prompts.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
The current directory is the project working directory.

## Runtime contract (Codex)

The workflow is runtime-neutral and uses the generic verbs \`question\` and \`task\`:
- \`question\` / \`AskUserQuestion\` → Codex has no structured question tool. Ask the user in plain text, present any prescribed options as a numbered list, and WAIT for their reply before continuing. Never assume an answer, answer for the user, continue inline, or skip a prescribed question because a structured question tool is unavailable.
- \`task\` → dispatch a Codex subagent (a \`worker\`/\`explorer\` agent, or the named \`jlu-*\` agent from \`.codex/agents/\`). If subagent dispatch is unavailable, perform the step inline in this session. Do not let a dispatched agent itself dispatch further agents (Codex defaults to \`agents.max_depth = 1\`).
- Always reference commands with the \`jlu-\` prefix (never \`jlu:\`).
- Phase 1 portability: if a step touches ClickUp or Slack integration, skip it and report it as deferred.
`;
}

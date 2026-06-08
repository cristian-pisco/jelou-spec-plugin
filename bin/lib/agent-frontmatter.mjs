// bin/lib/agent-frontmatter.mjs
//
// Parses agent markdown files with YAML frontmatter and transforms
// Claude Code-shaped frontmatter into OpenCode-shaped frontmatter.
//
// Claude Code frontmatter (canonical): name, description, tools, model.
// OpenCode frontmatter (mirror):       description, mode: subagent.
//
// The body is preserved verbatim — historically, OpenCode mirrors had
// stripped bodies, which caused agent capability drift. Sync restores parity.

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function unquote(value) {
  if (typeof value !== 'string') return value;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    if (!inner.includes('"')) return inner;
  }
  return value;
}

export function parseAgentFile(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error('Missing or malformed YAML frontmatter');
  }
  const [, fmText, body] = match;
  const frontmatter = {};
  for (const line of fmText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = unquote(value);
  }
  return { frontmatter, body };
}

export function transformFrontmatter(input) {
  const out = {};
  if (input.description !== undefined) {
    out.description = unquote(input.description);
  }
  out.mode = 'subagent';
  return out;
}

export function renderOpencodeAgent(raw) {
  const { frontmatter, body } = parseAgentFile(raw);
  const next = transformFrontmatter(frontmatter);
  const lines = ['---'];
  if (next.description !== undefined) {
    lines.push(`description: ${next.description}`);
  }
  lines.push(`mode: ${next.mode}`);
  lines.push('---');
  return `${lines.join('\n')}\n${body}`;
}

// Codex custom agents are TOML files (~/.codex/agents/ or .codex/agents/) with
// `name`, `description`, `developer_instructions`. The markdown body becomes
// `developer_instructions`. Claude Code's `tools` (CC tool names) and `model`
// (sonnet/opus aliases) have no Codex meaning, so they're dropped — the Codex
// agent inherits model/sandbox/mcp_servers from the parent session.

function tomlBasicString(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;
}

export function renderCodexAgent(raw) {
  const { frontmatter, body } = parseAgentFile(raw);
  const name = unquote(frontmatter.name);
  if (!name) throw new Error('Codex agent requires a `name` in frontmatter');

  const instructions = body.replace(/^\n+/, '');
  // TOML multi-line literal strings ('''…''') preserve backslashes and quotes
  // verbatim — ideal for prompt bodies full of regex and \n. The only sequence
  // they cannot contain is ''' itself; fail loud so a future author handles it.
  if (instructions.includes("'''")) {
    throw new Error(
      `Codex agent '${name}' body contains ''' which breaks the TOML literal string. ` +
        'Rewrite the body or extend renderCodexAgent to use an escaped basic string.',
    );
  }
  const block = instructions.endsWith('\n') ? instructions : `${instructions}\n`;

  const lines = [`name = ${tomlBasicString(name)}`];
  if (frontmatter.description !== undefined) {
    lines.push(`description = ${tomlBasicString(unquote(frontmatter.description))}`);
  }
  lines.push(`developer_instructions = '''\n${block}'''`);
  return `${lines.join('\n')}\n`;
}

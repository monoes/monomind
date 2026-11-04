/**
 * kimi-code AGENTS.md generation (workspace instructions).
 * File-size sweep: split out of kimi-generator.ts.
 */

import { monomindNpx } from '../platform-adapters/renderers/mcp.js';

/**
 * Generate AGENTS.md for kimi — workspace instructions (CLAUDE.md equivalent).
 * Written as kimi's own managed block by writeAgentsMd (write-agents.ts).
 */
export function generateKimiAgentsMd(pin?: string): string {
  const npx = monomindNpx(pin);
  const lines = [
    '# AGENTS.md — Monomind on Kimi Code',
    '',
    'Monomind is wired in as an MCP server (see .kimi-code/mcp.json). Its tools are',
    'available as `mcp__monomind__*`: `monograph_query`, `monograph_suggest`,',
    '`monograph_impact`, `memory_kg_search`, `memory_pattern-store`, and more.',
    '',
    '## Code navigation — graph first',
    'Call `mcp__monomind__monograph_query` / `monograph_suggest` BEFORE grep/rg/find',
    'for code exploration. They return file path + line number from a SQLite knowledge',
    'graph. Only fall back to grep if monograph returns nothing or the graph isn’t built.',
    '',
    'The graph gate adds a one-time reminder to the first source-code search of a',
    'session (it never blocks). Opt out: .monomind/guidance/active-gates.json',
    '{"graphGate": "off"} or MONOMIND_GRAPH_GATE=off.',
    '',
    '## Memory',
    'Persist insights across sessions: `mcp__monomind__memory_pattern-store` to save,',
    '`mcp__monomind__memory_kg_search` to recall. Use namespacing to keep project/agent',
    'memory separate.',
    '',
    '## Hooks & slash commands (optional plugin)',
    'Project-level hooks are not supported by kimi (only user config.toml or plugins).',
    'To enable monomind hooks and /monomind:* slash commands, install the generated',
    'plugin once: `/plugins install ./.kimi-code/plugin`, then `/reload`.',
    '',
    '## Security',
    '- NEVER hardcode secrets/keys in source. NEVER commit .env.',
    '- Always validate input at system boundaries.',
    `- Run \`${npx} security scan\` after security-related changes.`,
    '',
    '## Conventions',
    '- Agents live in `.kimi-code/agents/`, skills in `.kimi-code/skills/`.',
    '- Claude commands are also present as flow skills: /skill:<category>-<name>.',
    '- For multi-file work, dispatch parallel sub-agents via the Agent tool.',
    '- Project-specific run/test/lint commands are in `.agents/shared_instructions.md`.',
    '',
    '## Autonomous orgs',
    'Set MONOMIND_RUNTIME=kimicode to run org roles on the kimi CLI backend, then:',
    '```bash',
    'monomind org run <name> --task "..."',
    '```',
    '',
    '## Build & test',
    '```bash',
    'npm run build && npm test && npm run lint',
    '```',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

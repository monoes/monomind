/**
 * `monomind init --target agents`: AGENTS.md and nothing else — for coder
 * runtimes that read AGENTS.md natively and have no init target of their own
 * (pi, pi-rpc, dsh, grok, copilot, qwen, qwen-rpc, crush). No CLAUDE.md, no
 * `.claude/`, no `.mcp.json`, no `.monomind/` runtime state, no memory
 * database, no code graph: a folder made for one of those runtimes gets only
 * the instruction file it reads. Not part of `--target all`.
 *
 * The content is the runtime-neutral part of the Codex target's AGENTS.md
 * (codex-generator.ts) — without its Codex-only lines (`.codex/config.toml`,
 * status line, native hooks), which would be false in these folders.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './fs-helpers.js';
import type { InitOptions, InitResult } from './types.js';

export function generateAgentsOnlyMd(): string {
  return [
    '# AGENTS.md — Monomind',
    '',
    'When the monomind MCP server is available (tools named `mcp__monomind__*` or',
    '`monomind_*`), use it for code navigation, impact analysis, persistent memory,',
    'and agent routing in this project. If MCP is unavailable, the same features',
    'are available through `npx -y monomind@latest` commands.',
    '',
    '## Code navigation',
    '',
    'Call `monograph_query` or `monograph_suggest` before using grep/rg/find for',
    'code exploration. Fall back only when the graph has no relevant results or',
    'has not been built.',
    '',
    '## Memory',
    '',
    'Store durable project insights in Monomind memory and recall prior decisions',
    'before repeating investigation or implementation work.',
    '',
    '## Mesh',
    '',
    'Mesh: other agents on this host can message this one. Call `mesh_inbox` at the start of each task to read them; `mesh_who` lists them and `mesh_send` answers.',
    '',
    '## Security',
    '',
    '- Never hardcode secrets or commit `.env` files.',
    '- Validate input at system boundaries.',
    '- Run `npx monomind@latest security scan` after security-related changes.',
    '',
  ].join('\n');
}

/** Creates AGENTS.md when absent; an existing one is never touched (with or
 *  without --force/--if-missing — it may be the user's own). */
export function writeAgentsOnly(
  targetDir: string,
  _options: InitOptions,
  result: InitResult,
): void {
  const file = path.join(targetDir, 'AGENTS.md');
  if (fs.existsSync(file)) {
    result.skipped.push('AGENTS.md');
    return;
  }
  atomicWriteFile(file, generateAgentsOnlyMd());
  result.created.files.push('AGENTS.md');
}

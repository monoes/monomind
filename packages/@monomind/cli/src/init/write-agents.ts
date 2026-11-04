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
import { monomindNpx } from '../platform-adapters/renderers/mcp.js';
import { generateCodexAgentsMd } from './codex-generator.js';
import { guardFor } from './file-guard.js';
import { atomicWriteFile } from './fs-helpers.js';
import { generateKimiAgentsMd } from './kimi-generator-agents-md.js';
import { dropLegacyUnmarked, readGeneratedBlock } from './managed-block.js';
import { generateAgentsMd } from './opencode-generator.js';
import type { InitOptions, InitResult } from './types.js';

export function generateAgentsOnlyMd(pin?: string): string {
  const npx = monomindNpx(pin);
  return [
    '# AGENTS.md — Monomind',
    '',
    'When the monomind MCP server is available (tools named `mcp__monomind__*` or',
    '`monomind_*`), use it for code navigation, impact analysis, persistent memory,',
    'and agent routing in this project. If MCP is unavailable, the same features',
    `are available through \`${npx}\` commands.`,
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
    'If the tools `mesh_who`, `mesh_send` and `mesh_inbox` are available, other agents on',
    'this host can message you: call `mesh_inbox` at the start of each task.',
    '',
    '## Security',
    '',
    '- Never hardcode secrets or commit `.env` files.',
    '- Validate input at system boundaries.',
    `- Run \`${npx} security scan\` after security-related changes.`,
    '',
  ].join('\n');
}

/** Creates AGENTS.md when absent; an existing one is never touched (with or
 *  without --force/--if-missing — it may be the user's own). */
export function writeAgentsOnly(targetDir: string, options: InitOptions, result: InitResult): void {
  const file = path.join(targetDir, 'AGENTS.md');
  if (fs.existsSync(file)) {
    result.skipped.push('AGENTS.md');
    return;
  }
  atomicWriteFile(file, generateAgentsOnlyMd(options.mcp?.pin));
  result.created.files.push('AGENTS.md');
}

/**
 * The AGENTS.md blocks the codex, opencode and kimi targets own, in the order
 * they are first written. opencode keeps the bare `agents-md` marker it has
 * always used, so existing files refresh in place.
 */
const AGENTS_MD_BLOCKS = [
  { component: 'codex', marker: 'agents-md:codex', generate: generateCodexAgentsMd },
  { component: 'opencode', marker: 'agents-md', generate: generateAgentsMd },
  { component: 'kimicode', marker: 'agents-md:kimi', generate: generateKimiAgentsMd },
] as const;

/**
 * The one writer of AGENTS.md for the codex, opencode and kimi targets. They
 * used to write it themselves with different policies (two skip-if-exists,
 * one managed block under --force), so which body won depended on write
 * order. Each selected target now gets its own managed block, written in a
 * fixed order: the file comes out the same however the run is ordered, a
 * re-run is byte-identical, and text outside the blocks is never touched.
 * Like CLAUDE.md, an existing file is only changed under --force.
 */
export function writeAgentsMd(targetDir: string, options: InitOptions, result: InitResult): void {
  const blocks = AGENTS_MD_BLOCKS.filter(({ component }) => options.components[component]);
  if (blocks.length === 0) return;
  const file = path.join(targetDir, 'AGENTS.md');
  const exists = fs.existsSync(file);
  if (exists && !options.force) {
    result.skipped.push('AGENTS.md');
    return;
  }
  const original = exists ? fs.readFileSync(file, 'utf-8') : '';
  // Drop the unmarked bodies older releases wrote first, so every block is
  // then placed by the fixed order rather than where an old body sat.
  let content = blocks.reduce(
    (text, { marker, generate }) =>
      readGeneratedBlock(text, marker) === null ? dropLegacyUnmarked(text, generate()) : text,
    original,
  );
  const guard = guardFor(targetDir, options, result);
  for (const { marker, generate } of blocks) {
    content = guard.mergeBlock(file, content, marker, generate(options.mcp?.pin)) ?? content;
  }
  if (content === original) {
    result.skipped.push('AGENTS.md');
    return;
  }
  atomicWriteFile(file, content);
  result.created.files.push('AGENTS.md');
}

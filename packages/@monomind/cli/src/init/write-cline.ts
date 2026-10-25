/**
 * `monomind init --target cline`: a monomind rule file in `.clinerules/`
 * (cline also reads the shared AGENTS.md). cline has no project-scope MCP —
 * its servers live in the user's ~/.cline/data/settings/cline_mcp_settings.json
 * — so init never edits the user's home and instead names the one command
 * that registers the server (checked against cline 3.0.65).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './fs-helpers.js';
import type { InitOptions, InitResult } from './types.js';

const RULE = '.clinerules/monomind.md';

export const CLINE_MCP_INSTALL_COMMAND =
  'cline mcp install monomind --yes -- npx -y monomind@latest mcp start';

export function clineRule(): string {
  return [
    '# Monomind',
    '',
    'Use the `monomind` MCP tools for graph navigation, impact analysis, memory, and organization work.',
    'For multi-step work, load only the applicable `mastermind-*` skill; do not load all workflows at once.',
    'If MCP is unavailable, run `npx -y monomind@latest doctor` and use `npx -y monomind@latest` commands.',
    '',
    `cline keeps MCP servers per user: register monomind once with \`${CLINE_MCP_INSTALL_COMMAND}\`.`,
    'Messages from other agents on this host arrive only when you read them: at the start of a task call the `mesh_inbox` MCP tool (find it with `monomind_tool_search` if it is not listed), and answer with `mesh_send`.',
    '',
  ].join('\n');
}

export async function writeClineFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const rulesDir = path.join(targetDir, '.clinerules');
  const file = path.join(targetDir, RULE);
  const note = () =>
    (result.warnings ??= []).push(
      `cline: MCP servers are user-scope only; register monomind with \`${CLINE_MCP_INSTALL_COMMAND}\``,
    );
  // A single-file `.clinerules` (cline's older form) is the user's own rule file.
  if (fs.existsSync(rulesDir) && !fs.statSync(rulesDir).isDirectory()) {
    result.skipped.push(`${RULE} (.clinerules is a file; cline still reads AGENTS.md)`);
    note();
    return;
  }
  const exists = fs.existsSync(file);
  if (exists && (!options.force || options.ifMissing)) {
    result.skipped.push(RULE);
  } else {
    const content = clineRule();
    if (exists && fs.readFileSync(file, 'utf8') === content) {
      result.skipped.push(RULE);
    } else {
      fs.mkdirSync(rulesDir, { recursive: true });
      atomicWriteFile(file, content);
      (exists ? result.updated : result.created.files).push(RULE);
    }
  }
  note();
}

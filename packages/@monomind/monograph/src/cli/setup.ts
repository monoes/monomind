/**
 * setupMonograph — Writes monograph MCP server configuration into AI tool
 * config files (CLAUDE.md, AGENTS.md, .cursor/mcp.json) for a given repo.
 *
 * Running it multiple times is idempotent: if the config block is already
 * present the file is left unchanged.
 */

import fs from 'fs/promises';
import path from 'path';

export type SetupTool = 'claude' | 'cursor' | 'agents-md';

export interface SetupOptions {
  /** Absolute path to the repository root */
  repoPath: string;
  /** Which tool configs to write. Defaults to all three. */
  tools?: SetupTool[];
}

export interface SetupResult {
  /** Files that were written or updated */
  configured: string[];
  /** Files that were skipped because the config was already present */
  skipped: string[];
  /** Errors encountered (file not written) */
  errors: string[];
}

// ─── MCP server config ───────────────────────────────────────────────────────

const MCP_SERVER_ENTRY = {
  command: 'npx',
  args: ['@monoes/monograph', 'mcp'],
  env: {},
};

const MCP_CONFIG_BLOCK = JSON.stringify(
  { mcpServers: { monograph: MCP_SERVER_ENTRY } },
  null,
  2,
);

// Sentinel used to detect whether the block is already present in markdown.
const MONOGRAPH_SENTINEL = '@monoes/monograph';

const MARKDOWN_BLOCK = `
## Monograph MCP Server

Add the following to your MCP configuration to enable monograph code intelligence:

\`\`\`json
${MCP_CONFIG_BLOCK}
\`\`\`
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Append the monograph config block to a markdown file (CLAUDE.md / AGENTS.md).
 * Idempotent: does nothing when the sentinel string is already present.
 */
async function upsertMarkdownFile(filePath: string): Promise<'configured' | 'skipped'> {
  const existing = await readFileSafe(filePath);

  if (existing.includes(MONOGRAPH_SENTINEL)) {
    return 'skipped';
  }

  const updated = existing.trimEnd() + '\n' + MARKDOWN_BLOCK.trimStart();
  await fs.writeFile(filePath, updated, 'utf-8');
  return 'configured';
}

/**
 * Merge the monograph server entry into a JSON MCP config file.
 * Preserves existing keys. Idempotent.
 *
 * Handles corrupt / unreadable files gracefully (leaves them untouched).
 */
async function upsertJsonMcpFile(
  filePath: string,
): Promise<'configured' | 'skipped' | 'error'> {
  const raw = await readFileSafe(filePath);

  let config: Record<string, unknown> = {};

  if (raw.trim().length > 0) {
    try {
      config = JSON.parse(raw);
    } catch {
      // Corrupt JSON — leave untouched
      return 'error';
    }
  }

  // Check idempotency
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  if (servers.monograph !== undefined) {
    return 'skipped';
  }

  config.mcpServers = { ...servers, monograph: MCP_SERVER_ENTRY };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return 'configured';
}

// ─── Per-tool handlers ────────────────────────────────────────────────────────

async function setupClaude(repoPath: string, result: SetupResult): Promise<void> {
  const filePath = path.join(repoPath, 'CLAUDE.md');
  try {
    const outcome = await upsertMarkdownFile(filePath);
    if (outcome === 'configured') {
      result.configured.push('CLAUDE.md');
    } else {
      result.skipped.push('CLAUDE.md');
    }
  } catch (err: unknown) {
    result.errors.push(`CLAUDE.md: ${(err as Error).message}`);
  }
}

async function setupCursor(repoPath: string, result: SetupResult): Promise<void> {
  const filePath = path.join(repoPath, '.cursor', 'mcp.json');
  try {
    const outcome = await upsertJsonMcpFile(filePath);
    if (outcome === 'configured') {
      result.configured.push('.cursor/mcp.json');
    } else if (outcome === 'skipped') {
      result.skipped.push('.cursor/mcp.json');
    } else {
      result.errors.push('.cursor/mcp.json: file is corrupt — skipping to preserve existing content');
    }
  } catch (err: unknown) {
    result.errors.push(`.cursor/mcp.json: ${(err as Error).message}`);
  }
}

async function setupAgentsMd(repoPath: string, result: SetupResult): Promise<void> {
  const filePath = path.join(repoPath, 'AGENTS.md');
  try {
    const outcome = await upsertMarkdownFile(filePath);
    if (outcome === 'configured') {
      result.configured.push('AGENTS.md');
    } else {
      result.skipped.push('AGENTS.md');
    }
  } catch (err: unknown) {
    result.errors.push(`AGENTS.md: ${(err as Error).message}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const ALL_TOOLS: SetupTool[] = ['claude', 'cursor', 'agents-md'];

/**
 * Write the monograph MCP server configuration into AI tool config files.
 *
 * @param repoPath  - Absolute path to the target repository root
 * @param tools     - Which tools to configure (default: all)
 * @returns         - SetupResult describing what was written / skipped / errored
 *
 * @example
 * const result = await setupMonograph({ repoPath: '/path/to/repo' });
 * console.log(result.configured); // ['CLAUDE.md', '.cursor/mcp.json', 'AGENTS.md']
 */
export async function setupMonograph(options: SetupOptions): Promise<SetupResult> {
  const { repoPath, tools = ALL_TOOLS } = options;

  const result: SetupResult = {
    configured: [],
    skipped: [],
    errors: [],
  };

  const handlers: Record<SetupTool, (repoPath: string, result: SetupResult) => Promise<void>> = {
    claude: setupClaude,
    cursor: setupCursor,
    'agents-md': setupAgentsMd,
  };

  await Promise.all(tools.map((tool) => handlers[tool](repoPath, result)));

  return result;
}

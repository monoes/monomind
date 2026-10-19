/**
 * Doctor — project/monomind health checks
 * Config, memory, API keys, MCP, monograph, helpers, routing, gates, gitignore, worker metrics
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mcpAddHint } from '../platform-adapters/renderers/mcp.js';
import { CONFIG_JSON_CANDIDATE_PATHS, CONFIG_YAML_CANDIDATE_PATHS } from '../utils/paths.js';
import { type HealthCheck, MAX_DOCTOR_CONFIG_BYTES } from './doctor-env-checks.js';

export { checkGitignoreCoverage, fixGitignoreCoverage } from './doctor-gitignore-checks.js';
export { checkGuidanceGates, checkHelpersFresh, fixStaleHelpers } from './doctor-helpers-checks.js';
export {
  checkDocumentExtractors,
  checkMemoryDatabase,
  checkMemoryKnowledgeGraph,
  checkMemoryProficiency,
  checkProjectRoot,
  checkSecondBrainModel,
} from './doctor-memory-checks.js';
export {
  checkMonoesMemory,
  checkMonograph,
  checkMonographFreshness,
  checkMonographSemantic,
} from './doctor-monograph-checks.js';
export { checkAgentRegistry, checkMonoesIntegration } from './doctor-routing-checks.js';
export { checkMetricsFreshness, checkSecurityAuditFindings } from './doctor-worker-checks.js';

export type { HealthCheck };

export async function checkConfigFile(): Promise<HealthCheck> {
  const jsonPaths = CONFIG_JSON_CANDIDATE_PATHS;
  for (const configPath of jsonPaths) {
    if (existsSync(configPath) && statSync(configPath).size <= MAX_DOCTOR_CONFIG_BYTES) {
      try {
        JSON.parse(readFileSync(configPath, 'utf8'));
        return { name: 'Config File', status: 'pass', message: `Found: ${configPath}` };
      } catch {
        return {
          name: 'Config File',
          status: 'fail',
          message: `Invalid JSON: ${configPath}`,
          fix: 'Fix JSON syntax in config file',
        };
      }
    }
  }
  const yamlPaths = CONFIG_YAML_CANDIDATE_PATHS;
  for (const configPath of yamlPaths) {
    if (existsSync(configPath))
      return { name: 'Config File', status: 'pass', message: `Found: ${configPath}` };
  }
  return {
    name: 'Config File',
    status: 'warn',
    message: 'No config file (using defaults)',
    fix: 'monomind config init',
  };
}

export async function checkApiKeys(): Promise<HealthCheck> {
  const keys = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'OPENAI_API_KEY'];
  const found = keys.filter((k) => process.env[k]);
  const inClaudeCode = !!(
    process.env.CLAUDE_CODE ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.MCP_SESSION_ID
  );
  let claudeCliAvailable = false;
  try {
    execSync('claude --version', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
      windowsHide: true,
    });
    claudeCliAvailable = true;
  } catch {
    /* not on PATH */
  }

  if (found.includes('ANTHROPIC_API_KEY') || found.includes('CLAUDE_API_KEY')) {
    return { name: 'API Keys', status: 'pass', message: `Found: ${found.join(', ')}` };
  } else if (inClaudeCode) {
    return {
      name: 'API Keys',
      status: 'pass',
      message: 'Claude Code manages auth (no direct API key needed)',
    };
  } else if (claudeCliAvailable) {
    return {
      name: 'API Keys',
      status: 'pass',
      message: 'Using Claude Code CLI auth (no direct API key needed)',
    };
  } else if (found.length > 0) {
    return {
      name: 'API Keys',
      status: 'warn',
      message: `Found: ${found.join(', ')} (no Claude key)`,
      fix: 'export ANTHROPIC_API_KEY=...',
    };
  }
  return {
    name: 'API Keys',
    status: 'warn',
    message: 'Claude Code CLI not found — monomind works best on top of Claude Code',
    fix: 'npm install -g @anthropic-ai/claude-code  # then: claude login',
  };
}

export interface McpCheckOptions {
  /**
   * Actually start the configured monomind server and speak `initialize`
   * (i-312). Off by default: the plain `monomind doctor` run must not spawn a
   * subprocess — with an `npx`-based entry that can mean a package download —
   * on every invocation. `doctor -c mcp` opts in.
   */
  probe?: boolean;
  /** Probe budget; defaults to MCP_PROBE_TIMEOUT_MS. */
  timeoutMs?: number;
}

export async function checkMcpServers(options: McpCheckOptions = {}): Promise<HealthCheck> {
  const mcpConfigPaths = [
    join(homedir(), '.claude/claude_desktop_config.json'),
    join(homedir(), '.config/claude/mcp.json'),
    '.mcp.json',
    '.claude/settings.json',
    '.claude/settings.local.json',
    join(homedir(), '.claude/settings.json'),
  ];
  for (const configPath of mcpConfigPaths) {
    if (existsSync(configPath) && statSync(configPath).size <= MAX_DOCTOR_CONFIG_BYTES) {
      try {
        const content = JSON.parse(readFileSync(configPath, 'utf8'));
        const servers = content.mcpServers || content.servers || {};
        const count = Object.keys(servers).length;
        const hasMonomind = 'monomind' in servers || 'monomind_alpha' in servers;
        if (hasMonomind) {
          if (options.probe)
            return await probeConfiguredMcpServer(
              servers.monomind ?? servers.monomind_alpha,
              count,
              configPath,
              options.timeoutMs,
            );
          return {
            name: 'MCP Servers',
            status: 'pass',
            message: `${count} servers (monomind configured)`,
          };
        }
        return {
          name: 'MCP Servers',
          status: 'warn',
          message: `${count} servers (monomind not found)`,
          fix: mcpAddHint(),
        };
      } catch {
        /* try next */
      }
    }
  }
  return {
    name: 'MCP Servers',
    status: 'warn',
    message: 'No MCP config found',
    fix: mcpAddHint(),
  };
}

/**
 * i-312: start the configured monomind server and wait for its `initialize`
 * answer, so a registered-but-unstartable entry cannot report a pass.
 */
async function probeConfiguredMcpServer(
  entry: unknown,
  count: number,
  configPath: string,
  timeoutMs?: number,
): Promise<HealthCheck> {
  const server = (entry ?? {}) as { command?: unknown; args?: unknown; env?: unknown };
  if (typeof server.command !== 'string' || server.command.length === 0)
    return {
      name: 'MCP Servers',
      status: 'pass',
      message: `${count} servers (monomind configured; no stdio command in ${configPath} — not probed)`,
    };

  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const commandLine = [server.command, ...args].join(' ');
  const { MCP_PROBE_TIMEOUT_MS, probeMcpServer } = await import('./doctor-mcp-probe.js');
  const budget = timeoutMs ?? MCP_PROBE_TIMEOUT_MS;
  const result = await probeMcpServer({
    command: server.command,
    args,
    env:
      server.env && typeof server.env === 'object'
        ? (server.env as Record<string, string>)
        : undefined,
    timeoutMs: budget,
  });

  if (result.outcome === 'ok')
    return {
      name: 'MCP Servers',
      status: 'pass',
      message: `${count} servers (monomind answers initialize in ${result.elapsedMs}ms)`,
    };

  if (result.outcome === 'timeout')
    // Not a failure: a cold `npx` fetch of the server package takes far longer
    // than any budget doctor can spend. Say "unknown", not "broken".
    return {
      name: 'MCP Servers',
      status: 'warn',
      message: `monomind MCP server did not answer initialize within ${budget}ms — may still be fetching packages (cold npx)`,
      fix: `Run it once by hand to warm the cache, then re-run: ${commandLine}`,
    };

  const cause = result.stderr || `exited with code ${result.exitCode ?? 'unknown'}`;
  return {
    name: 'MCP Servers',
    status: 'fail',
    message: `monomind MCP server failed to start (${configPath}): ${cause}`,
    fix: `Run it by hand to confirm: ${commandLine}  # a pinned scoped package needs: npx -y --package=@monoes/monomindcli@<version> monomind mcp start`,
  };
}

/** AppleDouble sidecars (`._name`) under `.claude/`.
 *
 * macOS writes these whenever a file carrying extended attributes is copied to
 * a filesystem that cannot store them natively — exFAT, most USB/network
 * volumes. Harmless as data, but Claude Code discovers skills and commands by
 * reading `.claude/skills/` and `.claude/commands/`, and a stray
 * `._createorg.md` is registered as a real command: a garbage entry named
 * `mastermind:._createorg` appears in the roster, and its "content" is a binary
 * resource fork. They also reappear after any Finder copy, `cp`, or tar
 * extract, so a one-time delete does not hold.
 *
 * Reported here rather than swept silently, because deleting files under
 * `.claude/` should be something the operator sees. `doctor --fix` removes them.
 */
export async function checkAppleDoubleSidecars(): Promise<HealthCheck> {
  const name = 'AppleDouble Sidecars';
  const found = findAppleDoubleSidecars(process.cwd());
  if (found.length === 0) return { name, status: 'pass', message: 'None under .claude/' };
  const shown = found
    .slice(0, 3)
    .map((p) => p.replace(`${process.cwd()}/`, ''))
    .join(', ');
  return {
    name,
    status: 'warn',
    message: `${found.length} AppleDouble file${found.length === 1 ? '' : 's'} under .claude/ (${shown}${found.length > 3 ? ', …' : ''}) — skills/commands dirs register these as real entries`,
    fix: 'monomind doctor --fix (or: find .claude -name "._*" -type f -delete)',
  };
}

/** Every `._*` file under the project's `.claude/` trees. Both the repo-root
 *  tree and the npm-shipped copy under packages/, since a sidecar in the latter
 *  ships to users. */
export function findAppleDoubleSidecars(cwd: string): string[] {
  const roots = [join(cwd, '.claude'), join(cwd, 'packages', '@monomind', 'cli', '.claude')];
  const out: string[] = [];
  const walk = (dir: string, depth = 0): void => {
    if (depth > 8) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(full, depth + 1);
      else if (e.startsWith('._')) out.push(full);
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r);
  return out;
}

/** Delete every AppleDouble sidecar found. Returns how many were removed. */
export function fixAppleDoubleSidecars(cwd: string): number {
  let removed = 0;
  for (const f of findAppleDoubleSidecars(cwd)) {
    try {
      rmSync(f, { force: true });
      removed++;
    } catch {
      /* best effort */
    }
  }
  return removed;
}

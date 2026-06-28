/**
 * CLI Doctor Command
 * System diagnostics, dependency checks, config validation
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';

const MAX_DOCTOR_PKG_BYTES = 1024 * 1024;      // 1 MB — package.json / settings.json
const MAX_DOCTOR_CONFIG_BYTES = 10 * 1024 * 1024; // 10 MB — monomind.config.json / MCP configs
const MAX_DOCTOR_GITIGNORE_BYTES = 512 * 1024; // 512 KB — .gitignore
const MAX_DOCTOR_PID_BYTES = 64;               // 64 bytes — daemon PID file
const MAX_DOCTOR_HELPER_BYTES = 2 * 1024 * 1024; // 2 MB — hook helper .cjs bundles
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import { homedir } from 'os';
import { promisify } from 'util';

// Promisified exec with proper shell and env inheritance for cross-platform support
const execAsync = promisify(exec);

/**
 * Execute command asynchronously with proper environment inheritance
 * Critical for Windows where PATH may not be inherited properly
 */
async function runCommand(command: string, timeoutMs: number = 5000): Promise<string> {
  const { stdout } = await execAsync(command, {
    encoding: 'utf8' as BufferEncoding,
    timeout: timeoutMs,
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', // Use proper shell per platform
    env: { ...process.env }, // Explicitly inherit full environment
    windowsHide: true, // Hide window on Windows
  });
  return (stdout as string).trim();
}

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

// Check Node.js version
async function checkNodeVersion(): Promise<HealthCheck> {
  const requiredMajor = 20;
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  if (major >= requiredMajor) {
    return { name: 'Node.js Version', status: 'pass', message: `${version} (>= ${requiredMajor} required)` };
  } else if (major >= 18) {
    return { name: 'Node.js Version', status: 'warn', message: `${version} (>= ${requiredMajor} recommended)`, fix: 'nvm install 20 && nvm use 20' };
  } else {
    return { name: 'Node.js Version', status: 'fail', message: `${version} (>= ${requiredMajor} required)`, fix: 'nvm install 20 && nvm use 20' };
  }
}

// Check npm version (async with proper env inheritance)
async function checkNpmVersion(): Promise<HealthCheck> {
  try {
    const version = await runCommand('npm --version');
    const major = parseInt(version.split('.')[0], 10);
    if (major >= 9) {
      return { name: 'npm Version', status: 'pass', message: `v${version}` };
    } else {
      return { name: 'npm Version', status: 'warn', message: `v${version} (>= 9 recommended)`, fix: 'npm install -g npm@latest' };
    }
  } catch {
    return { name: 'npm Version', status: 'fail', message: 'npm not found', fix: 'Install Node.js from https://nodejs.org' };
  }
}

// Check config file
async function checkConfigFile(): Promise<HealthCheck> {
  // JSON configs (parse-validated)
  const jsonPaths = [
    '.monomind/config.json',
    'monomind.config.json',
    '.monomind.json'
  ];

  for (const configPath of jsonPaths) {
    if (existsSync(configPath) && statSync(configPath).size <= MAX_DOCTOR_CONFIG_BYTES) {
      try {
        const content = readFileSync(configPath, 'utf8');
        JSON.parse(content);
        return { name: 'Config File', status: 'pass', message: `Found: ${configPath}` };
      } catch (e) {
        return { name: 'Config File', status: 'fail', message: `Invalid JSON: ${configPath}`, fix: 'Fix JSON syntax in config file' };
      }
    }
  }

  // YAML configs (existence-checked only — no heavy yaml parser dependency)
  const yamlPaths = [
    '.monomind/config.yaml',
    '.monomind/config.yml',
    'monomind.config.yaml'
  ];

  for (const configPath of yamlPaths) {
    if (existsSync(configPath)) {
      return { name: 'Config File', status: 'pass', message: `Found: ${configPath}` };
    }
  }

  return { name: 'Config File', status: 'warn', message: 'No config file (using defaults)', fix: 'monomind config init' };
}

// Check daemon status
async function checkDaemonStatus(): Promise<HealthCheck> {
  try {
    const pidFile = '.monomind/daemon.pid';
    if (existsSync(pidFile) && statSync(pidFile).size <= MAX_DOCTOR_PID_BYTES) {
      const pid = readFileSync(pidFile, 'utf8').trim();
      try {
        process.kill(parseInt(pid, 10), 0); // Check if process exists
        return { name: 'Daemon Status', status: 'pass', message: `Running (PID: ${pid})` };
      } catch {
        return { name: 'Daemon Status', status: 'warn', message: 'Stale PID file', fix: 'rm .monomind/daemon.pid && monomind daemon start' };
      }
    }
    return { name: 'Daemon Status', status: 'warn', message: 'Not running', fix: 'monomind daemon start' };
  } catch {
    return { name: 'Daemon Status', status: 'warn', message: 'Unable to check', fix: 'monomind daemon status' };
  }
}

// Check memory database
async function checkMemoryDatabase(): Promise<HealthCheck> {
  const dbPaths = [
    '.monomind/memory.db',
    '.swarm/memory.db',
    'data/memory.db'
  ];

  for (const dbPath of dbPaths) {
    if (existsSync(dbPath)) {
      try {
        const stats = statSync(dbPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        return { name: 'Memory Database', status: 'pass', message: `${dbPath} (${sizeMB} MB)` };
      } catch {
        return { name: 'Memory Database', status: 'warn', message: `${dbPath} (unable to stat)` };
      }
    }
  }

  return { name: 'Memory Database', status: 'warn', message: 'Not initialized', fix: 'monomind memory configure --backend hybrid' };
}

// Check API keys
async function checkApiKeys(): Promise<HealthCheck> {
  const keys = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'OPENAI_API_KEY'];
  const found: string[] = [];

  for (const key of keys) {
    if (process.env[key]) {
      found.push(key);
    }
  }

  // Detect Claude Code environment — API keys are managed internally
  const inClaudeCode = !!(process.env.CLAUDE_CODE || process.env.CLAUDE_PROJECT_DIR || process.env.MCP_SESSION_ID);

  if (found.includes('ANTHROPIC_API_KEY') || found.includes('CLAUDE_API_KEY')) {
    return { name: 'API Keys', status: 'pass', message: `Found: ${found.join(', ')}` };
  } else if (inClaudeCode) {
    return { name: 'API Keys', status: 'pass', message: 'Claude Code (managed internally)' };
  } else if (found.length > 0) {
    return { name: 'API Keys', status: 'warn', message: `Found: ${found.join(', ')} (no Claude key)`, fix: 'export ANTHROPIC_API_KEY=your_key' };
  } else {
    return { name: 'API Keys', status: 'warn', message: 'No API keys found', fix: 'export ANTHROPIC_API_KEY=your_key' };
  }
}

// Check git (async with proper env inheritance)
async function checkGit(): Promise<HealthCheck> {
  try {
    const version = await runCommand('git --version');
    return { name: 'Git', status: 'pass', message: version.replace('git version ', 'v') };
  } catch {
    return { name: 'Git', status: 'warn', message: 'Not installed', fix: 'Install git from https://git-scm.com' };
  }
}

// Check if in git repo (async with proper env inheritance)
async function checkGitRepo(): Promise<HealthCheck> {
  try {
    await runCommand('git rev-parse --git-dir');
    return { name: 'Git Repository', status: 'pass', message: 'In a git repository' };
  } catch {
    return { name: 'Git Repository', status: 'warn', message: 'Not a git repository', fix: 'git init' };
  }
}

// Check MCP servers
async function checkMcpServers(): Promise<HealthCheck> {
  const mcpConfigPaths = [
    join(homedir(), '.claude/claude_desktop_config.json'),
    join(homedir(), '.config/claude/mcp.json'),
    '.mcp.json',
    // Claude Code local/project scope stores MCP servers in settings files
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
          return { name: 'MCP Servers', status: 'pass', message: `${count} servers (monomind configured)` };
        } else {
          return { name: 'MCP Servers', status: 'warn', message: `${count} servers (monomind not found)`, fix: 'claude mcp add monomind -- npx -y monomind@latest mcp start' };
        }
      } catch {
        // continue to next path
      }
    }
  }

  return { name: 'MCP Servers', status: 'warn', message: 'No MCP config found', fix: 'claude mcp add monomind -- npx -y monomind@latest mcp start' };
}

// Check disk space (async with proper env inheritance)
async function checkDiskSpace(): Promise<HealthCheck> {
  try {
    if (process.platform === 'win32') {
      return { name: 'Disk Space', status: 'pass', message: 'Check skipped on Windows' };
    }
    // Use df -Ph for POSIX mode (guarantees single-line output even with long device names)
    const output_str = await runCommand('df -Ph . | tail -1');
    const parts = output_str.split(/\s+/);
    // POSIX format: Filesystem Size Used Avail Capacity Mounted
    const available = parts[3];
    const usePercent = parseInt(parts[4]?.replace('%', '') || '0', 10);
    if (isNaN(usePercent)) {
      return { name: 'Disk Space', status: 'warn', message: `${available || 'unknown'} available (unable to parse usage)` };
    }

    if (usePercent > 90) {
      return { name: 'Disk Space', status: 'fail', message: `${available} available (${usePercent}% used)`, fix: 'Free up disk space' };
    } else if (usePercent > 80) {
      return { name: 'Disk Space', status: 'warn', message: `${available} available (${usePercent}% used)` };
    }
    return { name: 'Disk Space', status: 'pass', message: `${available} available` };
  } catch {
    return { name: 'Disk Space', status: 'warn', message: 'Unable to check' };
  }
}

// Check TypeScript/build (async with proper env inheritance)
async function checkBuildTools(): Promise<HealthCheck> {
  try {
    const tscVersion = await runCommand('npx tsc --version', 10000); // tsc can be slow
    if (!tscVersion || tscVersion.includes('not found')) {
      return { name: 'TypeScript', status: 'warn', message: 'Not installed locally', fix: 'npm install -D typescript' };
    }
    return { name: 'TypeScript', status: 'pass', message: tscVersion.replace('Version ', 'v') };
  } catch {
    return { name: 'TypeScript', status: 'warn', message: 'Not installed locally', fix: 'npm install -D typescript' };
  }
}

// Check for stale npx cache (version freshness)
async function checkVersionFreshness(): Promise<HealthCheck> {
  try {
    // Get current CLI version from package.json
    // Use import.meta.url to reliably locate our own package.json,
    // regardless of how deep the compiled file sits (e.g. dist/src/commands/).
    let currentVersion = '0.0.0';
    try {
      const thisFile = fileURLToPath(import.meta.url);
      let dir = dirname(thisFile);

      // Walk up from the current file's directory until we find the
      // package.json that belongs to @monomind/cli (or monomind/cli).
      // Walk until dirname(dir) === dir (filesystem root on any platform).
      for (;;) {
        const candidate = join(dir, 'package.json');
        try {
          if (existsSync(candidate) && statSync(candidate).size <= MAX_DOCTOR_PKG_BYTES) {
            const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
            if (
              pkg.version &&
              typeof pkg.name === 'string' &&
              (pkg.name === '@monomind/cli' || pkg.name === 'monomind' || pkg.name === '@monoes/monomindcli')
            ) {
              currentVersion = pkg.version;
              break;
            }
          }
        } catch {
          // Unreadable/invalid JSON -- skip and keep walking up
        }
        const parent = dirname(dir);
        if (parent === dir) break; // reached root
        dir = parent;
      }
    } catch {
      // Fall back to a default
      currentVersion = '0.0.0';
    }

    // Check if running via npx (look for _npx in process path or argv)
    const isNpx = process.argv[1]?.includes('_npx') ||
                  process.env.npm_execpath?.includes('npx') ||
                  process.cwd().includes('_npx');

    // Query npm for latest version of the published umbrella package
    let latestVersion = currentVersion;
    try {
      const npmInfo = await runCommand('npm view monomind version', 5000);
      latestVersion = npmInfo.trim();
    } catch {
      // Can't reach npm registry - skip check
      return {
        name: 'Version Freshness',
        status: 'warn',
        message: `v${currentVersion} (cannot check registry)`
      };
    }

    // Parse version numbers for comparison (handle prerelease like 3.0.0-alpha.84)
    const parseVersion = (v: string): { major: number; minor: number; patch: number; prerelease: number } => {
      const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z]+\.(\d+))?/);
      if (!match) return { major: 0, minor: 0, patch: 0, prerelease: 0 };
      return {
        major: parseInt(match[1], 10) || 0,
        minor: parseInt(match[2], 10) || 0,
        patch: parseInt(match[3], 10) || 0,
        prerelease: parseInt(match[4], 10) || 0
      };
    };

    const current = parseVersion(currentVersion);
    const latest = parseVersion(latestVersion);

    // Compare versions (including prerelease number)
    const isOutdated = (
      latest.major > current.major ||
      (latest.major === current.major && latest.minor > current.minor) ||
      (latest.major === current.major && latest.minor === current.minor && latest.patch > current.patch) ||
      (latest.major === current.major && latest.minor === current.minor && latest.patch === current.patch && latest.prerelease > current.prerelease)
    );

    if (isOutdated) {
      const fix = isNpx
        ? 'rm -rf ~/.npm/_npx/* && npx -y monomind@latest doctor'
        : 'npm update -g monomind';

      return {
        name: 'Version Freshness',
        status: 'warn',
        message: `v${currentVersion} (latest: v${latestVersion})${isNpx ? ' [npx cache stale]' : ''}`,
        fix
      };
    }

    return {
      name: 'Version Freshness',
      status: 'pass',
      message: `v${currentVersion} (up to date)`
    };
  } catch (error) {
    return {
      name: 'Version Freshness',
      status: 'warn',
      message: 'Unable to check version freshness'
    };
  }
}

// Check Claude Code CLI (async with proper env inheritance)
async function checkClaudeCode(): Promise<HealthCheck> {
  try {
    const version = await runCommand('claude --version');
    // Parse version from output like "claude 1.0.0" or "Claude Code v1.0.0"
    const versionMatch = version.match(/v?(\d+\.\d+\.\d+)/);
    const versionStr = versionMatch ? `v${versionMatch[1]}` : version;
    return { name: 'Claude Code CLI', status: 'pass', message: versionStr };
  } catch {
    return {
      name: 'Claude Code CLI',
      status: 'warn',
      message: 'Not installed',
      fix: 'npm install -g @anthropic-ai/claude-code'
    };
  }
}

// Install Claude Code CLI
async function installClaudeCode(): Promise<boolean> {
  try {
    output.writeln();
    output.writeln(output.bold('Installing Claude Code CLI...'));
    execSync('npm install -g @anthropic-ai/claude-code', {
      encoding: 'utf8',
      stdio: 'inherit'
    });
    output.writeln(output.success('Claude Code CLI installed successfully!'));
    return true;
  } catch (error) {
    output.writeln(output.error('Failed to install Claude Code CLI'));
    if (error instanceof Error) {
      output.writeln(output.dim(error.message));
    }
    return false;
  }
}

// Check monograph (TypeScript knowledge graph engine, bundled with CLI)
async function checkMonograph(): Promise<HealthCheck> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const _base = dirname(__filename);
    let _globalRoot = '';
    try { _globalRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 3000 }).trim(); } catch { /* no npm */ }
    const candidates = [
      // local dev monorepo paths (both old @monomind and published @monoes scope)
      join(_base, '..', '..', 'node_modules', '@monomind', 'monograph', 'package.json'),
      join(_base, '..', '..', '..', '..', 'node_modules', '@monomind', 'monograph', 'package.json'),
      join(_base, '..', '..', 'node_modules', '@monoes', 'monograph', 'package.json'),
      join(_base, '..', '..', '..', '..', 'node_modules', '@monoes', 'monograph', 'package.json'),
      // global install paths
      ...(_globalRoot ? [
        join(_globalRoot, '@monomind', 'monograph', 'package.json'),
        join(_globalRoot, '@monoes', 'monograph', 'package.json'),
      ] : []),
    ];
    const found = candidates.find(p => existsSync(p) && statSync(p).size <= MAX_DOCTOR_PKG_BYTES);
    if (found) {
      try {
        const pkg = JSON.parse(readFileSync(found, 'utf-8'));
        return { name: 'Monograph', status: 'pass', message: `v${pkg.version || '?'} available (knowledge graph engine)` };
      } catch {
        return { name: 'Monograph', status: 'pass', message: 'available (knowledge graph engine)' };
      }
    }
    return {
      name: 'Monograph',
      status: 'warn',
      message: 'Package not found (knowledge graph disabled)',
      fix: 'npm install -g monomind@latest  # reinstall to get @monoes/monograph'
    };
  } catch {
    return {
      name: 'Monograph',
      status: 'warn',
      message: 'Package check failed (knowledge graph may be unavailable)',
      fix: 'npm install -g monomind@latest'
    };
  }
}

// Check monograph graph freshness (is the graph built? how stale?)
async function checkMonographFreshness(): Promise<HealthCheck> {
  try {
    const cwd = process.cwd();
    const dbPath = join(cwd, '.monomind', 'monograph.db');
    const lockPath = join(cwd, '.monomind', 'graph', '.rebuild-lock');
    const statsPath = join(cwd, '.monomind', 'graph', 'stats.json');

    // Check if graph exists at all
    const hasDb = existsSync(dbPath);
    const hasLock = existsSync(lockPath);
    const hasStats = existsSync(statsPath);

    if (!hasDb && !hasStats) {
      return {
        name: 'Graph freshness',
        status: 'warn',
        message: 'No monograph graph built yet',
        fix: 'mcp__monomind__monograph_build codeOnly:true  — or run npx monomind@latest hooks graph-status',
      };
    }

    // Determine last build time
    let buildMs = 0;
    if (hasDb) { try { buildMs = Math.max(buildMs, statSync(dbPath).mtimeMs); } catch { /* ignore */ } }
    if (hasLock) { try { buildMs = Math.max(buildMs, statSync(lockPath).mtimeMs); } catch { /* ignore */ } }
    if (hasStats) { try { buildMs = Math.max(buildMs, statSync(statsPath).mtimeMs); } catch { /* ignore */ } }

    if (buildMs === 0) {
      return { name: 'Graph freshness', status: 'warn', message: 'Graph exists but build time unknown' };
    }

    // Count commits since last build
    const buildIso = new Date(buildMs).toISOString();
    let commitsBehind = 0;
    try {
      const out = execSync(`git rev-list --count --since='${buildIso}' HEAD 2>/dev/null`, {
        encoding: 'utf8', timeout: 2000, cwd,
      }).trim();
      commitsBehind = parseInt(out, 10) || 0;
    } catch { /* git not available or not a git repo */ }

    const ageMinutes = Math.floor((Date.now() - buildMs) / 60000);
    const ageStr = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ago`;

    if (commitsBehind === 0) {
      return { name: 'Graph freshness', status: 'pass', message: `FRESH — built ${ageStr}, 0 commits behind` };
    } else if (commitsBehind <= 5) {
      return {
        name: 'Graph freshness',
        status: 'warn',
        message: `${commitsBehind} commit(s) behind — built ${ageStr}`,
        fix: 'mcp__monomind__monograph_build codeOnly:true',
      };
    } else {
      return {
        name: 'Graph freshness',
        status: 'fail',
        message: `STALE — ${commitsBehind} commits behind (built ${ageStr})`,
        fix: 'mcp__monomind__monograph_build codeOnly:true',
      };
    }
  } catch {
    return { name: 'Graph freshness', status: 'warn', message: 'Could not check graph freshness' };
  }
}

// Check @monoes/memory (optional HNSW vector search package)
async function checkMonoesMemory(): Promise<HealthCheck> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const _base = dirname(__filename);
    let _globalRoot = '';
    try { _globalRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 3000 }).trim(); } catch { /* no npm */ }
    const candidates = [
      join(_base, '..', '..', 'node_modules', '@monoes', 'memory', 'package.json'),
      join(_base, '..', '..', '..', '..', 'node_modules', '@monoes', 'memory', 'package.json'),
      ...(_globalRoot ? [join(_globalRoot, '@monoes', 'memory', 'package.json')] : []),
    ];
    const found = candidates.find(p => existsSync(p) && statSync(p).size <= MAX_DOCTOR_PKG_BYTES);
    if (found) {
      try {
        const pkg = JSON.parse(readFileSync(found, 'utf-8'));
        return { name: 'Vector Memory', status: 'pass', message: `@monoes/memory v${pkg.version || '?'} (HNSW search enabled)` };
      } catch {
        return { name: 'Vector Memory', status: 'pass', message: '@monoes/memory available (HNSW search enabled)' };
      }
    }
    return {
      name: 'Vector Memory',
      status: 'warn',
      message: '@monoes/memory not installed (vector search disabled — using fallback)',
      fix: 'npm install @monoes/memory'
    };
  } catch {
    return { name: 'Vector Memory', status: 'warn', message: 'Vector memory check failed' };
  }
}

// Resolve the path to the bundled (npm-installed) copy of a helper file.
// Walks up from this module's location to find the package root, then joins
// the relative path. Returns null if not found.
function _resolveBundledHelper(relativePath: string): string | null {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    let dir = dirname(thisFile);
    for (;;) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate) && statSync(candidate).size <= MAX_DOCTOR_PKG_BYTES) {
        try {
          const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
          if (pkg.name === '@monomind/cli' || pkg.name === 'monomind' || pkg.name === '@monoes/monomindcli') {
            const helperPath = join(dir, relativePath);
            return existsSync(helperPath) ? helperPath : null;
          }
        } catch { /* keep walking */ }
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch { return null; }
}

// Compare per-project helper file content vs the bundled (npm) version.
// Returns the list of files that drifted.
async function _detectStaleHelpers(): Promise<{ stale: string[]; missing: string[]; }> {
  const stale: string[] = [];
  const missing: string[] = [];
  const helpers = ['hook-handler.cjs', 'statusline.cjs', 'router.cjs', 'graphify-freshen.cjs'];
  const crypto = await import('node:crypto');
  for (const name of helpers) {
    const local = join(process.cwd(), '.claude', 'helpers', name);
    if (!existsSync(local)) continue;
    if (statSync(local).size > MAX_DOCTOR_HELPER_BYTES) continue; // skip oversized helper
    const bundled = _resolveBundledHelper(join('.claude', 'helpers', name));
    if (!bundled) { missing.push(name); continue; }
    if (statSync(bundled).size > MAX_DOCTOR_HELPER_BYTES) continue; // skip oversized bundled
    try {
      const hashLocal   = crypto.createHash('sha256').update(readFileSync(local)).digest('hex');
      const hashBundled = crypto.createHash('sha256').update(readFileSync(bundled)).digest('hex');
      if (hashLocal !== hashBundled) stale.push(name);
    } catch { /* skip */ }
  }
  return { stale, missing };
}

async function checkHelpersFresh(): Promise<HealthCheck> {
  try {
    const { stale, missing } = await _detectStaleHelpers();
    if (stale.length === 0 && missing.length === 0) {
      return { name: 'Helper Files', status: 'pass', message: 'Project helpers match bundled version' };
    }
    if (stale.length > 0) {
      return {
        name: 'Helper Files',
        status: 'warn',
        message: `${stale.length} stale helper(s) in .claude/helpers/: ${stale.join(', ')}`,
        fix: 'monomind init upgrade',
      };
    }
    return {
      name: 'Helper Files',
      status: 'warn',
      message: `Could not locate bundled copies of: ${missing.join(', ')}`,
      fix: 'Reinstall monomind or run `monomind init upgrade`',
    };
  } catch (e) {
    return { name: 'Helper Files', status: 'warn', message: `check failed: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}


// Check @monoes native acceleration integration (sona/router/attention/learning-wasm)
// Format a 0..1 accuracy as a whole-percent string, or 'n/a' when null.
function fmtPct(v: number | null): string {
  return v === null ? 'n/a' : `${Math.round(v * 100)}%`;
}

// Render the windowed routing-accuracy metric (C1) as a one-line summary.
// Tells an operator whether routing learning is actually helping.
async function routingAccuracyLine(): Promise<string> {
  try {
    const { computeRoutingAccuracy, computeAdherence } = await import('../monovector/route-outcomes.js');
    const baseDir = join(process.cwd(), '.monomind');
    const acc = await computeRoutingAccuracy(baseDir, 100);
    const adh = await computeAdherence(baseDir);
    const adhStr = ` | adherence ${fmtPct(adh.adherence)} (n=${adh.sample})`;
    if (acc.accuracy === null) {
      return `routing accuracy (last 100): no outcome data yet${adhStr}`;
    }
    const trend = acc.recentVsPrior === null
      ? ''
      : ` trend ${acc.recentVsPrior >= 0 ? '+' : ''}${Math.round(acc.recentVsPrior * 100)}%`;
    return `routing accuracy (last ${acc.window}): ${fmtPct(acc.accuracy)} ` +
      `[native ${fmtPct(acc.byMode.native)} / js ${fmtPct(acc.byMode.js)}]${trend}${adhStr}`;
  } catch {
    return 'routing accuracy (last 100): no outcome data yet';
  }
}

// Lean teardown: the native @monoes acceleration matrix (sona/router/attention/
// learning-wasm) has been removed. This check now reports only the honest routing
// learning metric — the windowed recommendation→outcome accuracy and adherence,
// which is the lean system's measurable signal.
async function checkMonoesIntegration(): Promise<HealthCheck> {
  try {
    const accLine = await routingAccuracyLine();
    return {
      name: 'Routing Learning',
      status: 'pass',
      message: accLine,
    };
  } catch (err) {
    return {
      name: 'Routing Learning',
      status: 'warn',
      message: `Could not compute routing accuracy: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Patterns that must be covered by .gitignore to prevent leaking session data / machine paths.
// Uses the surgical approach: ignore specific sensitive subdirs and file globs inside .monomind/
// rather than the entire directory, so safe content (orgs/, test-fixtures/) can still be tracked.
const REQUIRED_GITIGNORE_PATTERNS = [
  { pattern: '.monomind/sessions/', reason: 'session files contain cwd and machine paths' },
  { pattern: '.monomind/data/', reason: 'intelligence data with edit file paths' },
  { pattern: '.monomind/metrics/', reason: 'metrics with file path references' },
  { pattern: '.monomind/knowledge/', reason: 'knowledge chunks with local file content' },
  { pattern: '.monomind/*.json', reason: 'root-level runtime JSON (control, registry, routing)' },
  { pattern: '.monomind/*.jsonl', reason: 'root-level event logs (decisions, routing-feedback)' },
  { pattern: '**/.monomind/sessions/', reason: 'nested session files in sub-packages' },
  { pattern: '**/.monomind/*.json', reason: 'nested runtime JSON in sub-packages' },
  { pattern: 'data/sessions/', reason: 'session files with machine paths' },
  { pattern: 'data/mastermind-*.json', reason: 'mastermind session data' },
  { pattern: 'data/mastermind-*.jsonl', reason: 'mastermind event logs' },
  { pattern: '**/.claude-flow/', reason: 'claude-flow runtime data with paths' },
  { pattern: '.hive-mind/', reason: 'hive-mind state with session info' },
  { pattern: '.swarm/', reason: 'swarm state files' },
];

// Check whether a gitignore file covers all required monomind runtime patterns
async function checkGitignoreCoverage(): Promise<HealthCheck> {
  const gitignorePath = join(process.cwd(), '.gitignore');
  if (!existsSync(gitignorePath)) {
    return {
      name: 'Gitignore Coverage',
      status: 'warn',
      message: 'No .gitignore found — all monomind runtime paths are unprotected',
      fix: 'echo ".monomind/\\n**/.monomind/" >> .gitignore',
    };
  }

  if (statSync(gitignorePath).size > MAX_DOCTOR_GITIGNORE_BYTES) {
    return { name: 'Gitignore Coverage', status: 'warn', message: '.gitignore too large to parse' };
  }
  const content = readFileSync(gitignorePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  const missing = REQUIRED_GITIGNORE_PATTERNS.filter(({ pattern }) => {
    // A pattern is "covered" if the gitignore contains it exactly, or a parent glob covers it
    const base = pattern.replace(/\*\*\//g, '').replace(/\*/g, '');
    return !lines.some(l =>
      l === pattern ||
      l === pattern.replace(/\/$/, '') ||
      // e.g. "**/.monomind/" covers ".monomind/"
      (l.includes('**') && base && l.replace(/\*\*\//g, '').replace(/\*/g, '') === base)
    );
  });

  if (missing.length === 0) {
    return { name: 'Gitignore Coverage', status: 'pass', message: 'All monomind runtime paths are gitignored' };
  }

  const missingList = missing.map(m => m.pattern).join(', ');
  const fixLines = missing.map(m => m.pattern).join('\\n');
  return {
    name: 'Gitignore Coverage',
    status: 'warn',
    message: `${missing.length} runtime path(s) not in .gitignore: ${missingList}`,
    fix: `printf "${fixLines}\\n" >> .gitignore`,
  };
}

async function checkGuidanceGates(): Promise<HealthCheck> {
  const settingsPath = join(process.cwd(), '.claude', 'settings.json');
  const gatesHandlerPath = join(process.cwd(), '.claude', 'helpers', 'handlers', 'gates-handler.cjs');

  if (!existsSync(gatesHandlerPath)) {
    return {
      name: 'Guidance Gates',
      status: 'warn',
      message: 'gates-handler.cjs not found — enforcement gates not installed',
      fix: 'monomind init  (then monomind guidance setup)',
    };
  }

  if (!existsSync(settingsPath)) {
    return {
      name: 'Guidance Gates',
      status: 'warn',
      message: 'gates-handler.cjs present but .claude/settings.json missing — pre-write hook not registered',
      fix: 'monomind guidance setup',
    };
  }

  try {
    if (statSync(settingsPath).size > MAX_DOCTOR_CONFIG_BYTES) {
      return { name: 'Guidance Gates', status: 'warn', message: 'settings.json too large to parse' };
    }
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const preToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> =
      settings?.hooks?.PreToolUse ?? [];
    const hasPreWrite = preToolUse.some(
      e => e.matcher === 'Write|Edit|MultiEdit' && e.hooks.some(h => h.command?.includes('pre-write'))
    );
    const hasPreBash = preToolUse.some(
      e => e.matcher === 'Bash' && e.hooks.some(h => h.command?.includes('pre-bash'))
    );

    if (!hasPreWrite && !hasPreBash) {
      return {
        name: 'Guidance Gates',
        status: 'warn',
        message: 'gates-handler.cjs present but neither pre-bash nor pre-write hooks registered — no gates active',
        fix: 'monomind guidance setup',
      };
    }
    if (!hasPreWrite) {
      return {
        name: 'Guidance Gates',
        status: 'warn',
        message: 'gates-handler.cjs present but pre-write hook not in settings.json — secrets gate inactive',
        fix: 'monomind guidance setup',
      };
    }
    if (!hasPreBash) {
      return {
        name: 'Guidance Gates',
        status: 'warn',
        message: 'gates-handler.cjs present but pre-bash hook not in settings.json — destructive-ops gate inactive',
        fix: 'monomind guidance setup',
      };
    }

    return {
      name: 'Guidance Gates',
      status: 'pass',
      message: 'destructive-ops (pre-bash) + secrets (pre-write) gates active',
    };
  } catch {
    return {
      name: 'Guidance Gates',
      status: 'warn',
      message: 'Could not parse .claude/settings.json',
      fix: 'monomind guidance setup --force',
    };
  }
}

// Format health check result
function formatCheck(check: HealthCheck): string {
  const icon = check.status === 'pass' ? output.success('✓') :
               check.status === 'warn' ? output.warning('⚠') :
               output.error('✗');
  return `${icon} ${check.name}: ${check.message}`;
}

// Main doctor command
export const doctorCommand: Command = {
  name: 'doctor',
  description: 'System diagnostics and health checks',
  options: [
    {
      name: 'fix',
      short: 'f',
      description: 'Show fix commands for issues',
      type: 'boolean',
      default: false
    },
    {
      name: 'install',
      short: 'i',
      description: 'Auto-install missing dependencies (Claude Code CLI)',
      type: 'boolean',
      default: false
    },
    {
      name: 'component',
      short: 'c',
      description: 'Check specific component (version, node, npm, config, daemon, memory, api, git, mcp, claude, disk, typescript, monograph, graph-freshness, memory-pkg, helpers, monoes, gates, gitignore)',
      type: 'string'
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Verbose output',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind doctor', description: 'Run full health check' },
    { command: 'monomind doctor --fix', description: 'Show fixes for issues' },
    { command: 'monomind doctor --install', description: 'Auto-install missing dependencies' },
    { command: 'monomind doctor -c version', description: 'Check for stale npx cache' },
    { command: 'monomind doctor -c claude', description: 'Check Claude Code CLI only' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showFix = ctx.flags.fix as boolean;
    const autoInstall = ctx.flags.install as boolean;
    const component = ctx.flags.component as string;
    const verbose = ctx.flags.verbose as boolean;

    output.writeln();
    output.writeln(output.bold('MonoMind Doctor'));
    output.writeln(output.dim('System diagnostics and health check'));
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const allChecks: (() => Promise<HealthCheck>)[] = [
      checkVersionFreshness,
      checkNodeVersion,
      checkNpmVersion,
      checkClaudeCode,
      checkGit,
      checkGitRepo,
      checkConfigFile,
      checkDaemonStatus,
      checkMemoryDatabase,
      checkApiKeys,
      checkMcpServers,
      checkDiskSpace,
      checkBuildTools,
      checkMonograph,
      checkMonographFreshness,
      checkMonoesMemory,
      checkHelpersFresh,
      checkMonoesIntegration,
      checkGuidanceGates,
      checkGitignoreCoverage,
    ];

    const componentMap: Record<string, () => Promise<HealthCheck>> = {
      'version': checkVersionFreshness,
      'freshness': checkVersionFreshness,
      'node': checkNodeVersion,
      'npm': checkNpmVersion,
      'claude': checkClaudeCode,
      'config': checkConfigFile,
      'daemon': checkDaemonStatus,
      'memory': checkMemoryDatabase,
      'api': checkApiKeys,
      'git': checkGit,
      'mcp': checkMcpServers,
      'disk': checkDiskSpace,
      'typescript': checkBuildTools,
      'monograph': checkMonograph,
      'graph-freshness': checkMonographFreshness,
      'memory-pkg': checkMonoesMemory,
      'helpers': checkHelpersFresh,
      'monoes': checkMonoesIntegration,
      'gates': checkGuidanceGates,
      'gitignore': checkGitignoreCoverage,
    };

    let checksToRun = allChecks;
    if (component && componentMap[component]) {
      checksToRun = [componentMap[component]];
    }

    const results: HealthCheck[] = [];
    const fixes: string[] = [];

    // OPTIMIZATION: Run all checks in parallel for 3-5x faster execution
    const spinner = output.createSpinner({ text: 'Running health checks in parallel...', spinner: 'dots' });
    spinner.start();

    try {
      // Execute all checks concurrently
      const checkResults = await Promise.allSettled(checksToRun.map(check => check()));
      spinner.stop();

      // Process results in order
      for (const settledResult of checkResults) {
        if (settledResult.status === 'fulfilled') {
          const result = settledResult.value;
          results.push(result);
          output.writeln(formatCheck(result));

          if (result.fix && result.status === 'fail') {
            // Always show fix inline for failures — no flag needed
            output.writeln(output.dim(`  Fix: ${result.fix}`));
          } else if (result.fix && result.status === 'warn') {
            // Show fix inline for warnings too, so users don't need --fix for common issues
            output.writeln(output.dim(`  Hint: ${result.fix}`));
          }
          if (result.fix && (result.status === 'fail' || result.status === 'warn')) {
            fixes.push(`${result.name}: ${result.fix}`);
          }
        } else {
          const errorResult: HealthCheck = {
            name: 'Check',
            status: 'fail',
            message: settledResult.reason?.message || 'Unknown error'
          };
          results.push(errorResult);
          output.writeln(formatCheck(errorResult));
        }
      }
    } catch (error) {
      spinner.stop();
      output.writeln(output.error('Failed to run health checks'));
    }

    // Auto-install missing dependencies if requested
    if (autoInstall) {
      const claudeCodeResult = results.find(r => r.name === 'Claude Code CLI');
      if (claudeCodeResult && claudeCodeResult.status !== 'pass') {
        const installed = await installClaudeCode();
        if (installed) {
          const newCheck = await checkClaudeCode();
          const idx = results.findIndex(r => r.name === 'Claude Code CLI');
          if (idx !== -1) {
            results[idx] = newCheck;
            const fixIdx = fixes.findIndex(f => f.startsWith('Claude Code CLI:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') {
              fixes.splice(fixIdx, 1);
            }
          }
          output.writeln(formatCheck(newCheck));
        }
      }

    }

    // Summary
    const passed = results.filter(r => r.status === 'pass').length;
    const warnings = results.filter(r => r.status === 'warn').length;
    const failed = results.filter(r => r.status === 'fail').length;

    output.writeln();
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const summaryParts = [
      output.success(`${passed} passed`),
      warnings > 0 ? output.warning(`${warnings} warnings`) : null,
      failed > 0 ? output.error(`${failed} failed`) : null
    ].filter(Boolean);

    output.writeln(`Summary: ${summaryParts.join(', ')}`);

    // Show fixes
    if (showFix && fixes.length > 0) {
      output.writeln();
      output.writeln(output.bold('Suggested Fixes:'));
      output.writeln();
      for (const fix of fixes) {
        output.writeln(output.dim(`  ${fix}`));
      }
    } else if (!showFix) {
      // Only nudge about --fix for warnings (failures already showed their fix inline)
      const warnFixes = results.filter(r => r.status === 'warn' && r.fix).length;
      if (warnFixes > 0) {
        output.writeln();
        output.writeln(output.dim(`Run with --fix to see ${warnFixes} suggested fix${warnFixes > 1 ? 'es' : ''} for warnings`));
      }
    }

    // Overall result
    if (failed > 0) {
      output.writeln();
      output.writeln(output.error('Some checks failed. Please address the issues above.'));
      return { success: false, exitCode: 1, data: { passed, warnings, failed, results } };
    } else if (warnings > 0) {
      output.writeln();
      output.writeln(output.warning('All checks passed with some warnings.'));
      return { success: true, data: { passed, warnings, failed, results } };
    } else {
      output.writeln();
      output.writeln(output.success('All checks passed! System is healthy.'));
      return { success: true, data: { passed, warnings, failed, results } };
    }
  }
};

export default doctorCommand;

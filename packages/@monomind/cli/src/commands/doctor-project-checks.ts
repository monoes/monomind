/**
 * Doctor — project/monomind health checks
 * Config, daemon, memory, API keys, MCP, monograph, helpers, routing, gates, gitignore
 */

import { existsSync, readFileSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { homedir } from 'os';
import type { HealthCheck } from './doctor-env-checks.js';
import {
  MAX_DOCTOR_PKG_BYTES,
  MAX_DOCTOR_CONFIG_BYTES,
  MAX_DOCTOR_GITIGNORE_BYTES,
  MAX_DOCTOR_PID_BYTES,
  MAX_DOCTOR_HELPER_BYTES,
} from './doctor-env-checks.js';

export type { HealthCheck };

export async function checkConfigFile(): Promise<HealthCheck> {
  const jsonPaths = ['.monomind/config.json', 'monomind.config.json', '.monomind.json'];
  for (const configPath of jsonPaths) {
    if (existsSync(configPath) && statSync(configPath).size <= MAX_DOCTOR_CONFIG_BYTES) {
      try {
        JSON.parse(readFileSync(configPath, 'utf8'));
        return { name: 'Config File', status: 'pass', message: `Found: ${configPath}` };
      } catch {
        return { name: 'Config File', status: 'fail', message: `Invalid JSON: ${configPath}`, fix: 'Fix JSON syntax in config file' };
      }
    }
  }
  const yamlPaths = ['.monomind/config.yaml', '.monomind/config.yml', 'monomind.config.yaml'];
  for (const configPath of yamlPaths) {
    if (existsSync(configPath)) return { name: 'Config File', status: 'pass', message: `Found: ${configPath}` };
  }
  return { name: 'Config File', status: 'warn', message: 'No config file (using defaults)', fix: 'monomind config init' };
}

export async function checkDaemonStatus(): Promise<HealthCheck> {
  try {
    const pidFile = '.monomind/daemon.pid';
    if (existsSync(pidFile) && statSync(pidFile).size <= MAX_DOCTOR_PID_BYTES) {
      const pid = readFileSync(pidFile, 'utf8').trim();
      try {
        process.kill(parseInt(pid, 10), 0);
        // Stall detection: process alive but state file hasn't updated in >24h
        const stateFile = '.monomind/daemon-state.json';
        if (existsSync(stateFile)) {
          const ageMs = Date.now() - statSync(stateFile).mtimeMs;
          if (ageMs > 24 * 60 * 60 * 1000) {
            const ageH = Math.floor(ageMs / 3600000);
            return { name: 'Daemon Status', status: 'warn', message: `Running (PID: ${pid}) but daemon appears stalled (state not updated in ${ageH}h)`, fix: 'monomind daemon stop && monomind daemon start' };
          }
        }
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

export async function checkMemoryDatabase(): Promise<HealthCheck> {
  const dbPaths = ['.monomind/memory.db', '.swarm/memory.db', 'data/memory.db'];
  for (const dbPath of dbPaths) {
    if (existsSync(dbPath)) {
      try {
        const sizeMB = (statSync(dbPath).size / 1024 / 1024).toFixed(2);
        return { name: 'Memory Database', status: 'pass', message: `${dbPath} (${sizeMB} MB)` };
      } catch {
        return { name: 'Memory Database', status: 'warn', message: `${dbPath} (unable to stat)` };
      }
    }
  }
  return { name: 'Memory Database', status: 'warn', message: 'Not initialized', fix: 'monomind memory configure --backend hybrid' };
}

export async function checkApiKeys(): Promise<HealthCheck> {
  const keys = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'OPENAI_API_KEY'];
  const found = keys.filter(k => process.env[k]);
  const inClaudeCode = !!(process.env.CLAUDE_CODE || process.env.CLAUDE_PROJECT_DIR || process.env.MCP_SESSION_ID);
  let claudeCliAvailable = false;
  try {
    execSync('claude --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000, windowsHide: true });
    claudeCliAvailable = true;
  } catch { /* not on PATH */ }

  if (found.includes('ANTHROPIC_API_KEY') || found.includes('CLAUDE_API_KEY')) {
    return { name: 'API Keys', status: 'pass', message: `Found: ${found.join(', ')}` };
  } else if (inClaudeCode) {
    return { name: 'API Keys', status: 'pass', message: 'Claude Code manages auth (no direct API key needed)' };
  } else if (claudeCliAvailable) {
    return { name: 'API Keys', status: 'pass', message: 'Using Claude Code CLI auth (no direct API key needed)' };
  } else if (found.length > 0) {
    return { name: 'API Keys', status: 'warn', message: `Found: ${found.join(', ')} (no Claude key)`, fix: 'export ANTHROPIC_API_KEY=your_key' };
  }
  return {
    name: 'API Keys',
    status: 'warn',
    message: 'Claude Code CLI not found — monomind works best on top of Claude Code',
    fix: 'npm install -g @anthropic-ai/claude-code  # then: claude login',
  };
}

export async function checkMcpServers(): Promise<HealthCheck> {
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
        if (hasMonomind) return { name: 'MCP Servers', status: 'pass', message: `${count} servers (monomind configured)` };
        return { name: 'MCP Servers', status: 'warn', message: `${count} servers (monomind not found)`, fix: 'claude mcp add monomind -- npx -y monomind@latest mcp start' };
      } catch { /* try next */ }
    }
  }
  return { name: 'MCP Servers', status: 'warn', message: 'No MCP config found', fix: 'claude mcp add monomind -- npx -y monomind@latest mcp start' };
}

export async function checkMonograph(): Promise<HealthCheck> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const _base = dirname(__filename);
    let _globalRoot = '';
    try { _globalRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 3000 }).trim(); } catch { /* no npm */ }
    const candidates = [
      join(_base, '..', '..', 'node_modules', '@monomind', 'monograph', 'package.json'),
      join(_base, '..', '..', '..', '..', 'node_modules', '@monomind', 'monograph', 'package.json'),
      join(_base, '..', '..', 'node_modules', '@monoes', 'monograph', 'package.json'),
      join(_base, '..', '..', '..', '..', 'node_modules', '@monoes', 'monograph', 'package.json'),
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
    return { name: 'Monograph', status: 'warn', message: 'Package not found (knowledge graph disabled)', fix: 'npm install -g monomind@latest' };
  } catch {
    return { name: 'Monograph', status: 'warn', message: 'Package check failed', fix: 'npm install -g monomind@latest' };
  }
}

export async function checkMonographFreshness(): Promise<HealthCheck> {
  try {
    const cwd = process.cwd();
    const dbPath = join(cwd, '.monomind', 'monograph.db');
    const lockPath = join(cwd, '.monomind', 'graph', '.rebuild-lock');
    const statsPath = join(cwd, '.monomind', 'graph', 'stats.json');
    const hasDb = existsSync(dbPath);
    if (!hasDb && !existsSync(statsPath)) {
      return { name: 'Graph freshness', status: 'warn', message: 'No monograph graph built yet', fix: 'mcp__monomind__monograph_build codeOnly:true' };
    }
    let buildMs = 0;
    if (hasDb) { try { buildMs = Math.max(buildMs, statSync(dbPath).mtimeMs); } catch { /* ignore */ } }
    try { buildMs = Math.max(buildMs, statSync(lockPath).mtimeMs); } catch { /* ignore */ }
    try { buildMs = Math.max(buildMs, statSync(statsPath).mtimeMs); } catch { /* ignore */ }
    if (buildMs === 0) return { name: 'Graph freshness', status: 'warn', message: 'Graph exists but build time unknown' };

    const buildIso = new Date(buildMs).toISOString();
    let commitsBehind = 0;
    try {
      const out = execSync(`git rev-list --count --since='${buildIso}' HEAD 2>/dev/null`, { encoding: 'utf8', timeout: 2000, cwd }).trim();
      commitsBehind = parseInt(out, 10) || 0;
    } catch { /* git unavailable */ }

    const ageMinutes = Math.floor((Date.now() - buildMs) / 60000);
    const ageStr = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ago`;
    if (commitsBehind === 0) return { name: 'Graph freshness', status: 'pass', message: `FRESH — built ${ageStr}, 0 commits behind` };
    if (commitsBehind <= 5) return { name: 'Graph freshness', status: 'warn', message: `${commitsBehind} commit(s) behind — built ${ageStr}`, fix: 'mcp__monomind__monograph_build codeOnly:true' };
    return { name: 'Graph freshness', status: 'fail', message: `STALE — ${commitsBehind} commits behind (built ${ageStr})`, fix: 'mcp__monomind__monograph_build codeOnly:true' };
  } catch {
    return { name: 'Graph freshness', status: 'warn', message: 'Could not check graph freshness' };
  }
}

export async function checkMonoesMemory(): Promise<HealthCheck> {
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
    return { name: 'Vector Memory', status: 'warn', message: '@monoes/memory not installed (vector search disabled)', fix: 'npm install @monoes/memory' };
  } catch {
    return { name: 'Vector Memory', status: 'warn', message: 'Vector memory check failed' };
  }
}

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

async function _detectStaleHelpers(): Promise<{ stale: string[]; missing: string[] }> {
  const stale: string[] = [];
  const missing: string[] = [];
  const helpers = ['hook-handler.cjs', 'statusline.cjs', 'router.cjs', 'graphify-freshen.cjs'];
  const crypto = await import('node:crypto');
  for (const name of helpers) {
    const local = join(process.cwd(), '.claude', 'helpers', name);
    if (!existsSync(local) || statSync(local).size > MAX_DOCTOR_HELPER_BYTES) continue;
    const bundled = _resolveBundledHelper(join('.claude', 'helpers', name));
    if (!bundled) { missing.push(name); continue; }
    if (statSync(bundled).size > MAX_DOCTOR_HELPER_BYTES) continue;
    try {
      const hashLocal = crypto.createHash('sha256').update(readFileSync(local)).digest('hex');
      const hashBundled = crypto.createHash('sha256').update(readFileSync(bundled)).digest('hex');
      if (hashLocal !== hashBundled) stale.push(name);
    } catch { /* skip */ }
  }
  return { stale, missing };
}

export async function fixStaleHelpers(): Promise<boolean> {
  const { stale } = await _detectStaleHelpers();
  let fixed = 0;
  for (const name of stale) {
    const local = join(process.cwd(), '.claude', 'helpers', name);
    const bundled = _resolveBundledHelper(join('.claude', 'helpers', name));
    if (bundled) {
      try { copyFileSync(bundled, local); fixed++; } catch { /* skip */ }
    }
  }
  return fixed > 0;
}

export async function checkHelpersFresh(): Promise<HealthCheck> {
  try {
    const { stale, missing } = await _detectStaleHelpers();
    if (stale.length === 0 && missing.length === 0) {
      return { name: 'Helper Files', status: 'pass', message: 'Project helpers match bundled version' };
    }
    if (stale.length > 0) {
      return { name: 'Helper Files', status: 'warn', message: `${stale.length} stale helper(s): ${stale.join(', ')}`, fix: 'monomind init upgrade' };
    }
    return { name: 'Helper Files', status: 'warn', message: `Could not locate bundled copies of: ${missing.join(', ')}`, fix: 'Reinstall monomind or run `monomind init upgrade`' };
  } catch (e) {
    return { name: 'Helper Files', status: 'warn', message: `check failed: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

function fmtPct(v: number | null): string {
  return v === null ? 'n/a' : `${Math.round(v * 100)}%`;
}

async function routingAccuracyLine(): Promise<string> {
  try {
    const { computeRoutingAccuracy, computeAdherence } = await import('../monovector/route-outcomes.js');
    const baseDir = join(process.cwd(), '.monomind');
    const acc = await computeRoutingAccuracy(baseDir, 100);
    const adh = await computeAdherence(baseDir);
    const adhStr = ` | adherence ${fmtPct(adh.adherence)} (n=${adh.sample})`;
    if (acc.accuracy === null) return `routing accuracy (last 100): no outcome data yet${adhStr}`;
    const trend = acc.recentVsPrior === null ? '' : ` trend ${acc.recentVsPrior >= 0 ? '+' : ''}${Math.round(acc.recentVsPrior * 100)}%`;
    return `routing accuracy (last ${acc.window}): ${fmtPct(acc.accuracy)} [native ${fmtPct(acc.byMode.native)} / js ${fmtPct(acc.byMode.js)}]${trend}${adhStr}`;
  } catch {
    return 'routing accuracy (last 100): no outcome data yet';
  }
}

/** Fallback when route-outcomes.jsonl has no data: summarize .monomind/routing-feedback.jsonl honestly. */
function routingFeedbackFallback(): { message: string; degenerate: boolean } | null {
  try {
    const p = join(process.cwd(), '.monomind', 'routing-feedback.jsonl');
    if (!existsSync(p) || statSync(p).size > 512 * 1024) return null;
    const records = readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; }
    }).filter((r): r is Record<string, unknown> => r !== null);
    if (records.length === 0) return null;
    const sessions = new Set(records.map(r => r.sessionId).filter(Boolean));
    const byAgent = new Map<string, number>();
    for (const r of records) {
      const a = typeof r.suggestedAgent === 'string' ? r.suggestedAgent : 'unknown';
      byAgent.set(a, (byAgent.get(a) ?? 0) + 1);
    }
    const top = [...byAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, n]) => `${a}=${n}`).join(', ');
    const flags = records.map(r => r.intelligenceFeedback).filter((v): v is boolean => typeof v === 'boolean');
    const trueCount = flags.filter(Boolean).length;
    const base = `routing feedback (fallback): ${records.length} decisions across ${sessions.size} sessions; top agents: ${top}`;
    if (flags.length > 0 && trueCount === flags.length) {
      return { message: `${base}; success flag is degenerate (100% true — sessionSuccess heuristic never records failure)`, degenerate: true };
    }
    if (flags.length === 0) return { message: `${base}; no evidence-based success flags yet`, degenerate: true };
    return { message: `${base}; success rate ${Math.round((trueCount / flags.length) * 100)}% (n=${flags.length})`, degenerate: false };
  } catch { return null; }
}

export async function checkMonoesIntegration(): Promise<HealthCheck> {
  try {
    const line = await routingAccuracyLine();
    if (line.startsWith('routing accuracy (last 100): no outcome data yet')) {
      const fb = routingFeedbackFallback();
      if (fb) return { name: 'Routing Learning', status: fb.degenerate ? 'warn' : 'pass', message: fb.message };
    }
    return { name: 'Routing Learning', status: 'pass', message: line };
  } catch (err) {
    return { name: 'Routing Learning', status: 'warn', message: `Could not compute routing accuracy: ${err instanceof Error ? err.message : String(err)}` };
  }
}

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

export async function checkGitignoreCoverage(): Promise<HealthCheck> {
  const gitignorePath = join(process.cwd(), '.gitignore');
  if (!existsSync(gitignorePath)) {
    return { name: 'Gitignore Coverage', status: 'warn', message: 'No .gitignore found — all monomind runtime paths are unprotected', fix: 'echo ".monomind/\\n**/.monomind/" >> .gitignore' };
  }
  if (statSync(gitignorePath).size > MAX_DOCTOR_GITIGNORE_BYTES) {
    return { name: 'Gitignore Coverage', status: 'warn', message: '.gitignore too large to parse' };
  }
  const lines = readFileSync(gitignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const missing = REQUIRED_GITIGNORE_PATTERNS.filter(({ pattern }) => {
    const base = pattern.replace(/\*\*\//g, '').replace(/\*/g, '');
    return !lines.some(l =>
      l === pattern || l === pattern.replace(/\/$/, '') ||
      (l.includes('**') && base && l.replace(/\*\*\//g, '').replace(/\*/g, '') === base)
    );
  });
  if (missing.length === 0) return { name: 'Gitignore Coverage', status: 'pass', message: 'All monomind runtime paths are gitignored' };
  const missingList = missing.map(m => m.pattern).join(', ');
  return { name: 'Gitignore Coverage', status: 'warn', message: `${missing.length} runtime path(s) not in .gitignore: ${missingList}`, fix: `printf "${missing.map(m => m.pattern).join('\\n')}\\n" >> .gitignore` };
}

export async function checkAgentRegistry(): Promise<HealthCheck> {
  try {
    const { buildUnifiedRegistry, computeAgentRoots } = await import('../agents/registry-builder.js');
    const cwd = process.cwd();
    const roots = computeAgentRoots(cwd);
    const outDir = join(cwd, '.monomind');
    mkdirSync(outDir, { recursive: true });
    // Rebuilds fresh in-memory (and refreshes .monomind/registry.json on disk)
    // rather than reading a file that a separate, unawaited startup task also
    // writes — avoids reporting stale results from a race between the two.
    const registry = buildUnifiedRegistry(roots, join(outDir, 'registry.json'));
    const entries = registry.agents;
    if (entries.length === 0) {
      return { name: 'Agent Registry', status: 'warn', message: 'No agents found under .claude/agents', fix: 'monomind init  (installs agent definitions)' };
    }
    let missingSlug = 0, missingName = 0, missingDescription = 0;
    for (const agent of entries) {
      if (!agent.slug) missingSlug++;
      if (!agent.name) missingName++;
      if (!agent.description) missingDescription++;
    }
    const total = missingSlug + missingName + missingDescription;
    if (total === 0) {
      return { name: 'Agent Registry', status: 'pass', message: `${entries.length} agent(s), all metadata complete` };
    }
    const parts = [
      missingSlug > 0 ? `${missingSlug} missing slug` : null,
      missingName > 0 ? `${missingName} missing name` : null,
      missingDescription > 0 ? `${missingDescription} missing description` : null,
    ].filter(Boolean).join(', ');
    return {
      name: 'Agent Registry',
      status: 'warn',
      message: `${total} metadata issue(s) across ${entries.length} agent(s): ${parts}`,
      fix: 'Add the missing field(s) to frontmatter in .claude/agents/*.md',
    };
  } catch {
    return { name: 'Agent Registry', status: 'warn', message: 'Could not build/parse agent registry' };
  }
}

export async function checkGuidanceGates(): Promise<HealthCheck> {
  const settingsPath = join(process.cwd(), '.claude', 'settings.json');
  const gatesHandlerPath = join(process.cwd(), '.claude', 'helpers', 'handlers', 'gates-handler.cjs');
  if (!existsSync(gatesHandlerPath)) {
    return { name: 'Guidance Gates', status: 'warn', message: 'gates-handler.cjs not found — enforcement gates not installed', fix: 'monomind init  (then monomind guidance setup)' };
  }
  if (!existsSync(settingsPath)) {
    return { name: 'Guidance Gates', status: 'warn', message: 'gates-handler.cjs present but .claude/settings.json missing', fix: 'monomind guidance setup' };
  }
  try {
    if (statSync(settingsPath).size > MAX_DOCTOR_CONFIG_BYTES) {
      return { name: 'Guidance Gates', status: 'warn', message: 'settings.json too large to parse' };
    }
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const preToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> = settings?.hooks?.PreToolUse ?? [];
    const hasPreWrite = preToolUse.some(e => e.matcher === 'Write|Edit|MultiEdit' && e.hooks.some(h => h.command?.includes('pre-write')));
    const hasPreBash = preToolUse.some(e => e.matcher === 'Bash' && e.hooks.some(h => h.command?.includes('pre-bash')));
    if (!hasPreWrite && !hasPreBash) return { name: 'Guidance Gates', status: 'warn', message: 'gates-handler.cjs present but no gates registered', fix: 'monomind guidance setup' };
    if (!hasPreWrite) return { name: 'Guidance Gates', status: 'warn', message: 'pre-write hook not registered — secrets gate inactive', fix: 'monomind guidance setup' };
    if (!hasPreBash) return { name: 'Guidance Gates', status: 'warn', message: 'pre-bash hook not registered — destructive-ops gate inactive', fix: 'monomind guidance setup' };
    return { name: 'Guidance Gates', status: 'pass', message: 'destructive-ops (pre-bash) + secrets (pre-write) gates active' };
  } catch {
    return { name: 'Guidance Gates', status: 'warn', message: 'Could not parse .claude/settings.json', fix: 'monomind guidance setup --force' };
  }
}

const METRICS_FRESHNESS_MS = 60 * 60 * 1000; // 1 hour
const MAX_DOCTOR_METRICS_BYTES = 5 * 1024 * 1024;

function readMetricsJSON(name: string): unknown | null {
  try {
    const p = join(process.cwd(), '.monomind', 'metrics', name);
    if (!existsSync(p) || statSync(p).size > MAX_DOCTOR_METRICS_BYTES) return null;
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Daemon metrics freshness — flags stale (>1h) or missing worker output files
 * so a wedged/disabled daemon is visible without digging through .monomind/metrics.
 */
export async function checkMetricsFreshness(): Promise<HealthCheck> {
  const metricsDir = join(process.cwd(), '.monomind', 'metrics');
  const knownOutputs = [
    'codebase-map.json', 'security-audit.json', 'performance.json',
    'consolidation.json', 'ultralearn.json', 'deepdive.json', 'benchmark.json',
  ];
  if (!existsSync(metricsDir)) {
    return { name: 'Daemon Metrics', status: 'warn', message: 'No .monomind/metrics — daemon has not run yet', fix: 'monomind daemon start' };
  }
  const now = Date.now();
  const fresh: string[] = [];
  const stale: string[] = [];
  for (const name of knownOutputs) {
    const p = join(metricsDir, name);
    if (!existsSync(p)) continue;
    try {
      const ageMs = now - statSync(p).mtimeMs;
      if (ageMs <= METRICS_FRESHNESS_MS) fresh.push(name);
      else stale.push(name);
    } catch { /* skip unreadable */ }
  }
  if (fresh.length === 0 && stale.length === 0) {
    return { name: 'Daemon Metrics', status: 'warn', message: 'No worker output files found yet', fix: 'monomind daemon start' };
  }
  if (stale.length === 0) {
    return { name: 'Daemon Metrics', status: 'pass', message: `${fresh.length} metrics file(s) fresh (<1h)` };
  }
  return {
    name: 'Daemon Metrics',
    status: 'warn',
    message: `${stale.length} stale (>1h): ${stale.join(', ')}${fresh.length > 0 ? ` — ${fresh.length} fresh` : ''}`,
    fix: 'monomind daemon status  # or: monomind daemon trigger -w <worker>',
  };
}

/**
 * Surfaces critical findings from the security-audit daemon worker output.
 */
export async function checkSecurityAuditFindings(): Promise<HealthCheck> {
  const audit = readMetricsJSON('security-audit.json') as {
    riskLevel?: string;
    recommendations?: string[];
    priorityScanTargets?: Array<{ file: string; reason?: string }>;
    timestamp?: string;
  } | null;

  if (!audit) {
    return { name: 'Security Audit', status: 'warn', message: 'No security-audit.json yet', fix: 'monomind daemon trigger -w audit' };
  }

  const riskLevel = (audit.riskLevel || 'low').toLowerCase();
  const recommendations = audit.recommendations || [];
  const priorityTargets = audit.priorityScanTargets || [];
  const criticalCount = recommendations.length + (riskLevel === 'high' || riskLevel === 'critical' ? priorityTargets.length : 0);

  if (riskLevel === 'critical' || riskLevel === 'high') {
    return {
      name: 'Security Audit',
      status: 'fail',
      message: `risk=${riskLevel}, ${criticalCount} critical finding(s) — ${priorityTargets.length} priority scan target(s)`,
      fix: 'Review .monomind/metrics/security-audit.json priorityScanTargets and recommendations',
    };
  }
  if (recommendations.length > 0) {
    return { name: 'Security Audit', status: 'warn', message: `risk=${riskLevel}, ${recommendations.length} recommendation(s)` };
  }
  return { name: 'Security Audit', status: 'pass', message: `risk=${riskLevel}, no open findings` };
}

/**
 * Flags uncovered critical paths surfaced by the testgaps worker (headless-only —
 * gracefully reports "not run" when the local daemon has no fallback for this worker).
 */
export async function checkTestGaps(): Promise<HealthCheck> {
  const gaps = readMetricsJSON('testgaps.json') as {
    gaps?: Array<{ file?: string; critical?: boolean }>;
    uncoveredCount?: number;
    note?: string;
  } | null;

  if (!gaps) {
    return { name: 'Test Coverage Gaps', status: 'warn', message: 'No testgaps.json yet (requires Claude Code CLI for AI analysis)', fix: 'monomind daemon trigger -w testgaps' };
  }
  if (gaps.note && !gaps.gaps && gaps.uncoveredCount === undefined) {
    return { name: 'Test Coverage Gaps', status: 'warn', message: gaps.note };
  }

  const gapList = Array.isArray(gaps.gaps) ? gaps.gaps : [];
  const uncovered = gaps.uncoveredCount ?? gapList.length;
  const criticalGaps = gapList.filter(g => g?.critical).length;

  if (criticalGaps > 0) {
    return { name: 'Test Coverage Gaps', status: 'fail', message: `${uncovered} uncovered area(s), ${criticalGaps} critical path(s) untested`, fix: 'Review .monomind/metrics/testgaps.json' };
  }
  if (uncovered > 0) {
    return { name: 'Test Coverage Gaps', status: 'warn', message: `${uncovered} uncovered area(s)` };
  }
  return { name: 'Test Coverage Gaps', status: 'pass', message: 'No uncovered areas reported' };
}

/**
 * AutoMem proficiency check — reports memory learning health
 */
export async function checkMemoryProficiency(): Promise<HealthCheck> {
  try {
    const intelligenceMod = await import('../memory/intelligence.js');
    const stats = intelligenceMod.getMemoryProficiencyStats();
    const bankStats = intelligenceMod.getIntelligenceStats();

    if (stats.totalDecisions === 0) {
      return {
        name: 'Memory Proficiency',
        status: 'pass',
        message: 'AutoMem active — no decisions recorded yet (builds up over sessions)',
      };
    }

    const successPct = Math.round(stats.successRate * 100);
    const hitPct = Math.round(stats.patternHitRate * 100);
    const msg = `${stats.totalDecisions} decisions, ${successPct}% success, ${stats.proficiencyPatterns} patterns, ${hitPct}% hit rate (bank: ${bankStats.patternsLearned} total)`;

    if (stats.successRate < 0.5) {
      return { name: 'Memory Proficiency', status: 'warn', message: msg };
    }
    return { name: 'Memory Proficiency', status: 'pass', message: msg };
  } catch {
    return { name: 'Memory Proficiency', status: 'warn', message: 'Could not load intelligence module' };
  }
}

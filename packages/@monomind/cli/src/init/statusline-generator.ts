/**
 * Statusline Configuration Generator (Optimized)
 * Creates fast, reliable statusline for V1 progress display
 *
 * Performance:
 * - Single combined git execSync call (not 8+ separate ones)
 * - process.memoryUsage() instead of ps aux
 * - No recursive test file content reading
 * - Shared settings cache
 * - Strict 2s timeouts on all shell calls
 */

import type { InitOptions } from './types.js';

/**
 * Generate optimized statusline script
 * Output format:
 * ▊ Monomind ● user  │  ⎇ branch  │  Opus 4.6 (1M context)
 * ─────────────────────────────────────────────────────
 * 🏗️  DDD Domains    [●●○○○]  2/5    ⚡ HNSW 150x
 * 🤖 Swarm  ◉ [ 5/15]  👥 2    🪝 10/17    🟢 CVE 3/3    💾 4MB    🧠  63%
 * 🔧 Architecture    ADRs ●71%  │  DDD ● 13%  │  Security ●CLEAN
 * 📊 AgentDB    Vectors ●3104⚡  │  Size 216KB  │  Tests ●6 (~24 cases)  │  MCP ●1/1
 */
export function generateStatuslineScript(options: InitOptions): string {
  const maxAgents = options.runtime.maxAgents;
  return `#!/usr/bin/env node
/**
 * Monomind V1 Statusline Generator (Optimized)
 * Displays real-time v1 implementation progress and system status
 *
 * Usage: node statusline.cjs [--json] [--compact]
 *
 * Performance notes:
 * - Single git execSync call (combines branch + status + upstream)
 * - No recursive file reading (only stat/readdir, never read test contents)
 * - No ps aux calls (uses process.memoryUsage() + file-based metrics)
 * - Strict 2s timeout on all execSync calls
 * - Shared settings cache across functions
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Configuration
const CONFIG = {
  maxAgents: ${maxAgents},
};

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Read monomind version — check global install first, then CWD package.json
function getVersion() {
  // 1. Monomind global install: script lives at <install>/packages/@monomind/cli/dist/src/init/
  //    or user project:           .claude/helpers/statusline.cjs
  //    Walk up to find a monomind package.json (has "name":"monomind" or "@monomind/cli")
  const scriptDir = path.dirname(__filename);
  const walkCandidates = [
    path.join(scriptDir, '..', '..', 'package.json'),          // dist/src -> @monomind/cli
    path.join(scriptDir, '..', '..', '..', 'package.json'),    // -> monomind umbrella
    path.join(scriptDir, '..', '..', '..', '..', 'package.json'),
  ];
  for (const p of walkCandidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.version && (pkg.name === 'monomind' || pkg.name === '@monomind/cli' || (pkg.name || '').startsWith('@monomind'))) {
        return \`v\${pkg.version}\`;
      }
    } catch { /* ignore */ }
  }
  // 2. Fallback: npm global prefix
  try {
    const { execSync } = require('child_process');
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8', timeout: 2000 }).trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(prefix, 'lib', 'node_modules', 'monomind', 'package.json'), 'utf-8'));
    if (pkg.version) return \`v\${pkg.version}\`;
  } catch { /* ignore */ }
  return 'v1.0.6';
}
const VERSION = getVersion();

// ANSI colors
const c = {
  reset: '\\x1b[0m',
  bold: '\\x1b[1m',
  dim: '\\x1b[2m',
  red: '\\x1b[0;31m',
  green: '\\x1b[0;32m',
  yellow: '\\x1b[0;33m',
  blue: '\\x1b[0;34m',
  purple: '\\x1b[0;35m',
  cyan: '\\x1b[0;36m',
  brightRed: '\\x1b[1;31m',
  brightGreen: '\\x1b[1;32m',
  brightYellow: '\\x1b[1;33m',
  brightBlue: '\\x1b[1;34m',
  brightPurple: '\\x1b[1;35m',
  brightCyan: '\\x1b[1;36m',
  brightWhite: '\\x1b[1;37m',
};

// Safe execSync with strict timeout (returns empty string on failure)
function safeExec(cmd, timeoutMs = 2000) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// Safe JSON file reader (returns null on failure)
function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

// Safe file stat (returns null on failure)
function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch { /* ignore */ }
  return null;
}

// Shared settings cache — read once, used by multiple functions
let _settingsCache = undefined;
function getSettings() {
  if (_settingsCache !== undefined) return _settingsCache;
  _settingsCache = readJSON(path.join(CWD, '.claude', 'settings.json'))
                || readJSON(path.join(CWD, '.claude', 'settings.local.json'))
                || null;
  return _settingsCache;
}

// Project identifier — github owner/repo from git remote, else folder name
function getProjectName() {
  try {
    const remote = safeExec('git remote get-url origin 2>/dev/null', 2000).trim();
    if (remote) {
      const m = remote.match(/[/:]([\\w.-]+)\\/([\\w.-]+?)(?:\\.git)?$/);
      if (m) return \`\${m[1]}/\${m[2]}\`;
    }
  } catch { /* ignore */ }
  return path.basename(CWD);
}

// ─── Data Collection (all pure-Node.js or single-exec) ──────────

// Get all git info in ONE shell call
function getGitInfo() {
  const result = {
    name: 'user', gitBranch: '', modified: 0, untracked: 0,
    staged: 0, ahead: 0, behind: 0,
  };

  // Single shell: get user.name, branch, porcelain status, and upstream diff
  const script = [
    'git config user.name 2>/dev/null || echo user',
    'echo "---SEP---"',
    'git branch --show-current 2>/dev/null',
    'echo "---SEP---"',
    'git status --porcelain 2>/dev/null',
    'echo "---SEP---"',
    'git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null || echo "0 0"',
  ].join('; ');

  const raw = safeExec(\`sh -c '\${script}'\`, 3000);
  if (!raw) return result;

  const parts = raw.split('---SEP---').map(s => s.trim());
  if (parts.length >= 4) {
    result.name = parts[0] || 'user';
    result.gitBranch = parts[1] || '';

    // Parse porcelain status
    if (parts[2]) {
      for (const line of parts[2].split('\\n')) {
        if (!line || line.length < 2) continue;
        const x = line[0], y = line[1];
        if (x === '?' && y === '?') { result.untracked++; continue; }
        if (x !== ' ' && x !== '?') result.staged++;
        if (y !== ' ' && y !== '?') result.modified++;
      }
    }

    // Parse ahead/behind
    const ab = (parts[3] || '0 0').split(/\\s+/);
    result.ahead = parseInt(ab[0]) || 0;
    result.behind = parseInt(ab[1]) || 0;
  }

  return result;
}

// Normalise a model ID string to a short display name
function modelLabel(id) {
  if (id.includes('opus'))   return 'Opus 4.6';
  if (id.includes('sonnet')) return 'Sonnet 4.6';
  if (id.includes('haiku'))  return 'Haiku 4.5';
  return id.split('-').slice(1, 3).join(' ');
}

// Read the last assistant model from the most recent session JSONL.
// Claude Code writes each assistant turn to ~/.claude/projects/<escaped-cwd>/<uuid>.jsonl
// with a "message.model" field — this is the most accurate live source and
// correctly reflects /model session overrides.
function getModelFromSessionJSONL() {
  try {
    // Escape CWD the same way Claude Code does: replace '/' with '-'
    const escaped = CWD.replace(/\\//g, '-');
    const projectsDir = path.join(os.homedir(), '.claude', 'projects', escaped);
    if (!fs.existsSync(projectsDir)) return null;

    // Most recently modified JSONL = current (or latest) session
    const files = fs.readdirSync(projectsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mt: (() => { try { return fs.statSync(path.join(projectsDir, f)).mtimeMs; } catch { return 0; } })() }))
      .sort((a, b) => b.mt - a.mt);
    if (files.length === 0) return null;

    const sessionFile = path.join(projectsDir, files[0].f);
    const raw = fs.readFileSync(sessionFile, 'utf-8');
    const lines = raw.split('\\n').filter(Boolean);

    // Scan from the end to find the most recent assistant model
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const model = entry?.message?.model || entry?.model;
        if (model && typeof model === 'string' && model.startsWith('claude')) {
          return model;
        }
      } catch { /* skip malformed line */ }
    }
  } catch { /* ignore */ }
  return null;
}

// Detect model name from Claude config (pure file reads, no exec)
function getModelName() {
  // PRIMARY: scan the live session JSONL — reflects /model overrides in real time
  const sessionModel = getModelFromSessionJSONL();
  if (sessionModel) return modelLabel(sessionModel);

  // SECONDARY: ~/.claude.json lastModelUsage for this exact project path
  // (longest-prefix match to avoid short paths like /Users matching first)
  try {
    const claudeConfig = readJSON(path.join(os.homedir(), '.claude.json'));
    if (claudeConfig?.projects) {
      let bestMatch = null;
      let bestLen = -1;
      for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
        if (CWD === projectPath || CWD.startsWith(projectPath + '/')) {
          if (projectPath.length > bestLen) {
            bestLen = projectPath.length;
            bestMatch = projectConfig;
          }
        }
      }
      if (bestMatch?.lastModelUsage) {
        const usage = bestMatch.lastModelUsage;
        const ids = Object.keys(usage);
        if (ids.length > 0) {
          let bestId = ids[ids.length - 1];
          let bestTokens = -1;
          for (const id of ids) {
            const e = usage[id] || {};
            const tokens = (e.inputTokens || 0) + (e.outputTokens || 0);
            if (tokens > bestTokens) { bestTokens = tokens; bestId = id; }
          }
          return modelLabel(bestId);
        }
      }
    }
  } catch { /* ignore */ }

  // TERTIARY: settings.json model field (configured default, not live session).
  const settings = getSettings();
  if (settings?.model) return modelLabel(settings.model);

  // QUATERNARY: read ANTHROPIC_MODEL or CLAUDE_MODEL env var (set by the CLI at launch)
  const envModel = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || process.env.MODEL;
  if (envModel && envModel.startsWith('claude')) return modelLabel(envModel);

  // QUINARY: current model from the model ID in the env injected by Claude Code itself
  const claudeModel = process.env.CLAUDE_CODE_MODEL;
  if (claudeModel) return modelLabel(claudeModel);

  return 'Sonnet 4.6'; // known current default rather than the generic "Claude Code"
}

// Get learning stats from memory database (pure stat calls)
function getLearningStats() {
  const memoryPaths = [
    path.join(CWD, '.swarm', 'memory.db'),
    path.join(CWD, '.monomind', 'memory.db'),
    path.join(CWD, '.claude', 'memory.db'),
    path.join(CWD, 'data', 'memory.db'),
    path.join(CWD, '.agentdb', 'memory.db'),
  ];

  for (const dbPath of memoryPaths) {
    const stat = safeStat(dbPath);
    if (stat) {
      const sizeKB = stat.size / 1024;
      const patterns = Math.floor(sizeKB / 2);
      return {
        patterns,
        sessions: Math.max(1, Math.floor(patterns / 10)),
      };
    }
  }

  // Check session files count
  let sessions = 0;
  try {
    const sessDir = path.join(CWD, '.claude', 'sessions');
    if (fs.existsSync(sessDir)) {
      sessions = fs.readdirSync(sessDir).filter(f => f.endsWith('.json')).length;
    }
  } catch { /* ignore */ }

  return { patterns: 0, sessions };
}

// progress from metrics files (pure file reads)
function getv1Progress() {
  const learning = getLearningStats();
  const totalDomains = 5;

  const dddData = readJSON(path.join(CWD, '.monomind', 'metrics', 'ddd-progress.json'));
  let dddProgress = dddData?.progress || 0;
  let domainsCompleted = Math.min(5, Math.floor(dddProgress / 20));

  if (dddProgress === 0 && learning.patterns > 0) {
    if (learning.patterns >= 500) domainsCompleted = 5;
    else if (learning.patterns >= 200) domainsCompleted = 4;
    else if (learning.patterns >= 100) domainsCompleted = 3;
    else if (learning.patterns >= 50) domainsCompleted = 2;
    else if (learning.patterns >= 10) domainsCompleted = 1;
    dddProgress = Math.floor((domainsCompleted / totalDomains) * 100);
  }

  return {
    domainsCompleted, totalDomains, dddProgress,
    patternsLearned: learning.patterns,
    sessionsCompleted: learning.sessions,
  };
}

// Security status (pure file reads)
function getSecurityStatus() {
  const auditData = readJSON(path.join(CWD, '.monomind', 'security', 'audit-status.json'));
  if (auditData) {
    const auditDate = auditData.lastAudit || auditData.lastScan;
    if (!auditDate) {
      // No audit has ever run — show as pending, not stale
      return { status: 'PENDING', cvesFixed: 0, totalCves: 0 };
    }
    const auditAge = Date.now() - new Date(auditDate).getTime();
    const isStale = auditAge > 7 * 24 * 60 * 60 * 1000;
    return {
      status: isStale ? 'STALE' : (auditData.status || 'PENDING'),
      cvesFixed: auditData.cvesFixed || 0,
      totalCves: auditData.totalCves || 0,
    };
  }

  let scanCount = 0;
  try {
    const scanDir = path.join(CWD, '.claude', 'security-scans');
    if (fs.existsSync(scanDir)) {
      scanCount = fs.readdirSync(scanDir).filter(f => f.endsWith('.json')).length;
    }
  } catch { /* ignore */ }

  return {
    status: scanCount > 0 ? 'SCANNED' : 'NONE',
    cvesFixed: 0,
    totalCves: 0,
  };
}

// Swarm status (pure file reads, NO ps aux)
function getSwarmStatus() {
  const staleThresholdMs = 5 * 60 * 1000;
  const agentRegTtlMs = 30 * 60 * 1000; // registration files expire after 30 min
  const now = Date.now();

  // PRIMARY: count live registration files written by SubagentStart hook
  // Each file = one active sub-agent. Stale files (>30 min) are ignored.
  const regDir = path.join(CWD, '.monomind', 'agents', 'registrations');
  if (fs.existsSync(regDir)) {
    try {
      const files = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
      const liveCount = files.filter(f => {
        try {
          return (now - fs.statSync(path.join(regDir, f)).mtimeMs) < agentRegTtlMs;
        } catch { return false; }
      }).length;
      if (liveCount > 0) {
        return {
          activeAgents: liveCount,
          maxAgents: CONFIG.maxAgents,
          coordinationActive: true,
        };
      }
    } catch { /* fall through */ }
  }

  // SECONDARY: swarm-state.json written by MCP swarm_init — trust if fresh
  const swarmStatePath = path.join(CWD, '.monomind', 'swarm', 'swarm-state.json');
  const swarmState = readJSON(swarmStatePath);
  if (swarmState) {
    const updatedAt = swarmState.updatedAt || swarmState.startedAt;
    const age = updatedAt ? now - new Date(updatedAt).getTime() : Infinity;
    if (age < staleThresholdMs) {
      return {
        activeAgents: swarmState.agents?.length || swarmState.agentCount || 0,
        maxAgents: swarmState.maxAgents || CONFIG.maxAgents,
        coordinationActive: true,
      };
    }
  }

  // TERTIARY: swarm-activity.json refreshed by post-task hook
  const activityData = readJSON(path.join(CWD, '.monomind', 'metrics', 'swarm-activity.json'));
  if (activityData?.swarm) {
    const updatedAt = activityData.timestamp || activityData.swarm.timestamp;
    const age = updatedAt ? now - new Date(updatedAt).getTime() : Infinity;
    if (age < staleThresholdMs) {
      return {
        activeAgents: activityData.swarm.agent_count || 0,
        maxAgents: CONFIG.maxAgents,
        coordinationActive: activityData.swarm.coordination_active || activityData.swarm.active || false,
      };
    }
  }

  return { activeAgents: 0, maxAgents: CONFIG.maxAgents, coordinationActive: false };
}

// System metrics (uses process.memoryUsage() — no shell spawn)
function getSystemMetrics() {
  const memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  const learning = getLearningStats();
  const agentdb = getAgentDBStats();

  // Intelligence from learning.json
  const learningData = readJSON(path.join(CWD, '.monomind', 'metrics', 'learning.json'));
  let intelligencePct = 0;
  let contextPct = 0;

  if (learningData?.intelligence?.score !== undefined) {
    intelligencePct = Math.min(100, Math.floor(learningData.intelligence.score));
  } else {
    // Use actual vector/entry counts — 2000 entries = 100%
    const fromPatterns = learning.patterns > 0 ? Math.min(100, Math.floor(learning.patterns / 20)) : 0;
    const fromVectors = agentdb.vectorCount > 0 ? Math.min(100, Math.floor(agentdb.vectorCount / 20)) : 0;
    intelligencePct = Math.max(fromPatterns, fromVectors);
  }

  // Maturity fallback (pure fs checks, no git exec)
  if (intelligencePct === 0) {
    let score = 0;
    if (fs.existsSync(path.join(CWD, '.claude'))) score += 15;
    const srcDirs = ['src', 'lib', 'app', 'packages', 'v1'];
    for (const d of srcDirs) { if (fs.existsSync(path.join(CWD, d))) { score += 15; break; } }
    const testDirs = ['tests', 'test', '__tests__', 'spec'];
    for (const d of testDirs) { if (fs.existsSync(path.join(CWD, d))) { score += 10; break; } }
    const cfgFiles = ['package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
    for (const f of cfgFiles) { if (fs.existsSync(path.join(CWD, f))) { score += 5; break; } }
    intelligencePct = Math.min(100, score);
  }

  if (learningData?.sessions?.total !== undefined) {
    contextPct = Math.min(100, learningData.sessions.total * 5);
  } else {
    contextPct = Math.min(100, Math.floor(learning.sessions * 5));
  }

  // Sub-agents from file metrics (no ps aux)
  let subAgents = 0;
  const activityData = readJSON(path.join(CWD, '.monomind', 'metrics', 'swarm-activity.json'));
  if (activityData?.processes?.estimated_agents) {
    subAgents = activityData.processes.estimated_agents;
  }

  return { memoryMB, contextPct, intelligencePct, subAgents };
}

// ADR status (count files only — don't read contents)
function getADRStatus() {
  // Count actual ADR files first — compliance JSON may be stale
  const adrPaths = [
    path.join(CWD, 'packages', 'implementation', 'adrs'),
    path.join(CWD, 'docs', 'adrs'),
    path.join(CWD, '.monomind', 'adrs'),
  ];

  for (const adrPath of adrPaths) {
    try {
      if (fs.existsSync(adrPath)) {
        const files = fs.readdirSync(adrPath).filter(f =>
          f.endsWith('.md') && (f.startsWith('ADR-') || f.startsWith('adr-') || /^\\d{4}-/.test(f))
        );
        // Report actual count — don't guess compliance without reading files
        return { count: files.length, implemented: files.length, compliance: 0 };
      }
    } catch { /* ignore */ }
  }

  return { count: 0, implemented: 0, compliance: 0 };
}

// Hooks status (shared settings cache)
function getHooksStatus() {
  let enabled = 0;
  let total = 0;
  const settings = getSettings();

  if (settings?.hooks) {
    for (const category of Object.keys(settings.hooks)) {
      const matchers = settings.hooks[category];
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        const hooks = matcher?.hooks;
        if (Array.isArray(hooks)) {
          total += hooks.length;
          enabled += hooks.length;
        }
      }
    }
  }

  try {
    const hooksDir = path.join(CWD, '.claude', 'hooks');
    if (fs.existsSync(hooksDir)) {
      const hookFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js') || f.endsWith('.sh')).length;
      total = Math.max(total, hookFiles);
      enabled = Math.max(enabled, hookFiles);
    }
  } catch { /* ignore */ }

  return { enabled, total };
}

// Active agent — reads last routing result persisted by hook-handler
function getActiveAgent() {
  const routeFile = path.join(CWD, '.monomind', 'last-route.json');
  try {
    if (!fs.existsSync(routeFile)) return null;
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    if (!data || !data.agent) return null;

    // Stale after 30 minutes (session likely changed)
    const age = Date.now() - new Date(data.updatedAt || 0).getTime();
    if (age > 30 * 60 * 1000) return null;

    // Prefer display name if set (from load-agent), else format the slug
    const displayName = data.name || data.agent
      .replace(/-/g, ' ')
      .replace(/\\b\\w/g, c => c.toUpperCase());

    return {
      slug: data.agent,
      name: displayName,
      category: data.category || null,
      confidence: data.confidence || 0,
      activated: data.activated || false,   // true = manually loaded extras agent
    };
  } catch { return null; }
}

// AgentDB stats — count real entries, not file-size heuristics
function getAgentDBStats() {
  let vectorCount = 0;
  let dbSizeKB = 0;
  let namespaces = 0;
  let hasHnsw = false;

  // 1. Count real entries from auto-memory-store.json
  const storePath = path.join(CWD, '.monomind', 'data', 'auto-memory-store.json');
  const storeStat = safeStat(storePath);
  if (storeStat) {
    dbSizeKB += storeStat.size / 1024;
    try {
      const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
      if (Array.isArray(store)) vectorCount += store.length;
      else if (store?.entries) vectorCount += store.entries.length;
    } catch { /* fall back to size estimate */ }
  }

  // 2. Count entries from ranked-context.json
  const rankedPath = path.join(CWD, '.monomind', 'data', 'ranked-context.json');
  try {
    const ranked = readJSON(rankedPath);
    if (ranked?.entries?.length > vectorCount) vectorCount = ranked.entries.length;
  } catch { /* ignore */ }

  // 3. Add DB file sizes
  const dbFiles = [
    path.join(CWD, 'data', 'memory.db'),
    path.join(CWD, '.monomind', 'memory.db'),
    path.join(CWD, '.swarm', 'memory.db'),
  ];
  for (const f of dbFiles) {
    const stat = safeStat(f);
    if (stat) {
      dbSizeKB += stat.size / 1024;
      namespaces++;
    }
  }

  // 4. Check for graph data
  const graphPath = path.join(CWD, 'data', 'memory.graph');
  const graphStat = safeStat(graphPath);
  if (graphStat) dbSizeKB += graphStat.size / 1024;

  // 5. HNSW index
  const hnswPaths = [
    path.join(CWD, '.swarm', 'hnsw.index'),
    path.join(CWD, '.monomind', 'hnsw.index'),
  ];
  for (const p of hnswPaths) {
    const stat = safeStat(p);
    if (stat) {
      hasHnsw = true;
      break;
    }
  }

  // HNSW is available if memory package is present
  if (!hasHnsw) {
    const memPkgPaths = [
      path.join(CWD, 'packages', '@monomind', 'memory', 'dist'),
      path.join(CWD, 'node_modules', '@monomind', 'memory'),
    ];
    for (const p of memPkgPaths) {
      if (fs.existsSync(p)) { hasHnsw = true; break; }
    }
  }

  return { vectorCount, dbSizeKB: Math.floor(dbSizeKB), namespaces, hasHnsw };
}

// Test stats (count files only — NO reading file contents)
function getTestStats() {
  let testFiles = 0;

  function countTestFiles(dir, depth = 0) {
    if (depth > 6) return;
    try {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          countTestFiles(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const n = entry.name;
          if (n.includes('.test.') || n.includes('.spec.') || n.includes('_test.') || n.includes('_spec.')) {
            testFiles++;
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Scan all source directories
  for (const d of ['tests', 'test', '__tests__', 'src', 'v1']) {
    countTestFiles(path.join(CWD, d));
  }

  // Estimate ~4 test cases per file (avoids reading every file)
  return { testFiles, testCases: testFiles * 4 };
}

// Integration status (shared settings + file checks)
function getIntegrationStatus() {
  const mcpServers = { total: 0, enabled: 0 };
  const settings = getSettings();

  if (settings?.mcpServers && typeof settings.mcpServers === 'object') {
    const servers = Object.keys(settings.mcpServers);
    mcpServers.total = servers.length;
    mcpServers.enabled = settings.enabledMcpjsonServers
      ? settings.enabledMcpjsonServers.filter(s => servers.includes(s)).length
      : servers.length;
  }

  // Fallback: .mcp.json
  if (mcpServers.total === 0) {
    const mcpConfig = readJSON(path.join(CWD, '.mcp.json'))
                   || readJSON(path.join(os.homedir(), '.claude', 'mcp.json'));
    if (mcpConfig?.mcpServers) {
      const s = Object.keys(mcpConfig.mcpServers);
      mcpServers.total = s.length;
      mcpServers.enabled = s.length;
    }
  }

  const hasDatabase = ['.swarm/memory.db', '.monomind/memory.db', 'data/memory.db']
    .some(p => fs.existsSync(path.join(CWD, p)));
  const hasApi = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

  return { mcpServers, hasDatabase, hasApi };
}

// Session stats (pure file reads)
function getSessionStats() {
  for (const p of ['.monomind/session.json', '.claude/session.json']) {
    const data = readJSON(path.join(CWD, p));
    if (data?.startTime) {
      const diffMs = Date.now() - new Date(data.startTime).getTime();
      const mins = Math.floor(diffMs / 60000);
      const duration = mins < 60 ? \`\${mins}m\` : \`\${Math.floor(mins / 60)}h\${mins % 60}m\`;
      return { duration };
    }
  }
  return { duration: '' };
}

// ─── Extended 256-color palette ─────────────────────────────────
const x = {
  // Backgrounds (used sparingly for labels)
  bgPurple:   '\\x1b[48;5;55m',
  bgTeal:     '\\x1b[48;5;23m',
  bgReset:    '\\x1b[49m',
  // Foregrounds
  purple:     '\\x1b[38;5;141m',   // soft lavender-purple (brand)
  violet:     '\\x1b[38;5;99m',    // deeper purple
  teal:       '\\x1b[38;5;51m',    // bright teal
  mint:       '\\x1b[38;5;120m',   // soft green
  gold:       '\\x1b[38;5;220m',   // warm gold
  orange:     '\\x1b[38;5;208m',   // alert orange
  coral:      '\\x1b[38;5;203m',   // error red-pink
  sky:        '\\x1b[38;5;117m',   // soft blue
  rose:       '\\x1b[38;5;218m',   // warm pink
  slate:      '\\x1b[38;5;245m',   // neutral grey
  white:      '\\x1b[38;5;255m',   // bright white
  green:      '\\x1b[38;5;82m',    // vivid green
  red:        '\\x1b[38;5;196m',   // vivid red
  yellow:     '\\x1b[38;5;226m',   // vivid yellow
  // Shared
  bold:  '\\x1b[1m',
  dim:   '\\x1b[2m',
  reset: '\\x1b[0m',
};

// ── Helpers ──────────────────────────────────────────────────────

// Block progress bar: ▰▰▰▱▱  (5 blocks)
function blockBar(current, total, width = 5) {
  const filled = Math.min(width, Math.round((current / Math.max(total, 1)) * width));
  return '\\u25B0'.repeat(filled) + \`\${x.slate}\\u25B1\${x.reset}\`.repeat(width - filled);
}

// Health dot: ● colored by status
function dot(ok) {
  if (ok === 'good')    return \`\${x.green}●\${x.reset}\`;
  if (ok === 'warn')    return \`\${x.gold}●\${x.reset}\`;
  if (ok === 'error')   return \`\${x.coral}●\${x.reset}\`;
  return \`\${x.slate}●\${x.reset}\`;   // 'none'
}

// Pill badge: [ LABEL ] with background
function badge(label, color) {
  return \`\${color}[\${label}]\${x.reset}\`;
}

// Divider character
const DIV = \`\${x.slate}│\${x.reset}\`;
const SEP = \`\${x.slate}──────────────────────────────────────────────────────\${x.reset}\`;

// Pct → color
function pctColor(pct) {
  if (pct >= 75) return x.green;
  if (pct >= 40) return x.gold;
  if (pct > 0)   return x.orange;
  return x.slate;
}

// Security status → label + color
function secBadge(status) {
  if (status === 'CLEAN')       return { label: '✔ CLEAN',   col: x.green };
  if (status === 'STALE')       return { label: '⟳ STALE',   col: x.gold };
  if (status === 'IN_PROGRESS') return { label: '⟳ RUNNING', col: x.sky };
  if (status === 'SCANNED')     return { label: '✔ SCANNED', col: x.mint };
  if (status === 'PENDING')     return { label: '⏸ PENDING', col: x.gold };
  return { label: '✖ NONE', col: x.slate };
}

// ── Knowledge & trigger stats (Tasks 28 + 32) ────────────────────
function getKnowledgeStats() {
  const chunksPath = path.join(CWD, '.monomind', 'knowledge', 'chunks.jsonl');
  const skillsPath = path.join(CWD, '.monomind', 'skills.jsonl');
  let chunks = 0, skills = 0;
  try {
    if (fs.existsSync(chunksPath)) {
      chunks = fs.readFileSync(chunksPath, 'utf-8').split('\\n').filter(Boolean).length;
    }
  } catch { /* ignore */ }
  try {
    if (fs.existsSync(skillsPath)) {
      skills = fs.readFileSync(skillsPath, 'utf-8').split('\\n').filter(Boolean).length;
    }
  } catch { /* ignore */ }
  return { chunks, skills };
}

function getTriggerStats() {
  const indexPath = path.join(CWD, '.monomind', 'trigger-index.json');
  try {
    if (!fs.existsSync(indexPath)) return { triggers: 0, agents: 0 };
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const idx = raw.index || raw;
    const triggers = Object.keys(idx).length;
    const agents = Object.values(idx).flat().length;
    return { triggers, agents };
  } catch { return { triggers: 0, agents: 0 }; }
}

// Hook latency — surface slow per-prompt hooks in the statusline.
function getHookLatency() {
  const p = path.join(CWD, '.monomind', 'metrics', 'hook-latency.json');
  try {
    if (!fs.existsSync(p)) return null;
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const perPrompt = ['route'];
    let totalMs = 0; let count = 0;
    for (const h of perPrompt) {
      if (d[h] && d[h].mean) { totalMs += d[h].mean; count++; }
    }
    if (count === 0) return null;
    let slowest = null;
    for (const k of Object.keys(d)) {
      if (k === 'lastUpdated' || !d[k] || typeof d[k] !== 'object') continue;
      if (!slowest || d[k].mean > slowest.mean) slowest = { name: k, mean: d[k].mean };
    }
    return { perPromptMs: totalMs, slowest: slowest };
  } catch { return null; }
}

// Graph usage telemetry — counts ALL graph wins (MCP calls + silent assists)
// vs greps that got no graph help.
function getGraphUsage() {
  const usagePath = path.join(CWD, '.monomind', 'metrics', 'graph-usage.json');
  try {
    if (!fs.existsSync(usagePath)) return null;
    const d = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    const graphWins = (d.monograph_call || 0) + (d.preresolve_hit || 0)
                    + (d.graph_assist_search || 0) + (d.graph_assist_neighbors || 0);
    const searches = (d.grep_call || 0) + (d.glob_call || 0)
                   + (d.bash_grep_call || 0) + (d.bash_find_call || 0);
    const total = graphWins + searches + (d.preresolve_miss || 0);
    if (total === 0) return null;
    return { graphWins: graphWins, searches: searches, pct: Math.round((graphWins / total) * 100), dollarsSaved: d.dollars_saved || 0 };
  } catch { return null; }
}

// Graph freshness — compare last build time vs commits since
function getGraphFreshness() {
  const lockPath = path.join(CWD, '.monomind', 'graph', '.rebuild-lock');
  const dbPath   = path.join(CWD, '.monomind', 'monograph.db');
  let buildMs = 0;
  try {
    const lockStat = safeStat(lockPath);
    const dbStat   = safeStat(dbPath);
    buildMs = Math.max(lockStat?.mtimeMs || 0, dbStat?.mtimeMs || 0);
  } catch { /* ignore */ }
  if (!buildMs) return { commitsBehind: -1, stale: true, fresh: false };
  const buildIso = new Date(buildMs).toISOString();
  const out = safeExec(\`git rev-list --count --since='\${buildIso}' HEAD 2>/dev/null\`, 1500);
  const commitsBehind = parseInt(out, 10) || 0;
  return { commitsBehind, stale: commitsBehind > 5, fresh: commitsBehind === 0 };
}

// Active loops — scan .monomind/loops/*.json, skip stale (>6h)
function getLoopStatus() {
  const loopsDir = path.join(CWD, '.monomind', 'loops');
  if (!fs.existsSync(loopsDir)) return { count: 0, loops: [] };
  const STALE_MS = 6 * 60 * 60 * 1000;
  const now = Date.now();
  const loops = [];
  try {
    const files = fs.readdirSync(loopsDir).filter(f =>
      f.endsWith('.json') && !f.includes('-hil') && !f.endsWith('.stop'));
    for (const f of files) {
      const d = readJSON(path.join(loopsDir, f));
      if (!d || !d.command) continue;
      const last = d.lastRunAt || d.nextRunAt || d.startedAt || 0;
      if (last && (now - last) > STALE_MS) continue;
      loops.push({
        cmd: String(d.command).replace(/^\\//,''),
        type: d.type || 'repeat',
        rep: d.currentRep || 0,
        max: d.maxReps || 0,
        status: d.status || 'running',
      });
    }
  } catch { /* ignore */ }
  return { count: loops.length, loops };
}

// HIL pending — count <id>-hil.md files with no human response yet
function getHILPending() {
  const loopsDir = path.join(CWD, '.monomind', 'loops');
  if (!fs.existsSync(loopsDir)) return { pending: 0 };
  let pending = 0;
  try {
    const files = fs.readdirSync(loopsDir).filter(f => f.endsWith('-hil.md'));
    for (const f of files) {
      try {
        const txt = fs.readFileSync(path.join(loopsDir, f), 'utf-8');
        const answered = /^[ \\t]*>[ \\t]+\\S/m.test(txt);
        if (!answered) pending++;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { pending };
}

// Monograph knowledge graph stats
// Sources, in priority order:
//   1. .monomind/graph/stats.json     — explicit cached stats
//   2. .monomind/monograph.db         — live SQLite (read counts via sqlite3)
//   3. .monomind/graph/graph.json     — legacy JSON dump
function getGraphifyStats() {
  const statsPath = path.join(CWD, '.monomind', 'graph', 'stats.json');
  const dbPath    = path.join(CWD, '.monomind', 'monograph.db');
  const graphPath = path.join(CWD, '.monomind', 'graph', 'graph.json');

  try {
    const s = readJSON(statsPath);
    if (s && s.nodes !== undefined) return { nodes: s.nodes, edges: s.edges || 0, exists: true };
  } catch { /* ignore */ }

  try {
    if (fs.existsSync(dbPath)) {
      const out = safeExec(\`sqlite3 "\${dbPath}" "SELECT (SELECT COUNT(*) FROM nodes), (SELECT COUNT(*) FROM edges);"\`, 1000);
      if (out) {
        const [n, e] = out.split('|').map(v => parseInt(v, 10) || 0);
        if (n > 0) return { nodes: n, edges: e, exists: true };
      }
    }
  } catch { /* ignore */ }

  try {
    const stat = safeStat(graphPath);
    if (stat && stat.size < 10 * 1024 * 1024) {
      const g = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
      const nodes = Array.isArray(g.nodes) ? g.nodes.length : 0;
      const edges = (Array.isArray(g.edges) ? g.edges : (Array.isArray(g.links) ? g.links : [])).length;
      return { nodes, edges, exists: true };
    }
  } catch { /* ignore */ }
  return { nodes: 0, edges: 0, exists: false };
}

function getSIBudget() {
  const SI_LIMIT = 1500;
  const siPath = path.join(CWD, '.agents', 'shared_instructions.md');
  try {
    if (!fs.existsSync(siPath)) return null;
    const len = fs.readFileSync(siPath, 'utf-8').length;
    return { len, pct: Math.round((len / SI_LIMIT) * 100), limit: SI_LIMIT };
  } catch { return null; }
}

// ── Single-line statusline (compact) ─────────────────────────────
function generateStatusline() {
  const git       = getGitInfo();
  const swarm     = getSwarmStatus();
  const system    = getSystemMetrics();
  const hooks     = getHooksStatus();
  const knowledge = getKnowledgeStats();
  const triggers  = getTriggerStats();
  const parts     = [];

  // Brand + swarm dot
  const swarmDot = swarm.coordinationActive ? \`\${x.green}●\${x.reset}\` : \`\${x.slate}○\${x.reset}\`;
  parts.push(\`\${x.bold}\${x.purple}▊ Monomind\${x.reset} \${swarmDot}\`);

  // Git branch + changes (compact)
  if (git.gitBranch) {
    let b = \`\${x.sky}⎇ \${x.bold}\${git.gitBranch}\${x.reset}\`;
    if (git.staged   > 0) b += \` \${x.green}+\${git.staged}\${x.reset}\`;
    if (git.modified > 0) b += \` \${x.gold}~\${git.modified}\${x.reset}\`;
    if (git.ahead    > 0) b += \` \${x.green}↑\${git.ahead}\${x.reset}\`;
    if (git.behind   > 0) b += \` \${x.coral}↓\${git.behind}\${x.reset}\`;
    parts.push(b);
  }

  // Model
  parts.push(\`\${x.violet}\${getModelName()}\${x.reset}\`);

  // Active agent
  const activeAgent = getActiveAgent();
  if (activeAgent) {
    const col  = activeAgent.activated ? x.green : x.sky;
    const icon = activeAgent.activated ? '●' : '→';
    parts.push(\`\${col}\${icon} \${x.bold}\${activeAgent.name}\${x.reset}\`);
  }

  // Intelligence
  const ic = pctColor(system.intelligencePct);
  parts.push(\`\${ic}💡 \${system.intelligencePct}%\${x.reset}\`);

  // Knowledge chunks (Task 28) — show when populated
  if (knowledge.chunks > 0) {
    parts.push(\`\${x.teal}📚 \${knowledge.chunks}k\${x.reset}\`);
  }

  // Triggers (Task 32) — show when populated
  if (triggers.triggers > 0) {
    parts.push(\`\${x.mint}🎯 \${triggers.triggers}t\${x.reset}\`);
  }

  // Swarm agents (only when active)
  if (swarm.activeAgents > 0) {
    parts.push(\`\${x.gold}🐝 \${swarm.activeAgents}/\${swarm.maxAgents}\${x.reset}\`);
  }

  // Hooks
  if (hooks.enabled > 0) {
    parts.push(\`\${x.mint}⚡ \${hooks.enabled}h\${x.reset}\`);
  }

  return parts.join(\`  \${DIV}  \`);
}

// ── Multi-line dashboard (full mode) ─────────────────────────────
function generateDashboard() {
  const git         = getGitInfo();
  const modelName   = getModelName();
  const progress    = getv1Progress();
  const security    = getSecurityStatus();
  const swarm       = getSwarmStatus();
  const system      = getSystemMetrics();
  const adrs        = getADRStatus();
  const hooks       = getHooksStatus();
  const agentdb     = getAgentDBStats();
  const tests       = getTestStats();
  const session     = getSessionStats();
  const integration = getIntegrationStatus();
  const knowledge   = getKnowledgeStats();
  const triggers    = getTriggerStats();
  const si          = getSIBudget();
  const sec         = secBadge(security.status);
  const activeAgent = getActiveAgent();
  const lines       = [];

  // ── Header: brand + git + model + session ────────────────────
  const swarmDot = swarm.coordinationActive ? \`\${x.green}● LIVE\${x.reset}\` : \`\${x.slate}○ IDLE\${x.reset}\`;
  const projName = getProjectName();
  const cwdName = path.basename(CWD);
  let hdr = \`\${x.bold}\${x.purple}▊ Monomind \${VERSION}\${x.reset}  \${swarmDot}  \${x.teal}\${x.bold}\${projName}\${x.reset}  \${DIV}  \${x.dim}◎ \${cwdName}\${x.reset}  \${DIV}  \${x.violet}⬡ \${git.name}\${x.reset}\`;

  if (git.gitBranch) {
    hdr += \`  \${DIV}  \${x.sky}⎇ \${x.bold}\${git.gitBranch}\${x.reset}\`;
    if (git.staged   > 0) hdr += \`  \${x.green}+\${git.staged}\${x.reset}\`;
    if (git.modified > 0) hdr += \`  \${x.gold}~\${git.modified} mod\${x.reset}\`;
    if (git.untracked > 0) hdr += \`  \${x.slate}?\${git.untracked}\${x.reset}\`;
    if (git.ahead    > 0) hdr += \`  \${x.green}↑\${git.ahead}\${x.reset}\`;
    if (git.behind   > 0) hdr += \`  \${x.coral}↓\${git.behind}\${x.reset}\`;
  }

  hdr += \`  \${DIV}  🤖 \${x.violet}\${x.bold}\${modelName}\${x.reset}\`;
  if (session.duration) hdr += \`  \${x.dim}⏱ \${session.duration}\${x.reset}\`;

  lines.push(hdr);
  lines.push(SEP);

  // ── Row 1: Active agent + Loop status ────────────────────────
  let agentStr;
  if (activeAgent) {
    const col  = activeAgent.activated ? x.green : x.sky;
    const mark = activeAgent.activated ? \`\${col}\${x.bold}● ACTIVE\${x.reset}  \` : '';
    const conf = activeAgent.activated ? '' : \`  \${x.slate}\${(activeAgent.confidence * 100).toFixed(0)}%\${x.reset}\`;
    agentStr = \`\${mark}\${col}👤 \${x.bold}\${activeAgent.name}\${x.reset}\${conf}\`;
  } else {
    agentStr = \`\${x.slate}👤 no agent routed\${x.reset}\`;
  }

  const loopState = getLoopStatus();
  let loopStr;
  if (loopState.count > 0) {
    const parts = loopState.loops.slice(0, 2).map(l => {
      const status = l.status === 'hil:pending'
        ? \`\${x.coral}⏳ HIL\${x.reset}\`
        : \`\${x.green}⟳\${x.reset}\`;
      const tag = l.type === 'tillend'
        ? \`\${x.bold}\${l.cmd}\${x.reset}\${x.slate} run \${l.rep}\${x.reset}\`
        : \`\${x.bold}\${l.cmd}\${x.reset}\${x.slate} \${l.rep}/\${l.max}\${x.reset}\`;
      return \`\${status} \${tag}\`;
    });
    loopStr = \`\${x.gold}🔄\${x.reset} \${parts.join(\`\${x.slate}  ·  \${x.reset}\`)}\`;
    if (loopState.count > 2) loopStr += \`\${x.slate}  +\${loopState.count - 2} more\${x.reset}\`;
  } else {
    loopStr = \`\${x.slate}🔄 no active loops\${x.reset}\`;
  }

  // Graph usage ratio + $ saved — show only when there's data
  const usage = getGraphUsage();
  let usageStr = '';
  if (usage) {
    const col = usage.pct >= 40 ? x.green : usage.pct >= 15 ? x.gold : x.coral;
    const saved = usage.dollarsSaved > 0
      ? \`   \${x.green}💰 +$\${usage.dollarsSaved.toFixed(2)}\${x.reset}\`
      : '';
    usageStr = \`   \${DIV}   \${col}📊 graph \${usage.pct}%\${x.reset}\${x.slate} · grep \${100 - usage.pct}%\${x.reset}\${saved}\`;
  }

  // Hook latency — surface when slow (>500ms per prompt)
  const lat = getHookLatency();
  let latStr = '';
  if (lat && lat.perPromptMs > 500) {
    latStr = \`   \${DIV}   \${x.coral}⚡ hooks \${lat.perPromptMs}ms\${x.reset}\`;
  } else if (lat && lat.perPromptMs > 0) {
    latStr = \`   \${DIV}   \${x.dim}⚡ \${lat.perPromptMs}ms\${x.reset}\`;
  }

  lines.push(\`\${x.purple}🤖  AGENT\${x.reset}    \${agentStr}   \${DIV}   \${loopStr}\${usageStr}\${latStr}\`);
  lines.push(SEP);

  // ── Row 2: Graph freshness + Pending HIL ─────────────────────
  const gf = getGraphifyStats();
  const freshness = getGraphFreshness();
  let graphStr;
  if (gf.exists) {
    const nodesFmt = gf.nodes >= 1000 ? \`\${(gf.nodes / 1000).toFixed(0)}k\` : \`\${gf.nodes}\`;
    const freshTag = freshness.fresh
      ? \`\${x.green}● fresh\${x.reset}\`
      : freshness.stale
        ? \`\${x.coral}● \${freshness.commitsBehind} commits stale\${x.reset}\`
        : \`\${x.gold}● \${freshness.commitsBehind} behind\${x.reset}\`;
    graphStr = \`\${x.sky}🔗 \${x.bold}\${nodesFmt}\${x.reset}\${x.slate} nodes\${x.reset}  \${freshTag}\`;
  } else {
    graphStr = \`\${x.slate}🔗 no graph\${x.reset}\`;
  }

  const hil = getHILPending();
  const hilStr = hil.pending > 0
    ? \`   \${DIV}   \${x.coral}✨ \${x.bold}\${hil.pending}\${x.reset}\${x.coral} HIL pending\${x.reset}\`
    : \`\`;

  lines.push(\`\${x.teal}🧠  CONTEXT\${x.reset}  \${graphStr}\${hilStr}\`);

  return lines.join('\\n');
}

// ── JSON output ──────────────────────────────────────────────────
function generateJSON() {
  const git = getGitInfo();
  return {
    user:       { name: git.name, gitBranch: git.gitBranch, modelName: getModelName() },
    domains:    getv1Progress(),
    security:   getSecurityStatus(),
    swarm:      getSwarmStatus(),
    system:     getSystemMetrics(),
    adrs:       getADRStatus(),
    hooks:      getHooksStatus(),
    agentdb:    getAgentDBStats(),
    tests:      getTestStats(),
    git:        { modified: git.modified, untracked: git.untracked, staged: git.staged, ahead: git.ahead, behind: git.behind },
    lastUpdated: new Date().toISOString(),
  };
}

// ─── Mode state file ─────────────────────────────────────────────
const MODE_FILE = path.join(CWD, '.monomind', 'statusline-mode.txt');

function readMode() {
  try {
    if (fs.existsSync(MODE_FILE)) {
      return fs.readFileSync(MODE_FILE, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return 'full'; // default
}

// ─── Main ───────────────────────────────────────────────────────
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(generateJSON(), null, 2));
} else if (process.argv.includes('--compact')) {
  console.log(JSON.stringify(generateJSON()));
} else if (process.argv.includes('--single-line')) {
  console.log(generateStatusline());
} else if (process.argv.includes('--toggle')) {
  // Toggle mode and print the new view
  const current = readMode();
  const next = current === 'compact' ? 'full' : 'compact';
  try {
    fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true });
    fs.writeFileSync(MODE_FILE, next, 'utf-8');
  } catch { /* ignore */ }
  if (next === 'compact') {
    console.log(generateStatusline());
  } else {
    console.log(generateDashboard());
  }
} else {
  // Default: respect mode state file
  const mode = readMode();
  if (mode === 'compact') {
    console.log(generateStatusline());
  } else {
    console.log(generateDashboard());
  }
}
`;
}

export function generateStatuslineHook(options: InitOptions): string {
  if (!options.statusline.enabled) {
    return '#!/bin/bash\n# Statusline disabled\n';
  }

  return `#!/bin/bash
# Monomind Statusline Hook
# Source this in your .bashrc/.zshrc for terminal statusline

# Function to get statusline
monomind_statusline() {
  local statusline_script="\${MONOMIND_DIR:-.claude}/helpers/statusline.cjs"
  if [ -f "$statusline_script" ]; then
    node "$statusline_script" 2>/dev/null || echo ""
  fi
}

# Bash: Add to PS1
# export PS1='$(monomind_statusline) \\n\\$ '

# Zsh: Add to RPROMPT
# export RPROMPT='$(monomind_statusline)'

# Claude Code: Add to .claude/settings.json
# "statusLine": {
#   "type": "command",
#   "command": "node .claude/helpers/statusline.cjs 2>/dev/null"
#   "when": "test -f .claude/helpers/statusline.cjs"
# }
`;
}

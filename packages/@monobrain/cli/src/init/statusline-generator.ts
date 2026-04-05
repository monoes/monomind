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
 * ▊ Monobrain ● user  │  ⎇ branch  │  Opus 4.6 (1M context)
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
 * Monobrain V1 Statusline Generator (Optimized)
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

const CWD = process.cwd();

// Read monobrain version — check global install first, then CWD package.json
function getVersion() {
  // 1. Monobrain global install: script lives at <install>/packages/@monobrain/cli/dist/src/init/
  //    or user project:           .claude/helpers/statusline.cjs
  //    Walk up to find a monobrain package.json (has "name":"monobrain" or "@monoes/cli")
  const scriptDir = path.dirname(__filename);
  const walkCandidates = [
    path.join(scriptDir, '..', '..', 'package.json'),          // dist/src -> @monobrain/cli
    path.join(scriptDir, '..', '..', '..', 'package.json'),    // -> monobrain umbrella
    path.join(scriptDir, '..', '..', '..', '..', 'package.json'),
  ];
  for (const p of walkCandidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.version && (pkg.name === 'monobrain' || pkg.name === '@monoes/cli' || (pkg.name || '').startsWith('@monobrain'))) {
        return \`v\${pkg.version}\`;
      }
    } catch { /* ignore */ }
  }
  // 2. Fallback: npm global prefix
  try {
    const { execSync } = require('child_process');
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8', timeout: 2000 }).trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(prefix, 'lib', 'node_modules', 'monobrain', 'package.json'), 'utf-8'));
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
    path.join(CWD, '.monobrain', 'memory.db'),
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

  const dddData = readJSON(path.join(CWD, '.monobrain', 'metrics', 'ddd-progress.json'));
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
  const auditData = readJSON(path.join(CWD, '.monobrain', 'security', 'audit-status.json'));
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
  const regDir = path.join(CWD, '.monobrain', 'agents', 'registrations');
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
  const swarmStatePath = path.join(CWD, '.monobrain', 'swarm', 'swarm-state.json');
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
  const activityData = readJSON(path.join(CWD, '.monobrain', 'metrics', 'swarm-activity.json'));
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
  const learningData = readJSON(path.join(CWD, '.monobrain', 'metrics', 'learning.json'));
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
  const activityData = readJSON(path.join(CWD, '.monobrain', 'metrics', 'swarm-activity.json'));
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
    path.join(CWD, '.monobrain', 'adrs'),
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
  const routeFile = path.join(CWD, '.monobrain', 'last-route.json');
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
  const storePath = path.join(CWD, '.monobrain', 'data', 'auto-memory-store.json');
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
  const rankedPath = path.join(CWD, '.monobrain', 'data', 'ranked-context.json');
  try {
    const ranked = readJSON(rankedPath);
    if (ranked?.entries?.length > vectorCount) vectorCount = ranked.entries.length;
  } catch { /* ignore */ }

  // 3. Add DB file sizes
  const dbFiles = [
    path.join(CWD, 'data', 'memory.db'),
    path.join(CWD, '.monobrain', 'memory.db'),
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
    path.join(CWD, '.monobrain', 'hnsw.index'),
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
      path.join(CWD, 'packages', '@monobrain', 'memory', 'dist'),
      path.join(CWD, 'node_modules', '@monobrain', 'memory'),
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

  const hasDatabase = ['.swarm/memory.db', '.monobrain/memory.db', 'data/memory.db']
    .some(p => fs.existsSync(path.join(CWD, p)));
  const hasApi = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

  return { mcpServers, hasDatabase, hasApi };
}

// Session stats (pure file reads)
function getSessionStats() {
  for (const p of ['.monobrain/session.json', '.claude/session.json']) {
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
  const chunksPath = path.join(CWD, '.monobrain', 'knowledge', 'chunks.jsonl');
  const skillsPath = path.join(CWD, '.monobrain', 'skills.jsonl');
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
  const indexPath = path.join(CWD, '.monobrain', 'trigger-index.json');
  try {
    if (!fs.existsSync(indexPath)) return { triggers: 0, agents: 0 };
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const idx = raw.index || raw;
    const triggers = Object.keys(idx).length;
    const agents = Object.values(idx).flat().length;
    return { triggers, agents };
  } catch { return { triggers: 0, agents: 0 }; }
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
  parts.push(\`\${x.bold}\${x.purple}▊ Monobrain\${x.reset} \${swarmDot}\`);

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
  let hdr = \`\${x.bold}\${x.purple}▊ Monobrain \${VERSION}\${x.reset}  \${swarmDot}  \${x.teal}\${x.bold}\${git.name}\${x.reset}\`;

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

  // ── Row 1: Intelligence & Learning ───────────────────────────
  const intellCol = pctColor(system.intelligencePct);
  const intellBar = blockBar(system.intelligencePct, 100, 6);

  // Knowledge (Task 28)
  const knowStr = knowledge.chunks > 0
    ? \`\${x.teal}📚 \${x.bold}\${knowledge.chunks}\${x.reset}\${x.slate} chunks\${x.reset}\`
    : \`\${x.slate}📚 no chunks\${x.reset}\`;

  // Skills (Task 45)
  const skillStr = knowledge.skills > 0
    ? \`  \${x.mint}✦ \${knowledge.skills} skills\${x.reset}\`
    : '';

  // Patterns
  const patStr = progress.patternsLearned > 0
    ? \`\${x.gold}\${progress.patternsLearned >= 1000 ? (progress.patternsLearned / 1000).toFixed(1) + 'k' : progress.patternsLearned} patterns\${x.reset}\`
    : \`\${x.slate}0 patterns\${x.reset}\`;

  lines.push(
    \`\${x.purple}💡  INTEL\${x.reset}    \` +
    \`\${intellCol}\${intellBar} \${x.bold}\${system.intelligencePct}%\${x.reset}   \${DIV}   \` +
    \`\${knowStr}\${skillStr}   \${DIV}   \` +
    patStr
  );
  lines.push(SEP);

  // ── Row 2: Agents & Triggers ──────────────────────────────────
  const agentCol  = swarm.activeAgents > 0 ? x.green : x.slate;
  const hookCol   = hooks.enabled > 0      ? x.mint  : x.slate;

  // Triggers (Task 32)
  const trigStr = triggers.triggers > 0
    ? \`\${x.mint}🎯 \${x.bold}\${triggers.triggers}\${x.reset}\${x.slate} triggers · \${triggers.agents} agents\${x.reset}\`
    : \`\${x.slate}🎯 no triggers\${x.reset}\`;

  // Active agent badge
  let agentBadge;
  if (activeAgent) {
    const col  = activeAgent.activated ? x.green : x.sky;
    const mark = activeAgent.activated ? '● ACTIVE' : '→ ROUTED';
    const conf = activeAgent.activated ? '' : \`  \${x.slate}\${(activeAgent.confidence * 100).toFixed(0)}%\${x.reset}\`;
    const cat  = activeAgent.category  ? \`  \${x.slate}[\${activeAgent.category}]\${x.reset}\` : '';
    agentBadge = \`\${col}\${x.bold}\${mark}\${x.reset}  \${col}👤 \${x.bold}\${activeAgent.name}\${x.reset}\${cat}\${conf}\`;
  } else {
    agentBadge = \`\${x.slate}👤 no agent routed\${x.reset}\`;
  }

  lines.push(
    \`\${x.gold}🐝  SWARM\${x.reset}    \` +
    \`\${agentCol}\${x.bold}\${swarm.activeAgents}\${x.reset}\${x.slate}/\${x.reset}\${x.white}\${swarm.maxAgents}\${x.reset} agents   \` +
    \`\${hookCol}⚡ \${hooks.enabled}/\${hooks.total} hooks\${x.reset}   \${DIV}   \` +
    \`\${trigStr}   \${DIV}   \` +
    agentBadge
  );
  lines.push(SEP);

  // ── Row 3: Architecture & Security ───────────────────────────
  const adrCol = adrs.count > 0
    ? (adrs.implemented >= adrs.count ? x.green : x.gold)
    : x.slate;
  const adrStr = adrs.count > 0
    ? \`\${adrCol}\${x.bold}\${adrs.implemented}\${x.reset}\${x.slate}/\${x.reset}\${x.white}\${adrs.count}\${x.reset} ADRs\`
    : \`\${x.slate}no ADRs\${x.reset}\`;

  const dddCol = pctColor(progress.dddProgress);
  const dddBar = blockBar(progress.dddProgress, 100, 5);

  const cveStatus = security.totalCves === 0
    ? (security.status === 'NONE' ? \`\${x.slate}not scanned\${x.reset}\` : \`\${x.green}✔ clean\${x.reset}\`)
    : \`\${x.coral}\${security.cvesFixed}/\${security.totalCves} fixed\${x.reset}\`;

  lines.push(
    \`\${x.purple}🧩  ARCH\${x.reset}     \` +
    \`\${adrStr}   \${DIV}   \` +
    \`DDD \${dddBar} \${dddCol}\${x.bold}\${progress.dddProgress}%\${x.reset}   \${DIV}   \` +
    \`🛡️  \${sec.col}\${sec.label}\${x.reset}   \${DIV}   \` +
    \`CVE \${cveStatus}\`
  );
  lines.push(SEP);

  // ── Row 4: Memory & Tests ─────────────────────────────────────
  const vecCol   = agentdb.vectorCount > 0 ? x.green : x.slate;
  const hnswTag  = agentdb.hasHnsw && agentdb.vectorCount > 0 ? \`  \${x.green}⚡ HNSW\${x.reset}\` : '';
  const sizeDisp = agentdb.dbSizeKB >= 1024
    ? \`\${(agentdb.dbSizeKB / 1024).toFixed(1)} MB\` : \`\${agentdb.dbSizeKB} KB\`;
  const testCol  = tests.testFiles > 0 ? x.green : x.slate;
  const memCol   = system.memoryMB > 200 ? x.orange : x.sky;

  const chips = [];
  if (integration.mcpServers.total > 0) {
    const mc = integration.mcpServers.enabled === integration.mcpServers.total ? x.green
             : integration.mcpServers.enabled > 0 ? x.gold : x.coral;
    chips.push(\`\${mc}MCP \${integration.mcpServers.enabled}/\${integration.mcpServers.total}\${x.reset}\`);
  }
  if (integration.hasDatabase) chips.push(\`\${x.green}DB ✔\${x.reset}\`);
  if (integration.hasApi)      chips.push(\`\${x.green}API ✔\${x.reset}\`);
  const integStr = chips.length ? chips.join('  ') : \`\${x.slate}none\${x.reset}\`;

  lines.push(
    \`\${x.teal}🗄️  MEMORY\${x.reset}   \` +
    \`\${vecCol}\${x.bold}\${agentdb.vectorCount}\${x.reset}\${x.slate} vectors\${x.reset}\${hnswTag}   \${DIV}   \` +
    \`\${x.white}\${sizeDisp}\${x.reset}   \${DIV}   \` +
    \`\${testCol}🧪 \${tests.testFiles} test files\${x.reset}   \${DIV}   \` +
    integStr
  );
  lines.push(SEP);

  // ── Row 5: Context budget ─────────────────────────────────────
  // SI budget (Task 23 monitor)
  let siStr;
  if (si) {
    const siCol = si.pct > 100 ? x.coral : si.pct > 80 ? x.gold : x.green;
    siStr = \`\${siCol}📄 SI \${si.pct}% budget\${x.reset} \${x.dim}(\${si.len}/\${si.limit} chars)\${x.reset}\`;
  } else {
    siStr = \`\${x.slate}📄 no shared instructions\${x.reset}\`;
  }

  // Domains
  const domCol = progress.domainsCompleted >= 4 ? x.green
               : progress.domainsCompleted >= 2 ? x.gold
               : progress.domainsCompleted >= 1 ? x.orange
               : x.slate;
  const domBar = blockBar(progress.domainsCompleted, progress.totalDomains);

  lines.push(
    \`\${x.slate}📋  CONTEXT\${x.reset}  \` +
    \`\${siStr}   \${DIV}   \` +
    \`\${x.teal}🏗 \${domBar} \${domCol}\${x.bold}\${progress.domainsCompleted}\${x.reset}\${x.slate}/\${x.reset}\${x.white}\${progress.totalDomains}\${x.reset} domains   \${DIV}   \` +
    \`\${x.dim}💾 \${system.memoryMB} MB RAM\${x.reset}\`
  );

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
const MODE_FILE = path.join(CWD, '.monobrain', 'statusline-mode.txt');

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
# Monobrain Statusline Hook
# Source this in your .bashrc/.zshrc for terminal statusline

# Function to get statusline
monobrain_statusline() {
  local statusline_script="\${MONOBRAIN_DIR:-.claude}/helpers/statusline.cjs"
  if [ -f "$statusline_script" ]; then
    node "$statusline_script" 2>/dev/null || echo ""
  fi
}

# Bash: Add to PS1
# export PS1='$(monobrain_statusline) \\n\\$ '

# Zsh: Add to RPROMPT
# export RPROMPT='$(monobrain_statusline)'

# Claude Code: Add to .claude/settings.json
# "statusLine": {
#   "type": "command",
#   "command": "node .claude/helpers/statusline.cjs 2>/dev/null"
#   "when": "test -f .claude/helpers/statusline.cjs"
# }
`;
}

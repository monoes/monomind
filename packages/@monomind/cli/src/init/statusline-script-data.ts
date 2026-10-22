/**
 * Statusline script section: version/colour setup, safe readers, and the
 * git/model/learning/security/swarm data collectors.
 * Spliced verbatim into generateStatuslineScript() output.
 */

export const STATUSLINE_DATA_SECTION = `// Read monomind version — check global install first, then CWD package.json
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
      const pkgStat = safeStat(p);
      if (!pkgStat || pkgStat.size > 1024 * 1024) continue;
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.version && (pkg.name === 'monomind' || pkg.name === '@monomind/cli' || (pkg.name || '').startsWith('@monomind'))) {
        return \`v\${pkg.version}\`;
      }
    } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }
  }
  // 2. Fallback: npm global prefix (lib/node_modules on POSIX, node_modules on Windows)
  try {
    const { execSync } = require('child_process');
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8', timeout: 2000 }).trim();
    const candidates = [
      path.join(prefix, 'lib', 'node_modules', 'monomind', 'package.json'),
      path.join(prefix, 'node_modules', 'monomind', 'package.json'),
    ];
    for (const globalPkgPath of candidates) {
      const globalPkgStat = safeStat(globalPkgPath);
      if (!globalPkgStat || globalPkgStat.size > 1024 * 1024) continue;
      const pkg = JSON.parse(fs.readFileSync(globalPkgPath, 'utf-8'));
      if (pkg.version) return \`v\${pkg.version}\`;
    }
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }
  return 'v?';
}
const VERSION = cached('version', TTL.slow, getVersion);

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
      // #681: read-only polling must not take .git/index.lock (a kill leaves it stale)
      env: Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0' }),
    }).trim();
  } catch (err) {
    if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err);
    return '';
  }
}

// Safe JSON file reader (returns null on failure)
// Refuses to load files > 10 MB to prevent OOM on corrupted/oversized stores.
const MAX_JSON_READ_BYTES = 10 * 1024 * 1024;
function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size <= MAX_JSON_READ_BYTES) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }
  return null;
}

// Safe file stat (returns null on failure)
function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }
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
    const remote = cached('gitRemote', TTL.slow, () => safeExec('git remote get-url origin 2>/dev/null', 2000)).trim();
    if (remote) {
      const m = remote.match(/[/:]([\\w.-]+)\\/([\\w.-]+?)(?:\\.git)?$/);
      if (m) return \`\${m[1]}/\${m[2]}\`;
    }
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }
  return path.basename(CWD);
}

// ─── Data Collection (all pure-Node.js or single-exec) ──────────

// Get all git info in ONE shell call (cached for TTL.git)
function getGitInfo() {
  return cached('git', TTL.git, readGitInfo);
}

function readGitInfo() {
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
  // Derive the version from the id (claude-sonnet-5 -> "Sonnet 5", claude-opus-4-6 -> "Opus 4.6")
  // instead of assuming every sonnet/opus id is one fixed release.
  const m = id.match(/(fable|opus|sonnet|haiku)(?:-(\\d+)(?:-(\\d{1,2}))?(?!\\d))?/);
  if (m) {
    const family = m[1][0].toUpperCase() + m[1].slice(1);
    if (!m[2]) return family;
    return family + ' ' + (m[3] ? m[2] + '.' + m[3] : m[2]);
  }
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
      .map(f => ({ f, mt: (() => { try { return fs.statSync(path.join(projectsDir, f)).mtimeMs; } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); return 0; } })() }))
      .sort((a, b) => b.mt - a.mt);
    if (files.length === 0) return null;

    const sessionFile = path.join(projectsDir, files[0].f);
    const sessionStat = safeStat(sessionFile);
    if (!sessionStat || sessionStat.size > 50 * 1024 * 1024) return null; // skip > 50 MB
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
      } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* skip malformed line */ }
    }
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }
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
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }

  // TERTIARY: settings.json model field (configured default, not live session).
  const settings = getSettings();
  if (settings?.model) return modelLabel(settings.model);

  // QUATERNARY: read ANTHROPIC_MODEL or CLAUDE_MODEL env var (set by the CLI at launch)
  const envModel = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || process.env.MODEL;
  if (envModel && envModel.startsWith('claude')) return modelLabel(envModel);

  // QUINARY: current model from the model ID in the env injected by Claude Code itself
  const claudeModel = process.env.CLAUDE_CODE_MODEL;
  if (claudeModel) return modelLabel(claudeModel);

  return 'Sonnet 5'; // known current default rather than the generic "Claude Code"
}

// Get learning stats from memory database (pure stat calls)
function getLearningStats() {
  const memoryPaths = [
    path.join(CWD, '.swarm', 'memory.db'),
    path.join(CWD, '.monomind', 'memory.db'),
    path.join(CWD, '.claude', 'memory.db'),
    path.join(CWD, 'data', 'memory.db'),
    path.join(CWD, '.swarm', 'lancedb'),
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
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }

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
  } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* ignore */ }

  return {
    status: scanCount > 0 ? 'SCANNED' : 'NONE',
    cvesFixed: 0,
    totalCves: 0,
  };
}

// Swarm status (pure file reads, NO ps aux)
function getMonoswarmStatus() {
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
        } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); return false; }
      }).length;
      if (liveCount > 0) {
        return {
          activeAgents: liveCount,
          maxAgents: CONFIG.maxAgents,
          coordinationActive: true,
        };
      }
    } catch (err) { if (process.env.MONOMIND_DEBUG) console.error('[statusline]', err); /* fall through */ }
  }

  // SECONDARY: monoswarm-activity.json refreshed by post-task hook
  const activityData = readJSON(path.join(CWD, '.monomind', 'metrics', 'monoswarm-activity.json'));
  if (activityData?.monoswarm) {
    const updatedAt = activityData.timestamp || activityData.monoswarm.timestamp;
    const age = updatedAt ? now - new Date(updatedAt).getTime() : Infinity;
    if (age < staleThresholdMs) {
      return {
        activeAgents: activityData.monoswarm.agent_count || 0,
        maxAgents: CONFIG.maxAgents,
        coordinationActive: activityData.monoswarm.coordination_active || activityData.monoswarm.active || false,
      };
    }
  }

  return { activeAgents: 0, maxAgents: CONFIG.maxAgents, coordinationActive: false };
}

`;

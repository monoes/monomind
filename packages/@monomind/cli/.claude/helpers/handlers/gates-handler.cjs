/**
 * Enforcement Gates Handler
 *
 * Runs on every PreToolUse — must stay fast (no package import).
 *
 * The regex tables below are the canonical (and only) gate definition; the
 * @monomind/guidance package that used to compile them was removed. An optional
 * project override can still be supplied at `.monomind/guidance/active-gates.json`
 * ({destructivePatterns, secretPatterns} as {source, flags} pairs) — if present
 * and valid it replaces the built-in tables.
 *
 * Gates enforced at runtime:
 *   pre-bash  → destructive-ops  (hard block; no confirm-and-proceed path exists)
 *   pre-write → secrets          (block)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── monofence-ai integration (additional layer on top of regex gates) ───────
//
// monofence-ai (packages/monofence-ai) has real prompt-injection / evasion
// detection but is never wired into the live Claude Code PreToolUse path —
// it only registers hooks on @monomind/hooks' internal HookRegistry, which
// this CJS dispatch path does not use. This loads it lazily (so a missing
// or unbuilt package never breaks the existing regex gates), bounds it with
// a hard timeout, and fails open on any error.

const MONOFENCE_TIMEOUT_MS = 1500;
const MONOFENCE_ABORT_THRESHOLD = 0.8;

let _monofenceModulePromise = null;

/**
 * Resolve and import monofence-ai. Bare-specifier `import('monofence-ai')`
 * only works when this file's ancestor node_modules chain contains the
 * package (pnpm hoists it only into packages that declare it as a direct
 * dependency, e.g. @monomind/cli) — so we also try resolving it explicitly
 * from likely workspace locations before falling back to the bare import.
 */
/**
 * Walk up from `startDir` looking for `<dir>/node_modules/monofence-ai/package.json`.
 * Package "exports" maps intentionally omit "./package.json" as a subpath, so
 * `require.resolve('monofence-ai/package.json', ...)` throws even when the
 * package is present — a plain filesystem walk sidesteps that restriction.
 */
function _findMonofencePkgJson(startDir) {
  var dir = startDir;
  for (var depth = 0; depth < 20; depth++) {
    var candidate = path.join(dir, 'node_modules', 'monofence-ai', 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    var parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function _loadMonofence() {
  if (!_monofenceModulePromise) {
    _monofenceModulePromise = (async () => {
      var candidateDirs = [
        __dirname,
        process.env.CLAUDE_PROJECT_DIR || process.cwd(),
        path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'packages', '@monomind', 'cli'),
        path.join(__dirname, '..', '..', '..', 'packages', '@monomind', 'cli'),
      ];
      var resolvedPkgJson = null;
      for (var i = 0; i < candidateDirs.length; i++) {
        resolvedPkgJson = _findMonofencePkgJson(candidateDirs[i]);
        if (resolvedPkgJson) break;
      }
      var specifier = 'monofence-ai';
      if (resolvedPkgJson) {
        try {
          var pkg = JSON.parse(fs.readFileSync(resolvedPkgJson, 'utf-8'));
          var mainFile = (pkg.exports && pkg.exports['.'] && pkg.exports['.'].import) || pkg.main || 'dist/index.js';
          specifier = 'file://' + path.join(path.dirname(resolvedPkgJson), mainFile);
        } catch (e) { /* fall back to bare specifier below */ }
      }
      try {
        return await import(specifier);
      } catch (e) {
        return null; // not installed / not built — fail open
      }
    })().catch(() => null);
  }
  return _monofenceModulePromise;
}

function _withTimeout(promise, ms) {
  return new Promise((resolve) => {
    var settled = false;
    var timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, ms);
    if (timer.unref) timer.unref();
    Promise.resolve(promise).then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } }
    );
  });
}

/**
 * Scan `input` with monofence-ai's threat detector, bounded by a timeout.
 * Returns null (never throws) when monofence is unavailable, times out, or errors.
 */
async function monofenceScan(input) {
  if (!input || typeof input !== 'string') return null;
  var mod = await _withTimeout(_loadMonofence(), MONOFENCE_TIMEOUT_MS);
  if (!mod || typeof mod.getMonoDefence !== 'function') return null;
  try {
    var defence = mod.getMonoDefence();
    var result = await _withTimeout(defence.detect(input), MONOFENCE_TIMEOUT_MS);
    return result || null;
  } catch (e) {
    return null;
  }
}

/**
 * Given a monofence ThreatDetectionResult, return the highest-confidence
 * threat if it meets the abort threshold, else null.
 */
function monofenceWorstThreat(result) {
  if (!result || result.safe || !Array.isArray(result.threats) || result.threats.length === 0) {
    return null;
  }
  var worst = result.threats.reduce(
    (max, t) => (t.confidence > max.confidence ? t : max),
    result.threats[0]
  );
  return worst.confidence >= MONOFENCE_ABORT_THRESHOLD ? worst : null;
}

// ─── Fallback patterns (used only if the compiled config file is missing/unreadable) ──
const FALLBACK_DESTRUCTIVE_PATTERNS = [
  /\brm\s+(?:-[a-z]*f[a-z]*r|-[a-z]*r[a-z]*f|--recursive.*--force|--force.*--recursive|-rf?)\b/i,
  /\bdrop\s+(database|table|schema|index)\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+.*-f/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sf]\b/i,
  /\b(?:kubectl|helm)\s+delete\s+(?:--all|namespace)\b/i,
  /\bDROP\s+(?:DATABASE|TABLE|SCHEMA)\b/i,
  /\bDELETE\s+FROM\s+\w+/i,
  /\bALTER\s+TABLE\s+\w+\s+DROP\b/i,
];

const FALLBACK_SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:token|bearer)\s*[:=]\s*['"][^'"]{10,}['"]/gi,
  // Unquoted variants — env-style `KEY=value` / `key: value` with no quotes,
  // e.g. `ANTHROPIC_API_KEY=sk-ant-...` in a .env file or shell export. The
  // quoted patterns above never match these, which was the single most
  // common real leak pattern (P1-25).
  /(?:api[_-]?key|apikey|token|secret|password|passwd|pwd)\s*[:=]\s*[^\s'"]{8,}/gi,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /npm_[a-zA-Z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
];

// ─── Compiled config loader ─────────────────────────────────────────────────

var MAX_CONFIG_SIZE = 256 * 1024; // 256 KiB — compiled gate config is small

function toRegExp(serialized) {
  try {
    return new RegExp(serialized.source, serialized.flags);
  } catch (e) {
    return null;
  }
}

/**
 * Load an optional project-level gate override from
 * .monomind/guidance/active-gates.json. Returns the built-in tables when the
 * file is absent (the normal case), oversized, or malformed.
 * Not cached across invocations: each PreToolUse hook is its own subprocess.
 */
function loadCompiledConfig(cwd) {
  try {
    var configPath = path.join(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.monomind', 'guidance', 'active-gates.json');
    var stat = fs.statSync(configPath);
    if (stat.size > MAX_CONFIG_SIZE) throw new Error('active-gates.json too large');
    var raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    var destructivePatterns = Array.isArray(raw.destructivePatterns)
      ? raw.destructivePatterns.map(toRegExp).filter(Boolean)
      : [];
    var secretPatterns = Array.isArray(raw.secretPatterns)
      ? raw.secretPatterns.map(toRegExp).filter(Boolean)
      : [];

    if (destructivePatterns.length === 0 && secretPatterns.length === 0) {
      throw new Error('active-gates.json had no usable patterns');
    }

    return {
      destructivePatterns: raw.destructiveOps === false ? [] : destructivePatterns,
      secretPatterns: raw.secrets === false ? [] : secretPatterns,
    };
  } catch (e) {
    return {
      destructivePatterns: FALLBACK_DESTRUCTIVE_PATTERNS,
      secretPatterns: FALLBACK_SECRET_PATTERNS,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function redact(match) {
  return match.length > 12
    ? match.slice(0, 4) + '*'.repeat(match.length - 8) + match.slice(-4)
    : '*'.repeat(match.length);
}

function checkDestructive(command, patterns) {
  var list = patterns || FALLBACK_DESTRUCTIVE_PATTERNS;
  for (const pattern of list) {
    pattern.lastIndex = 0;
    const match = pattern.exec(command);
    if (match) {
      return {
        triggered: true,
        matched: match[0],
        reason: `Destructive operation blocked: "${match[0]}". This hook always blocks (Claude Code's PreToolUse protocol has no confirm-and-proceed path) — there is no way to run this exact command after confirming. If it's genuinely intended, use a non-destructive equivalent instead (e.g. move the target aside, or scope the operation more narrowly).`,
      };
    }
  }
  return { triggered: false };
}

function checkSecrets(content, patterns) {
  var list = patterns || FALLBACK_SECRET_PATTERNS;
  const found = [];
  for (const pattern of list) {
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    if (matches) {
      for (const m of matches) found.push(redact(m));
    }
  }
  if (found.length === 0) return { triggered: false };
  return {
    triggered: true,
    count: found.length,
    redacted: found,
    reason: `Potential secret(s) detected in file content (${found.length} match${found.length > 1 ? 'es' : ''}): ${found.join(', ')}. Move secrets to environment variables or a .env file (add to .gitignore).`,
  };
}

// ─── Hook handlers ────────────────────────────────────────────────────────────

/**
 * pre-bash: check for destructive shell commands, then (additionally)
 * run monofence-ai's threat detector on the raw command string.
 * Outputs Claude Code block decision to stdout when triggered.
 */
async function handlePreBash(hCtx) {
  var cmd = (hCtx.toolInput && (hCtx.toolInput.command || hCtx.toolInput.cmd)) || '';
  if (!cmd) return;

  var config = loadCompiledConfig(hCtx.CWD);
  var result = checkDestructive(cmd, config.destructivePatterns);
  if (result.triggered) {
    // Set exit code 2 to block, and write the reason to STDERR — per Claude
    // Code's PreToolUse hook protocol, stdout JSON is only parsed when exit
    // code is 0; at exit code 2 the caller reads the block reason from
    // stderr instead, so putting it on stdout here would make it invisible.
    process.stderr.write(JSON.stringify({
      decision: 'block',
      reason: '[gates] ' + result.reason,
    }) + '\n');
    process.exitCode = 2;
    return;
  }

  // Additional layer: monofence-ai threat detection (prompt injection, evasion, etc.)
  // Fails open — never blocks a command just because monofence is unavailable/slow.
  var mf = await monofenceScan(cmd);
  var worst = monofenceWorstThreat(mf);
  if (worst) {
    process.stderr.write(JSON.stringify({
      decision: 'block',
      reason: '[monofence] Threat detected in command — ' + worst.type +
        ' (confidence ' + Math.round(worst.confidence * 100) + '%): ' + worst.description,
    }) + '\n');
    process.exitCode = 2;
  }
}

/**
 * pre-write: check for secrets in Write / Edit / MultiEdit content before it lands on disk,
 * then (additionally) run monofence-ai's threat detector on the same content.
 * Outputs Claude Code block decision to stdout when triggered.
 */
async function handlePreWrite(hCtx) {
  var toolInput = hCtx.toolInput || {};
  // Write: toolInput.content — Edit: toolInput.new_string
  // MultiEdit: toolInput.edits is an array of { old_string, new_string }
  var content = toolInput.content || toolInput.new_string || '';
  if (!content && Array.isArray(toolInput.edits)) {
    content = toolInput.edits.map(function(e) { return e.new_string || ''; }).join('\n');
  }
  if (!content || typeof content !== 'string') return;
  // Cap content at 512 KiB before regex scanning to prevent DoS
  var MAX_SCAN = 524288;
  if (content.length > MAX_SCAN) content = content.slice(0, MAX_SCAN);

  var config = loadCompiledConfig(hCtx.CWD);
  var result = checkSecrets(content, config.secretPatterns);
  if (result.triggered) {
    // Set exit code 2 to block, and write the reason to STDERR — see the
    // matching comment in handlePreBash for why stdout is the wrong stream.
    process.stderr.write(JSON.stringify({
      decision: 'block',
      reason: '[gates] ' + result.reason,
    }) + '\n');
    process.exitCode = 2;
    return;
  }

  // Additional layer: monofence-ai threat detection on the content being written.
  // Fails open — never blocks a write just because monofence is unavailable/slow.
  var mf = await monofenceScan(content);
  var worst = monofenceWorstThreat(mf);
  if (worst) {
    process.stderr.write(JSON.stringify({
      decision: 'block',
      reason: '[monofence] Threat detected in written content — ' + worst.type +
        ' (confidence ' + Math.round(worst.confidence * 100) + '%): ' + worst.description,
    }) + '\n');
    process.exitCode = 2;
  }
}

module.exports = {
  handlePreBash,
  handlePreWrite,
  checkDestructive,
  checkSecrets,
  loadCompiledConfig,
  monofenceScan,
  monofenceWorstThreat,
};

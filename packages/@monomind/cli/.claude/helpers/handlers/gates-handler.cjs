/**
 * Enforcement Gates Handler
 *
 * Inline gate logic for PreToolUse hooks — no ESM/package dependency.
 * This regex table is the canonical (and only) gate definition; the former
 * @monomind/guidance package it mirrored has been removed.
 *
 * Gates enforced at runtime:
 *   pre-bash  → destructive-ops  (hard block; no confirm-and-proceed path exists)
 *   pre-write → secrets          (block)
 */

'use strict';

// ─── Patterns (superset of DEFAULT_GATE_CONFIG in gates.ts) ──────────────────

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(?:-[a-z]*f[a-z]*r|-[a-z]*r[a-z]*f|--recursive.*--force|--force.*--recursive|-rf?)\b/i,
  /\bdrop\s+(database|table|schema|index|view|function|procedure)\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+push\s+(?:.*\s)?(?:--force(?:-with-lease)?|-[a-z]*f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+.*-f/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sf]\b/i,
  /\b(?:kubectl|helm)\s+delete\b.*\b(?:--all|namespace|all)\b/i,
  /\bDELETE\s+FROM\s+\w+/i,
  /\bALTER\s+TABLE\s+\w+\s+DROP\b/i,
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:token|bearer)\s*[:=]\s*['"][^'"]{10,}['"]/gi,
  // Unquoted variants — env-style KEY equals value with no surrounding
  // quotes (the single most common real leak pattern; the quoted patterns
  // above never match a bare assignment in a shell export or .env file).
  /(?:api[_-]?key|apikey|token|secret|password|passwd|pwd)\s*[:=]\s*[^\s'"]{8,}/gi,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /npm_[a-zA-Z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function redact(match) {
  return match.length > 12
    ? match.slice(0, 4) + '*'.repeat(match.length - 8) + match.slice(-4)
    : '*'.repeat(match.length);
}

function checkDestructive(command) {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
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

function checkSecrets(content) {
  const found = [];
  for (const pattern of SECRET_PATTERNS) {
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
 * pre-bash: check for destructive shell commands.
 * Outputs Claude Code block decision to stdout when triggered.
 */
function handlePreBash(hCtx) {
  var cmd = (hCtx.toolInput && (hCtx.toolInput.command || hCtx.toolInput.cmd)) || '';
  if (!cmd) return;

  var result = checkDestructive(cmd);
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
  }
}

/**
 * pre-write: check for secrets in Write / Edit / MultiEdit content before it lands on disk.
 * Outputs Claude Code block decision to stdout when triggered.
 */
function handlePreWrite(hCtx) {
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

  var result = checkSecrets(content);
  if (result.triggered) {
    // Set exit code 2 to block, and write the reason to STDERR — see the
    // matching comment in handlePreBash for why stdout is the wrong stream.
    process.stderr.write(JSON.stringify({
      decision: 'block',
      reason: '[gates] ' + result.reason,
    }) + '\n');
    process.exitCode = 2;
  }
}

module.exports = { handlePreBash, handlePreWrite, checkDestructive, checkSecrets };

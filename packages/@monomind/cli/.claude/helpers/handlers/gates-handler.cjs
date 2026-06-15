/**
 * Enforcement Gates Handler
 *
 * Inline gate logic for PreToolUse hooks — no ESM/package dependency.
 *
 * Patterns are an INTENTIONAL SUPERSET of @monomind/guidance/src/gates.ts defaults:
 *   - All categories from DEFAULT_GATE_CONFIG are covered here
 *   - Many patterns are enhanced (e.g. --force-with-lease, -fr reversed flags, broader kubectl)
 *   - Key thresholds MUST stay aligned: password/secret min length = 8 chars (both files)
 *
 * When updating patterns in gates.ts, check whether the corresponding pattern here
 * also needs updating — and vice versa.
 *
 * Gates enforced at runtime:
 *   pre-bash  → destructive-ops  (require-confirmation → block)
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
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  /sk-[a-zA-Z0-9]{20,}/g,
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
        reason: `Destructive operation detected: "${match[0]}". Confirm this is intentional and document a rollback plan before proceeding.`,
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
    // Output block decision and set exit code 2 — both required by Claude Code PreToolUse protocol
    console.log(JSON.stringify({
      decision: 'block',
      reason: '[gates] ' + result.reason,
    }));
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
    // Output block decision and set exit code 2 — both required by Claude Code PreToolUse protocol
    console.log(JSON.stringify({
      decision: 'block',
      reason: '[gates] ' + result.reason,
    }));
    process.exitCode = 2;
  }
}

module.exports = { handlePreBash, handlePreWrite, checkDestructive, checkSecrets };

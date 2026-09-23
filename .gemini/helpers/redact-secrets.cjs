'use strict';
/**
 * Secret redaction for text that leaves the machine (jev-picker.cjs masks the
 * task and candidate descriptions with it before a decision-model request).
 */
// Ported VERBATIM from packages/@monomind/cli/src/utils/redaction.ts SECRET_PATTERNS
// (the maintained redactor: JSON keys, header bearer tokens, fine-grained GitHub,
// GitLab, Slack, Stripe, JWT, credentialed URLs, AWS/Google keys, Basic auth,
// env passwords). A test compares the two lists source-for-source, so an edit to
// one without the other fails CI.
var SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)['"]?\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  /(?:secret|password|passwd|pwd)['"]?\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  /(?:token|bearer)['"]?\s*[:=]\s*['"]?[^\s'"]{10,}['"]?/gi,
  /\bbearer\s+['"]?[^\s'"]{10,}['"]?/gi,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----(?:[^-]|-(?!----))*-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{16,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /xapp-[A-Za-z0-9-]{10,}/g,
  /hf_[A-Za-z0-9]{30,}/g,
  /ya29\.[A-Za-z0-9_-]{20,}/g,
  /[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /npm_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?<![a-zA-Z0-9_-])eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  /[a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/[^:\s]{1,256}:[^@\s]{1,256}@[^\s'"]+/g,
  /aws_?secret_?access_?key['"]?\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi,
  /AIza[0-9A-Za-z_-]{35}/g,
  /\bauthorization['"]?\s*[:=]\s*['"]?basic\s+[A-Za-z0-9+/]+={0,2}/gi,
  /\b(?:[A-Z0-9]+_)*(?:PASS|PASSWORD|PASSWD|PWD)\s*=\s*['"]?[^\s'"]+['"]?/g,
];

/** Mask credential-shaped text before it leaves the machine — same output as redaction.ts redactSecrets. */
function redactSecrets(text) {
  var out = String(text || '');
  SECRET_PATTERNS.forEach(function (re) {
    out = out.replace(re, '[redacted]');
  });
  return out;
}

// Text is cut to this before redaction, so the synchronous regex pass stays short;
// the margin over the 8000-char Jev state keeps a secret straddling that final
// cut (a PEM block is a few KB) whole.
var REDACT_WINDOW_CHARS = 16000;

/** redactSecrets over the first REDACT_WINDOW_CHARS of `text` only. */
function redactHead(text) {
  return redactSecrets(String(text || '').slice(0, REDACT_WINDOW_CHARS));
}

module.exports = { SECRET_PATTERNS: SECRET_PATTERNS, redactSecrets: redactSecrets, redactHead: redactHead };

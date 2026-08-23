/**
 * Anonymization Pipeline — PII detection
 *
 * Q3: redactPII, anonymizeCFP, scanCFPForPII and the CFPFormat / AnonymizationLevel /
 * AnonymizationRecord types they depended on were deleted along with the
 * speculative pattern-sharing subtree that consumed them. Only detectPII
 * remains — it backs the `transfer_detect-pii` MCP tool.
 */

import * as crypto from 'node:crypto';

/** Result shape returned by detectPII. */
export interface PIIDetectionResult {
  found: boolean;
  count: number;
  types: Record<string, number>;
  locations: Array<{
    type: string;
    path: string;
    sample: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

/**
 * PII detection patterns
 */
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ipv4: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  ipv6: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
  apiKey: /\b(sk-|pk-|api[_-]?key[_-]?)[a-zA-Z0-9]{20,}\b/gi,
  jwt: /\beyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g,
  homePath: /\/(Users|home|Documents)\/[a-zA-Z0-9_.-]+/g,
  windowsPath: /[A-Z]:\\Users\\[a-zA-Z0-9_.-]+/g,
};

/**
 * Hash a string for consistent pseudonymization
 */
function _hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Maximum content size for PII scanning/redaction (4 MB). */
const MAX_SCAN_SIZE = 4 * 1024 * 1024;

/**
 * Detect PII in a string
 */
export function detectPII(content: string): PIIDetectionResult {
  if (content.length > MAX_SCAN_SIZE) {
    throw new Error(`detectPII: content too large (${content.length} bytes; max ${MAX_SCAN_SIZE})`);
  }
  const result: PIIDetectionResult = {
    found: false,
    count: 0,
    types: {},
    locations: [],
  };

  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = content.match(pattern);
    if (matches) {
      result.found = true;
      result.count += matches.length;
      result.types[type] = matches.length;

      for (const match of matches.slice(0, 5)) {
        result.locations.push({
          type,
          path: 'content',
          sample: match.slice(0, 20) + (match.length > 20 ? '...' : ''),
          severity: getSeverity(type),
        });
      }
    }
  }

  return result;
}

/**
 * Get severity for PII type
 */
function getSeverity(type: string): 'low' | 'medium' | 'high' | 'critical' {
  switch (type) {
    case 'apiKey':
    case 'jwt':
      return 'critical';
    case 'email':
    case 'phone':
      return 'high';
    case 'ipv4':
    case 'ipv6':
      return 'medium';
    default:
      return 'low';
  }
}

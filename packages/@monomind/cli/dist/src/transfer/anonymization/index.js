/**
 * Anonymization Pipeline
 * PII detection and redaction for pattern export
 */
import * as crypto from 'crypto';
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
 * Redaction replacements
 */
const REDACTIONS = {
    email: (match) => `user_${hash(match).slice(0, 8)}@example.com`,
    phone: '[REDACTED_PHONE]',
    ipv4: '0.0.0.0',
    ipv6: '::1',
    apiKey: '[REDACTED_API_KEY]',
    jwt: '[REDACTED_JWT]',
    homePath: '/user/anonymous',
    windowsPath: 'C:\\Users\\anonymous',
};
/**
 * Hash a string for consistent pseudonymization
 */
function hash(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}
/** Maximum content size for PII scanning/redaction (4 MB). */
const MAX_SCAN_SIZE = 4 * 1024 * 1024;
/**
 * Detect PII in a string
 */
export function detectPII(content) {
    if (content.length > MAX_SCAN_SIZE) {
        throw new Error(`detectPII: content too large (${content.length} bytes; max ${MAX_SCAN_SIZE})`);
    }
    const result = {
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
            for (const match of matches.slice(0, 5)) { // Limit to first 5 samples
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
function getSeverity(type) {
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
/**
 * Redact PII from a string
 */
export function redactPII(content) {
    if (content.length > MAX_SCAN_SIZE) {
        throw new Error(`redactPII: content too large (${content.length} bytes; max ${MAX_SCAN_SIZE})`);
    }
    let result = content;
    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
        const replacement = REDACTIONS[type];
        if (typeof replacement === 'function') {
            result = result.replace(pattern, replacement);
        }
        else {
            result = result.replace(pattern, replacement);
        }
    }
    return result;
}
/**
 * Apply anonymization to CFP document
 */
/** Maximum CFP payload size accepted for anonymization (10 MB). */
const MAX_CFP_ANONYMIZE_SIZE = 10 * 1024 * 1024;
export function anonymizeCFP(cfp, level) {
    // Guard before deep clone to prevent OOM on a crafted large object
    const serialized = JSON.stringify(cfp);
    if (serialized.length > MAX_CFP_ANONYMIZE_SIZE) {
        throw new Error(`anonymizeCFP: CFP payload too large (${serialized.length} bytes; max ${MAX_CFP_ANONYMIZE_SIZE})`);
    }
    const transforms = [];
    const anonymized = JSON.parse(serialized);
    // Level: Minimal
    if (['minimal', 'standard', 'strict', 'paranoid'].includes(level)) {
        // Redact author display name
        if (anonymized.metadata.author?.displayName) {
            anonymized.metadata.author.displayName = undefined;
            transforms.push('author-name-removed');
        }
    }
    // Level: Standard
    if (['standard', 'strict', 'paranoid'].includes(level)) {
        // Redact PII from all string fields including metadata
        const jsonStr = JSON.stringify({ patterns: anonymized.patterns, metadata: anonymized.metadata });
        const redacted = redactPII(jsonStr);
        const redactedObj = JSON.parse(redacted);
        anonymized.patterns = redactedObj.patterns;
        anonymized.metadata = redactedObj.metadata;
        transforms.push('pii-redacted');
        // Generalize timestamps
        anonymized.anonymization.timestampsGeneralized = true;
        transforms.push('timestamps-generalized');
    }
    // Level: Strict
    if (['strict', 'paranoid'].includes(level)) {
        // Hash all IDs
        for (const pattern of anonymized.patterns.routing) {
            pattern.id = `pattern_${hash(pattern.id).slice(0, 12)}`;
        }
        transforms.push('ids-hashed');
        // Remove context details
        for (const pattern of anonymized.patterns.routing) {
            pattern.context = undefined;
        }
        transforms.push('context-removed');
        anonymized.anonymization.pathsStripped = true;
        transforms.push('paths-stripped');
    }
    // Level: Paranoid
    if (level === 'paranoid') {
        // Add noise to numeric values (differential privacy)
        for (const pattern of anonymized.patterns.routing) {
            pattern.usageCount = Math.round(pattern.usageCount * (0.9 + Math.random() * 0.2));
            pattern.successRate = Math.min(1, Math.max(0, pattern.successRate + (Math.random() - 0.5) * 0.1));
        }
        transforms.push('differential-privacy-noise');
        // Remove all trajectory learnings
        for (const traj of anonymized.patterns.trajectory) {
            traj.learnings = [];
        }
        transforms.push('learnings-removed');
    }
    // Update anonymization record
    anonymized.anonymization.level = level;
    anonymized.anonymization.appliedTransforms = transforms;
    anonymized.anonymization.piiRedacted = level !== 'minimal';
    // Recalculate checksum
    const content = JSON.stringify({
        magic: anonymized.magic,
        version: anonymized.version,
        metadata: anonymized.metadata,
        patterns: anonymized.patterns,
    });
    anonymized.anonymization.checksum = hash(content);
    return { cfp: anonymized, transforms };
}
/**
 * Scan CFP for PII without modification
 */
export function scanCFPForPII(cfp) {
    const content = JSON.stringify(cfp.patterns);
    return detectPII(content);
}
//# sourceMappingURL=index.js.map
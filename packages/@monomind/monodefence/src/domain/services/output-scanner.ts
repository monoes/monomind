/**
 * OutputScanner Service
 *
 * Analyzes LLM output for 4 signals:
 * 1. PII leakage — does the output contain PII?
 * 2. Prompt echo — does the output echo the original prompt (trigram Jaccard >= 0.4)?
 * 3. Policy violation — does the output contain disallowed patterns?
 * 4. Contradiction detection — does the output say "I cannot" then proceed to do it?
 */

import { OutputScanResult } from '../entities/threat.js';

export interface ScanOptions {
  output: string;
  originalPrompt?: string;
}

/**
 * PII detection patterns (no g flag — stateless .test() calls)
 */
const PII_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, type: 'email' },
  { pattern: /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, type: 'phone' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, type: 'ssn' },
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/, type: 'credit_card' },
];

/**
 * Policy violation patterns (no g flag — stateless .test() calls)
 */
const POLICY_PATTERNS: RegExp[] = [
  /\b(?:how\s+to\s+make|instructions?\s+(?:for|to)\s+(?:mak|creat|build))\s+(?:bomb|explosive|weapon|malware|virus)/i,
  /\b(?:step[\s-]by[\s-]step|detailed\s+instructions?)\s+(?:to|for)\s+(?:kill|harm|attack|hack|crack)/i,
  /\b(?:step[\s-]by[\s-]step|detailed)\s+instructions?\s+(?:to|for)\s+(?:mak\w*|creat\w*|build)\s+(?:bomb|explosive|weapon|malware|virus)/i,
];

/**
 * Contradiction detection pattern: disclaimer sentence followed by substantial content
 * No g flag — stateless .test() call
 */
const CONTRADICTION_PATTERN =
  /(i\s+(?:cannot|can't|am\s+unable\s+to|won't)\s+\S+[^.!?]*[.!?])\s+.{20,}/i;

/**
 * Build a set of character trigrams from text
 */
function trigramSet(text: string): Set<string> {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const trigrams = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) {
    trigrams.add(s.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Compute Jaccard similarity between two trigram sets
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

const ECHO_THRESHOLD = 0.4;

/**
 * OutputScanner analyzes LLM output for security signals
 */
export class OutputScanner {
  async scan(opts: ScanOptions): Promise<OutputScanResult> {
    const startTime = Date.now();
    const { output, originalPrompt } = opts;

    // 1. PII leakage detection
    const leakageTypes: string[] = [];
    for (const { pattern, type } of PII_PATTERNS) {
      if (pattern.test(output)) {
        leakageTypes.push(type);
      }
    }
    const leakageFound = leakageTypes.length > 0;

    // 2. Prompt echo detection (trigram Jaccard >= 0.4)
    let echoDetected = false;
    if (originalPrompt && originalPrompt.length > 0) {
      const promptTrigrams = trigramSet(originalPrompt);
      const outputTrigrams = trigramSet(output);
      const similarity = jaccardSimilarity(promptTrigrams, outputTrigrams);
      echoDetected = similarity >= ECHO_THRESHOLD;
    }

    // 3. Policy violation detection
    let policyViolation = false;
    for (const pattern of POLICY_PATTERNS) {
      if (pattern.test(output)) {
        policyViolation = true;
        break;
      }
    }

    // 4. Contradiction detection
    const contradictionSignal = CONTRADICTION_PATTERN.test(output);

    const safe = !leakageFound && !echoDetected && !policyViolation && !contradictionSignal;
    const scanTimeMs = Date.now() - startTime;

    return {
      safe,
      leakageFound,
      leakageTypes,
      echoDetected,
      policyViolation,
      contradictionSignal,
      scanTimeMs,
    };
  }
}

/**
 * Factory function to create an OutputScanner instance
 */
export function createOutputScanner(): OutputScanner {
  return new OutputScanner();
}

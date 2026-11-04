/**
 * V1 Intelligence Module — pattern persistence API
 * Split out of intelligence.ts (file-size sweep). Pure move.
 *
 * @module v1/cli/intelligence
 */

import { cosineSimilarity } from '../utils/cosine-similarity.js';
import { initializeIntelligence, reasoningBank, savePersistedStats } from './intelligence.js';
import { loadSonaRoutingPatterns } from './intelligence-sona-routing.js';
import type { Pattern } from './intelligence-types.js';

/**
 * Get all patterns from ReasoningBank, merged with SONA routing patterns.
 * Returns persisted patterns even after process restart.
 */
export async function getAllPatterns(): Promise<Pattern[]> {
  if (!reasoningBank) {
    const init = await initializeIntelligence();
    if (!init.success) return [];
  }
  const bank = reasoningBank;
  if (!bank) return [];

  const bankPatterns = bank.getAll().map((p) => ({
    id: p.id,
    type: p.type,
    embedding: p.embedding,
    content: p.content,
    confidence: p.confidence,
    usageCount: p.usageCount,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  }));

  // Merge in SONA routing patterns so `neural patterns list` shows what
  // the hooks SONA optimizer has learned, not just ReasoningBank entries.
  const bankIds = new Set(bankPatterns.map((p) => p.id));
  const sonaPatterns = loadSonaRoutingPatterns().filter((p) => !bankIds.has(p.id));

  return [...bankPatterns, ...sonaPatterns];
}

/**
 * Get patterns by type from ReasoningBank
 */
export async function getPatternsByType(type: string): Promise<Pattern[]> {
  if (!reasoningBank) {
    const init = await initializeIntelligence();
    if (!init.success) return [];
  }
  const bank = reasoningBank;
  if (!bank) return [];

  return bank.getByType(type).map((p) => ({
    id: p.id,
    type: p.type,
    embedding: p.embedding,
    content: p.content,
    confidence: p.confidence,
    usageCount: p.usageCount,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  }));
}

/**
 * Flush patterns to disk immediately
 * Call this at the end of training to ensure all patterns are saved
 */
export function flushPatterns(): void {
  if (reasoningBank) {
    reasoningBank.flushToDisk();
  }
  savePersistedStats();
}

/**
 * Compact patterns by removing duplicates/similar patterns
 * @param threshold Similarity threshold (0-1), patterns above this are considered duplicates
 */
export async function compactPatterns(threshold: number = 0.95): Promise<{
  before: number;
  after: number;
  removed: number;
}> {
  if (!reasoningBank) {
    const init = await initializeIntelligence();
    if (!init.success) {
      return { before: 0, after: 0, removed: 0 };
    }
  }
  const bank = reasoningBank;
  if (!bank) return { before: 0, after: 0, removed: 0 };

  const patterns = bank.getAll();
  const before = patterns.length;

  // Find duplicates using cosine similarity
  const toRemove: Set<string> = new Set();

  for (let i = 0; i < patterns.length; i++) {
    const patternA = patterns[i];
    if (!patternA || toRemove.has(patternA.id)) continue;

    const embA = patternA.embedding;
    if (!embA || embA.length === 0) continue;

    for (let j = i + 1; j < patterns.length; j++) {
      const patternB = patterns[j];
      if (!patternB || toRemove.has(patternB.id)) continue;

      const embB = patternB.embedding;
      if (!embB || embB.length === 0 || embA.length !== embB.length) continue;

      const similarity = cosineSimilarity(embA, embB);

      if (similarity >= threshold) {
        // Remove the one with lower usage count
        const useA = patternA.usageCount || 0;
        const useB = patternB.usageCount || 0;
        toRemove.add(useA >= useB ? patternB.id : patternA.id);
      }
    }
  }

  // Remove duplicates
  for (const id of toRemove) {
    bank.delete(id);
  }

  // Flush to disk
  flushPatterns();

  return {
    before,
    after: before - toRemove.size,
    removed: toRemove.size,
  };
}

/**
 * Delete a pattern by ID
 */
export async function deletePattern(id: string): Promise<boolean> {
  if (!reasoningBank) {
    const init = await initializeIntelligence();
    if (!init.success) return false;
  }
  const bank = reasoningBank;
  if (!bank) return false;

  return bank.delete(id);
}

/**
 * Clear all patterns (both in memory and on disk)
 */
export async function clearAllPatterns(): Promise<void> {
  if (!reasoningBank) {
    const init = await initializeIntelligence();
    if (!init.success) return;
  }
  const bank = reasoningBank;
  if (!bank) return;

  bank.clear();
}

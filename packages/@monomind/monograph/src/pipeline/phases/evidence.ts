import type { EvidenceEntry } from '../../types.js';

export function makeEvidence(kind: string, weight: number, note?: string): EvidenceEntry {
  return { kind, weight: Math.max(0, Math.min(1, weight)), note };
}

export function mergeEvidence(existing: EvidenceEntry[] | undefined, entry: EvidenceEntry): EvidenceEntry[] {
  return [...(existing ?? []), entry];
}

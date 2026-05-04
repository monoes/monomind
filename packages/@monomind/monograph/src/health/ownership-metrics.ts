export type ContributorIdentifierFormat = 'raw' | 'handle' | 'hash';

export interface ContributorEntry {
  identifier: string;
  format: ContributorIdentifierFormat;
  share: number;
  staleDays: number;
  commits: number;
}

export interface OwnershipMetrics {
  busFactor: number;
  contributorCount: number;
  topContributor: ContributorEntry;
  recentContributors: ContributorEntry[];
  suggestedReviewers: ContributorEntry[];
  declaredOwner?: string;
  unowned?: boolean;
  drift: boolean;
  driftReason?: string;
}

export interface HotspotSummary {
  since: string;
  minCommits: number;
  filesAnalyzed: number;
  filesExcluded: number;
  shallowClone: boolean;
}

export function computeBusFactor(contributors: ContributorEntry[]): number {
  if (contributors.length === 0) return 0;
  const sorted = [...contributors].sort((a, b) => b.share - a.share);
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].share;
    if (cumulative >= 0.5) return i + 1;
  }
  return sorted.length;
}

export function filterSuggestedReviewers(
  contributors: ContributorEntry[],
  topContributor: ContributorEntry,
  maxStaleDays = 90,
): ContributorEntry[] {
  return contributors
    .filter(c => c.identifier !== topContributor.identifier && c.staleDays <= maxStaleDays)
    .slice(0, 3);
}

export function formatOwnershipMetrics(m: OwnershipMetrics): string {
  const lines: string[] = [
    `Bus factor: ${m.busFactor}  (${m.contributorCount} contributor${m.contributorCount !== 1 ? 's' : ''})`,
    `Top: ${m.topContributor.identifier} (${(m.topContributor.share * 100).toFixed(1)}%)`,
  ];
  if (m.declaredOwner) lines.push(`Owner: ${m.declaredOwner}`);
  if (m.unowned) lines.push('(unowned — no CODEOWNERS rule matched)');
  if (m.drift) lines.push(`Drift: ${m.driftReason ?? 'unknown reason'}`);
  return lines.join('\n');
}

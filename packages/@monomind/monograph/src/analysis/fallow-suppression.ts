export type FallowIssueKind =
  | 'unused-file'
  | 'unused-export'
  | 'unused-type'
  | 'private-type-leak'
  | 'unused-dependency'
  | 'unused-dev-dependency'
  | 'unused-enum-member'
  | 'unused-class-member'
  | 'unresolved-import'
  | 'unlisted-dependency'
  | 'duplicate-export'
  | 'code-duplication'
  | 'circular-dependency'
  | 'type-only-dependency'
  | 'test-only-dependency'
  | 'boundary-violation'
  | 'coverage-gaps'
  | 'feature-flag'
  | 'complexity'
  | 'stale-suppression';

export interface FallowSuppression {
  line: number;
  commentLine: number;
  kind: FallowIssueKind | null;
}

const DISCRIMINANT_MAP: Record<FallowIssueKind, number> = {
  'unused-file': 1,
  'unused-export': 2,
  'unused-type': 3,
  'private-type-leak': 4,
  'unused-dependency': 5,
  'unused-dev-dependency': 6,
  'unused-enum-member': 7,
  'unused-class-member': 8,
  'unresolved-import': 9,
  'unlisted-dependency': 10,
  'duplicate-export': 11,
  'code-duplication': 12,
  'circular-dependency': 13,
  'type-only-dependency': 14,
  'test-only-dependency': 15,
  'boundary-violation': 16,
  'coverage-gaps': 17,
  'feature-flag': 18,
  'complexity': 19,
  'stale-suppression': 20,
};

const DISCRIMINANT_REVERSE: FallowIssueKind[] = [
  'unused-file',
  'unused-export',
  'unused-type',
  'private-type-leak',
  'unused-dependency',
  'unused-dev-dependency',
  'unused-enum-member',
  'unused-class-member',
  'unresolved-import',
  'unlisted-dependency',
  'duplicate-export',
  'code-duplication',
  'circular-dependency',
  'type-only-dependency',
  'test-only-dependency',
  'boundary-violation',
  'coverage-gaps',
  'feature-flag',
  'complexity',
  'stale-suppression',
];

const VALID_KINDS = new Set<string>(Object.keys(DISCRIMINANT_MAP));

export function parseFallowIssueKind(s: string): FallowIssueKind | undefined {
  if (s === 'circular-dependencies') return 'circular-dependency';
  if (VALID_KINDS.has(s)) return s as FallowIssueKind;
  return undefined;
}

export function issueKindToDiscriminant(kind: FallowIssueKind): number {
  return DISCRIMINANT_MAP[kind];
}

export function issueKindFromDiscriminant(d: number): FallowIssueKind | undefined {
  if (d <= 0 || d > 20) return undefined;
  return DISCRIMINANT_REVERSE[d - 1];
}

export function isFallowSuppression(line: number): boolean {
  return line === 0 || line > 0;
}

export function isFileWideSuppression(suppression: FallowSuppression): boolean {
  return suppression.line === 0;
}

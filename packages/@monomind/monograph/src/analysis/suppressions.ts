export type SuppressionKind =
  | 'unused-export'
  | 'unused-file'
  | 'unused-member'
  | 'complexity'
  | 'coverage-gaps'
  | 'code-duplication'
  | 'dead-code'
  | 'boundary'
  | 'codeowners';

export const NON_CORE_KINDS: SuppressionKind[] = [
  'complexity',
  'coverage-gaps',
  'code-duplication',
];

export interface Suppression {
  path: string;
  line: number;
  col: number;
  kind: SuppressionKind;
  comment?: string;
}

export interface StaleSuppression extends Suppression {
  description(): string;
  explanation(): string;
}

export interface SuppressionContext {
  suppressions: Suppression[];
  consumed: Set<string>; // key: `${path}:${line}:${kind}`
}

export function createSuppressionContext(suppressions: Suppression[]): SuppressionContext {
  return {
    suppressions: [...suppressions],
    consumed: new Set<string>(),
  };
}

export function suppressionKey(s: Suppression): string {
  return `${s.path}:${s.line}:${s.kind}`;
}

export function markConsumed(
  ctx: SuppressionContext,
  path: string,
  line: number,
  kind: SuppressionKind,
): void {
  ctx.consumed.add(`${path}:${line}:${kind}`);
}

export function findStale(ctx: SuppressionContext): StaleSuppression[] {
  return ctx.suppressions
    .filter((s) => {
      const key = suppressionKey(s);
      const isConsumed = ctx.consumed.has(key);
      const isNonCore = NON_CORE_KINDS.includes(s.kind);
      // Keep (return as stale) if NOT consumed AND NOT a non-core kind
      return !isConsumed && !isNonCore;
    })
    .map((s): StaleSuppression => {
      return {
        ...s,
        description(): string {
          return `Stale suppression of kind "${s.kind}" at ${s.path}:${s.line}:${s.col}`;
        },
        explanation(): string {
          const comment = s.comment ? ` (comment: "${s.comment}")` : '';
          return `The suppression for "${s.kind}" at line ${s.line} in "${s.path}" was never matched by an actual issue${comment}. It can be safely removed.`;
        },
      };
    });
}

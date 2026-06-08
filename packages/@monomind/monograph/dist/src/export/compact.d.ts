import type { MonographDb } from '../storage/db.js';
/**
 * Export a compact one-line-per-issue text format suitable for CLI output
 * and machine consumption by shell pipelines.
 *
 * Line formats:
 *   unreachable-file:{path}
 *   god-node:{path}:{line}:{name}
 *   duplicate:{path}:{name}
 *   boundary-violation:{path}:{line}:{rule}
 */
export declare function exportCompact(db: MonographDb, repoRoot?: string): string;
//# sourceMappingURL=compact.d.ts.map
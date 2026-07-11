/**
 * Universal Search Command
 *
 * Queries all activated capabilities via CapabilityManager.search() and
 * renders merged, score-ranked results grouped by content type.
 */
import type { Command } from '../types.js';
import type { SearchResult, CapabilityName, DirectoryScan } from '../capabilities/types.js';
export declare function groupByType(results: SearchResult[]): Partial<Record<CapabilityName, SearchResult[]>>;
export declare function formatSearchResults(results: SearchResult[]): string;
/**
 * Scan the working directory for content-type capabilities and persist an
 * updated fingerprint to .monomind/. Shared by `search scan` and the
 * auto-rescan path in `search` (formerly the standalone `scan` command).
 */
export declare function runCapabilityScan(cwd: string): Promise<DirectoryScan>;
export declare const searchUniversalCommand: Command;
export default searchUniversalCommand;
//# sourceMappingURL=search-universal.d.ts.map
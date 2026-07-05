/**
 * Universal Search Command
 *
 * Queries all activated capabilities via CapabilityManager.search() and
 * renders merged, score-ranked results grouped by content type.
 */
import type { Command } from '../types.js';
import type { SearchResult, CapabilityName } from '../capabilities/types.js';
export declare function groupByType(results: SearchResult[]): Partial<Record<CapabilityName, SearchResult[]>>;
export declare function formatSearchResults(results: SearchResult[]): string;
export declare const searchUniversalCommand: Command;
export default searchUniversalCommand;
//# sourceMappingURL=search-universal.d.ts.map
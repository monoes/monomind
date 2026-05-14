/**
 * Pattern Search Service
 * Search and filter patterns from decentralized registry
 */
import type { PatternRegistry, PatternEntry, SearchOptions, SearchResult } from './types.js';
/**
 * Search patterns in registry
 */
export declare function searchPatterns(registry: PatternRegistry, options?: SearchOptions): SearchResult;
/**
 * Get featured patterns
 */
export declare function getFeaturedPatterns(registry: PatternRegistry): PatternEntry[];
/**
 * Get trending patterns
 */
export declare function getTrendingPatterns(registry: PatternRegistry): PatternEntry[];
/**
 * Get newest patterns
 */
export declare function getNewestPatterns(registry: PatternRegistry): PatternEntry[];
/**
 * Get pattern by ID
 */
export declare function getPatternById(registry: PatternRegistry, patternId: string): PatternEntry | undefined;
/**
 * Get pattern by name
 */
export declare function getPatternByName(registry: PatternRegistry, name: string): PatternEntry | undefined;
/**
 * Get patterns by author
 */
export declare function getPatternsByAuthor(registry: PatternRegistry, authorId: string): PatternEntry[];
/**
 * Get patterns by category
 */
export declare function getPatternsByCategory(registry: PatternRegistry, categoryId: string): PatternEntry[];
/**
 * Get similar patterns (by tags and category)
 */
export declare function getSimilarPatterns(registry: PatternRegistry, pattern: PatternEntry, limit?: number): PatternEntry[];
/**
 * Get category stats
 */
export declare function getCategoryStats(registry: PatternRegistry): Map<string, number>;
/**
 * Get tag cloud (tag -> count)
 */
export declare function getTagCloud(registry: PatternRegistry): Map<string, number>;
/**
 * Autocomplete search suggestions
 */
export declare function getSearchSuggestions(registry: PatternRegistry, partial: string, limit?: number): string[];
//# sourceMappingURL=search.d.ts.map
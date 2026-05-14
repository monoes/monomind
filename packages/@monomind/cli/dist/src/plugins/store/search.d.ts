/**
 * Plugin Search Service
 * Search and filter plugins from the registry
 */
import type { PluginEntry, PluginRegistry, PluginSearchOptions, PluginSearchResult } from './types.js';
/**
 * Search plugins in the registry
 */
export declare function searchPlugins(registry: PluginRegistry, options?: PluginSearchOptions): PluginSearchResult;
/**
 * Get search suggestions based on partial query
 */
export declare function getPluginSearchSuggestions(registry: PluginRegistry, partialQuery: string, limit?: number): string[];
/**
 * Get tag cloud with counts
 */
export declare function getPluginTagCloud(registry: PluginRegistry): Map<string, number>;
/**
 * Get category statistics
 */
export declare function getPluginCategoryStats(registry: PluginRegistry): Map<string, number>;
/**
 * Find similar plugins based on tags and category
 */
export declare function findSimilarPlugins(registry: PluginRegistry, pluginId: string, limit?: number): PluginEntry[];
/**
 * Get featured plugins
 */
export declare function getFeaturedPlugins(registry: PluginRegistry): PluginEntry[];
/**
 * Get trending plugins
 */
export declare function getTrendingPlugins(registry: PluginRegistry): PluginEntry[];
/**
 * Get newest plugins
 */
export declare function getNewestPlugins(registry: PluginRegistry): PluginEntry[];
/**
 * Get official plugins
 */
export declare function getOfficialPlugins(registry: PluginRegistry): PluginEntry[];
/**
 * Get plugins by permission
 */
export declare function getPluginsByPermission(registry: PluginRegistry, permission: string): PluginEntry[];
//# sourceMappingURL=search.d.ts.map
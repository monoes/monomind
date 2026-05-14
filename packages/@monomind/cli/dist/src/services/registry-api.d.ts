/**
 * Registry API Client
 * Secure integration with Monomind Cloud Functions
 *
 * Security:
 * - HTTPS only
 * - No credentials stored in code
 * - Rate limiting respected
 * - Input validation
 */
export interface RatingResponse {
    success: boolean;
    itemId: string;
    average: number;
    count: number;
    error?: string;
}
export interface BulkRatingsResponse {
    [itemId: string]: {
        average: number;
        count: number;
    };
}
export interface AnalyticsResponse {
    downloads: Record<string, number>;
    exports: number;
    imports: number;
    publishes: number;
}
/**
 * Rate a plugin or model
 */
export declare function rateItem(itemId: string, rating: number, itemType?: 'plugin' | 'model', userId?: string): Promise<RatingResponse>;
/**
 * Get ratings for a single item
 */
export declare function getRating(itemId: string, itemType?: 'plugin' | 'model'): Promise<RatingResponse>;
/**
 * Get ratings for multiple items (batch)
 */
export declare function getBulkRatings(itemIds: string[], itemType?: 'plugin' | 'model'): Promise<BulkRatingsResponse>;
/**
 * Get analytics data
 */
export declare function getAnalytics(): Promise<AnalyticsResponse>;
/**
 * Track a download event
 */
export declare function trackDownload(pluginId: string): Promise<void>;
/**
 * Check API health
 */
export declare function checkHealth(): Promise<{
    healthy: boolean;
    latestCid?: string;
    error?: string;
}>;
//# sourceMappingURL=registry-api.d.ts.map
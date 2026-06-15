export interface RouteOutcomeRecord {
    routeId: string;
    ts: number;
    task: string;
    recommendedAgent: string;
    routingMethod: string;
    confidence: number;
    learningMode: 'native' | 'js';
    agentActuallyUsed?: string;
    measuredSuccess?: boolean;
    quality?: number;
}
/** Append a route recommendation (pre-outcome). Opportunistically trims the
 *  file to MAX_ROUTE_RECORDS lines to prevent unbounded growth. */
export declare function recordRoute(baseDir: string, rec: RouteOutcomeRecord): Promise<void>;
/** Join outcome data onto the most recent matching route record by routeId. */
export declare function joinOutcome(baseDir: string, routeId: string, outcome: {
    agentActuallyUsed?: string;
    measuredSuccess?: boolean;
    quality?: number;
}): Promise<void>;
/**
 * Join an outcome to the most recent route record that has no measured outcome yet.
 * Used when the caller does not thread an explicit routeId — auto-correlates the
 * latest recommendation to the next task completion. Returns the joined routeId or null.
 */
export declare function joinLatestUnresolved(baseDir: string, outcome: {
    agentActuallyUsed?: string;
    measuredSuccess?: boolean;
    quality?: number;
}, maxAgeMs?: number): Promise<string | null>;
/** Read all outcome records (for metrics). */
export declare function readOutcomes(baseDir: string): Promise<RouteOutcomeRecord[]>;
export interface RoutingAccuracy {
    window: number;
    totalWithOutcome: number;
    accuracy: number | null;
    byMode: {
        native: number | null;
        js: number | null;
    };
    recentVsPrior: number | null;
}
/**
 * Compute routing accuracy over the most recent N records that have a joined outcome.
 * accuracy = fraction of records whose joined outcome reports measuredSuccess === true.
 * (agentActuallyUsed is recorded per row but not required to match the recommendation;
 * the success label already reflects whether the chosen routing worked out.)
 */
export declare function computeRoutingAccuracy(baseDir: string, window?: number): Promise<RoutingAccuracy>;
/** Fraction of joined routes where the agent actually used matched the recommendation. */
export declare function computeAdherence(baseDir: string, window?: number): Promise<{
    adherence: number | null;
    sample: number;
}>;
//# sourceMappingURL=route-outcomes.d.ts.map
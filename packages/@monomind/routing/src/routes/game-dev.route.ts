import type { Route } from '../types.js';

/**
 * No bundled agent specialises in game development, and a route must name an
 * agent that can be spawned, so this group is empty. Kept as an export so
 * importers of `gameDevRoutes` keep working.
 */
export const gameDevRoutes: Route[] = [];

export { coreRoutes } from './core.route.js';
export { securityRoutes } from './security.route.js';
export { engineeringRoutes } from './engineering.route.js';
export { testingRoutes } from './testing.route.js';
export { designRoutes } from './design.route.js';
export { marketingRoutes } from './marketing.route.js';
export { productRoutes } from './product.route.js';
export { specializedRoutes } from './specialized.route.js';
export { gameDevRoutes } from './game-dev.route.js';

import { coreRoutes } from './core.route.js';
import { securityRoutes } from './security.route.js';
import { engineeringRoutes } from './engineering.route.js';
import { testingRoutes } from './testing.route.js';
import { designRoutes } from './design.route.js';
import { marketingRoutes } from './marketing.route.js';
import { productRoutes } from './product.route.js';
import { specializedRoutes } from './specialized.route.js';
import { gameDevRoutes } from './game-dev.route.js';
import type { Route } from '../types.js';

/** All routes combined — use this with RouteLayer for full agent coverage */
export const ALL_ROUTES: Route[] = [
  ...coreRoutes,
  ...securityRoutes,
  ...engineeringRoutes,
  ...testingRoutes,
  ...designRoutes,
  ...marketingRoutes,
  ...productRoutes,
  ...specializedRoutes,
  ...gameDevRoutes,
];

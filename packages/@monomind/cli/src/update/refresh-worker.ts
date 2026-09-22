/**
 * Detached child spawned by refreshUpdateCacheInBackground() (`monomind
 * --version`). The parent already reserved the rate-limit slot, so this only
 * fetches the latest versions and rewrites the update cache. It prints
 * nothing, and fails silently (offline, registry down) — the next check
 * after the interval retries.
 */

import { checkForUpdates, DEFAULT_CONFIG } from './checker.js';

// Hard ceiling on the whole refresh: registry fetches time out at 5s each,
// but a hung resolver or `npm prefix -g` probe must not leave this lingering.
setTimeout(() => process.exit(0), 20_000).unref();

checkForUpdates(DEFAULT_CONFIG, { slotReserved: true })
  .catch(() => {
    /* silent */
  })
  .finally(() => process.exit(0));

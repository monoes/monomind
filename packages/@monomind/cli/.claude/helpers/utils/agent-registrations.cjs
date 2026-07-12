'use strict';
// Shared agent-registration purge logic.
//
// .monomind/agents/registrations/*.json accumulate one file per subagent
// spawn. The only purge used to be the FIFO-oldest-removal + stale sweep in
// task-handler.cjs's handlePostTask, which only fires on TeammateIdle/
// TaskCompleted — so any session that spawns agents but never emits those
// events (crashes, single-shot Task calls outside a team, etc.) leaked
// registrations forever. agent-start-handler.cjs already reads this
// directory on every subagent start, so it also runs this same stale sweep.

const path = require('path');
const fs = require('fs');
const { cleanEntries } = require('./fs-helpers.cjs');

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Delete registration files older than maxAgeMs. Returns the number of
 * registrations remaining after the purge (or null if regDir doesn't exist
 * or an error occurred).
 */
function purgeStaleRegistrations(regDir, maxAgeMs) {
  maxAgeMs = maxAgeMs || DEFAULT_MAX_AGE_MS;
  try {
    if (!fs.existsSync(regDir)) return null;
    const now = Date.now();
    for (const f of cleanEntries(regDir, f => f.endsWith('.json'))) {
      try {
        if (now - fs.statSync(path.join(regDir, f)).mtimeMs > maxAgeMs) {
          fs.unlinkSync(path.join(regDir, f));
        }
      } catch { /* ignore */ }
    }
    return cleanEntries(regDir, f => f.endsWith('.json')).length;
  } catch {
    return null;
  }
}

module.exports = { purgeStaleRegistrations, DEFAULT_MAX_AGE_MS };

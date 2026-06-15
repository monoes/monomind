/**
 * Per-route outcome records — the join between a routing recommendation and
 * what actually happened. This is the foundation for routing-accuracy metrics
 * and for giving SONA a real training label.
 */
import { promises as fs, statSync } from 'node:fs';
import { join } from 'node:path';

/** Refuse to read files larger than this to prevent OOM. */
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Cap string fields stored in each record to prevent file bloat. */
const MAX_FIELD_LEN = 500;

export interface RouteOutcomeRecord {
  routeId: string;
  ts: number;
  task: string;
  recommendedAgent: string;
  routingMethod: string;      // 'keyword' | 'neural-augmented' | 'native-hnsw' | etc.
  confidence: number;
  learningMode: 'native' | 'js';  // whether native @monoes was active
  // Joined at post-task:
  agentActuallyUsed?: string;
  measuredSuccess?: boolean;
  quality?: number;
}

function storePath(baseDir: string): string {
  return join(baseDir, 'route-outcomes.jsonl');
}

/** Maximum number of records to keep in route-outcomes.jsonl.
 *  computeRoutingAccuracy only ever reads the last 100 records, so anything
 *  older is dead weight. Keeping 500 gives a comfortable buffer while bounding
 *  the file size and keeping joinOutcome's full-file rewrite cheap. */
const MAX_ROUTE_RECORDS = 500;

/** Conservative estimate of bytes per record (capped fields + JSON overhead).
 *  Used to gate whether a stat-only check can rule out a trim pass.
 *  Actual records are ~200-400 bytes; 600 gives a 2× safety margin so we
 *  never skip a needed trim, only unnecessary reads. */
const APPROX_BYTES_PER_RECORD = 600;

/** Append a route recommendation (pre-outcome). Opportunistically trims the
 *  file to MAX_ROUTE_RECORDS lines to prevent unbounded growth. */
export async function recordRoute(baseDir: string, rec: RouteOutcomeRecord): Promise<void> {
  try {
    await fs.mkdir(baseDir, { recursive: true });
    const path = storePath(baseDir);
    // Cap string fields to prevent individual records from bloating the file.
    const safeRec: RouteOutcomeRecord = {
      ...rec,
      routeId: rec.routeId.slice(0, MAX_FIELD_LEN),
      task: rec.task.slice(0, MAX_FIELD_LEN),
      recommendedAgent: rec.recommendedAgent.slice(0, MAX_FIELD_LEN),
      routingMethod: rec.routingMethod.slice(0, 64),
    };
    await fs.appendFile(path, JSON.stringify(safeRec) + '\n', 'utf8');
    // Opportunistic trim: only read the file when it is large enough to
    // plausibly contain more than MAX_ROUTE_RECORDS lines.  The stat() call
    // is cheap (metadata-only); skipping the full read on the common path
    // avoids O(file-size) I/O on every routing call.
    const fileStat = await fs.stat(path).catch(() => null);
    if (fileStat && fileStat.size > MAX_ROUTE_RECORDS * APPROX_BYTES_PER_RECORD) {
      const content = await fs.readFile(path, 'utf8').catch(() => '');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length > MAX_ROUTE_RECORDS) {
        await fs.writeFile(path, lines.slice(-MAX_ROUTE_RECORDS).join('\n') + '\n', 'utf8');
      }
    }
  } catch {
    // Non-fatal — telemetry must never break routing
  }
}

/** Join outcome data onto the most recent matching route record by routeId. */
export async function joinOutcome(
  baseDir: string,
  routeId: string,
  outcome: { agentActuallyUsed?: string; measuredSuccess?: boolean; quality?: number }
): Promise<void> {
  try {
    const path = storePath(baseDir);
    try { if (statSync(path).size > MAX_FILE_BYTES) return; } catch { /* file absent */ }
    const content = await fs.readFile(path, 'utf8').catch(() => '');
    if (!content) return;
    const lines = content.trim().split('\n');
    // Find the last record with this routeId and merge outcome
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const rec = JSON.parse(lines[i]) as RouteOutcomeRecord;
        if (rec.routeId === routeId) {
          lines[i] = JSON.stringify({ ...rec, ...outcome });
          break;
        }
      } catch { /* skip malformed line */ }
    }
    await fs.writeFile(path, lines.join('\n') + '\n', 'utf8');
  } catch {
    // Non-fatal
  }
}

/**
 * Join an outcome to the most recent route record that has no measured outcome yet.
 * Used when the caller does not thread an explicit routeId — auto-correlates the
 * latest recommendation to the next task completion. Returns the joined routeId or null.
 */
export async function joinLatestUnresolved(
  baseDir: string,
  outcome: { agentActuallyUsed?: string; measuredSuccess?: boolean; quality?: number },
  maxAgeMs = 600_000  // only correlate within 10 minutes to avoid stale joins
): Promise<string | null> {
  try {
    const path = storePath(baseDir);
    try { if (statSync(path).size > MAX_FILE_BYTES) return null; } catch { /* file absent */ }
    const content = await fs.readFile(path, 'utf8').catch(() => '');
    if (!content) return null;
    const lines = content.trim().split('\n');
    const now = Date.now();
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const rec = JSON.parse(lines[i]) as RouteOutcomeRecord;
        // Skip already-joined records
        if (typeof rec.measuredSuccess === 'boolean') continue;
        // Skip stale records beyond the correlation window
        if (now - rec.ts > maxAgeMs) return null;
        lines[i] = JSON.stringify({ ...rec, ...outcome });
        await fs.writeFile(path, lines.join('\n') + '\n', 'utf8');
        return rec.routeId;
      } catch { /* skip malformed */ }
    }
    return null;
  } catch {
    return null;
  }
}

/** Read all outcome records (for metrics). */
export async function readOutcomes(baseDir: string): Promise<RouteOutcomeRecord[]> {
  try {
    const p = storePath(baseDir);
    try { if (statSync(p).size > MAX_FILE_BYTES) return []; } catch { /* file absent */ }
    const content = await fs.readFile(p, 'utf8').catch(() => '');
    if (!content) return [];
    return content.trim().split('\n').map(l => {
      try { return JSON.parse(l) as RouteOutcomeRecord; } catch { return null; }
    }).filter((r): r is RouteOutcomeRecord => r !== null);
  } catch {
    return [];
  }
}

export interface RoutingAccuracy {
  window: number;            // how many recent records considered
  totalWithOutcome: number;  // records that have measuredSuccess joined
  accuracy: number | null;   // successes / totalWithOutcome, null if no data
  byMode: { native: number | null; js: number | null }; // accuracy split by learningMode
  recentVsPrior: number | null; // delta: recent-half accuracy minus prior-half (trend)
}

/**
 * Compute routing accuracy over the most recent N records that have a joined outcome.
 * accuracy = fraction of records whose joined outcome reports measuredSuccess === true.
 * (agentActuallyUsed is recorded per row but not required to match the recommendation;
 * the success label already reflects whether the chosen routing worked out.)
 */
export async function computeRoutingAccuracy(baseDir: string, window = 100): Promise<RoutingAccuracy> {
  const all = await readOutcomes(baseDir);
  // Only records with a measured outcome count
  const withOutcome = all.filter(r => typeof r.measuredSuccess === 'boolean').slice(-window);
  const n = withOutcome.length;
  if (n === 0) {
    return { window, totalWithOutcome: 0, accuracy: null, byMode: { native: null, js: null }, recentVsPrior: null };
  }
  const succ = (recs: typeof withOutcome) =>
    recs.length ? recs.filter(r => r.measuredSuccess).length / recs.length : null;
  const native = withOutcome.filter(r => r.learningMode === 'native');
  const js = withOutcome.filter(r => r.learningMode === 'js');
  const mid = Math.floor(n / 2);
  const prior = succ(withOutcome.slice(0, mid));
  const recent = succ(withOutcome.slice(mid));
  return {
    window,
    totalWithOutcome: n,
    accuracy: succ(withOutcome),
    byMode: { native: succ(native), js: succ(js) },
    recentVsPrior: (recent !== null && prior !== null) ? recent - prior : null,
  };
}

/** Fraction of joined routes where the agent actually used matched the recommendation. */
export async function computeAdherence(baseDir: string, window = 100): Promise<{ adherence: number | null; sample: number }> {
  const all = await readOutcomes(baseDir);
  const joined = all.filter(r => r.agentActuallyUsed && r.recommendedAgent).slice(-window);
  if (joined.length === 0) return { adherence: null, sample: 0 };
  const matches = joined.filter(r => r.agentActuallyUsed === r.recommendedAgent).length;
  return { adherence: matches / joined.length, sample: joined.length };
}

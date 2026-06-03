/**
 * Per-route outcome records — the join between a routing recommendation and
 * what actually happened. This is the foundation for routing-accuracy metrics
 * and for giving SONA a real training label.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

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

/** Append a route recommendation (pre-outcome). */
export async function recordRoute(baseDir: string, rec: RouteOutcomeRecord): Promise<void> {
  try {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.appendFile(storePath(baseDir), JSON.stringify(rec) + '\n', 'utf8');
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

/** Read all outcome records (for metrics). */
export async function readOutcomes(baseDir: string): Promise<RouteOutcomeRecord[]> {
  try {
    const content = await fs.readFile(storePath(baseDir), 'utf8').catch(() => '');
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

/**
 * Orchestrates semantic routing for the CLI consumers (`monomind route` and
 * `monomind agent --task`), isolating the embedding model in a child process.
 *
 * Flow per task:
 *   1. Keyword pre-filter (in-process, no model) — fast exact matches.
 *   2. Real-embedding semantic scoring in an isolated worker (embed-worker.js).
 *      The model can't run in the main process (native onnxruntime SIGSEGV), so
 *      it runs in a child; a worker crash is a non-zero exit, not a process kill.
 *   3. If the worker's best match is below the calibrated threshold, run the
 *      headless Claude Code (Haiku) LLM fallback — in the parent, where its auth
 *      lives — using the worker's candidate scores.
 *   4. If the worker fails for any reason, degrade to the dependency-free
 *      hash-encoder RouteLayer (+ Claude fallback). Routing always returns.
 */
// ⚠️ ISOLATION BOUNDARY: this module runs in the MAIN process. Do NOT import
// `./embedder` or `@huggingface/transformers` here (directly or transitively) —
// loading onnxruntime in-process deterministically SIGSEGVs. The model lives
// ONLY in embed-worker.ts, reached via the spawn below.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'embed-worker.js');

/** Generous: the first-ever run computes + caches ~500 utterance embeddings. */
const WORKER_TIMEOUT_MS = 90_000;

/** Cap worker stdout so a runaway child can't grow parent memory unbounded. */
const MAX_WORKER_OUTPUT = 4 * 1024 * 1024; // 4 MB

/** Cap the task string length to prevent OOM/DoS via oversized argv. */
const MAX_TASK_LENGTH = 2_000;

/** Cap stderr reflected in error messages to prevent log-inflation attacks. */
const MAX_STDERR_IN_ERROR = 500;

/** Cap allScores array passed to the LLM fallback to prevent downstream OOM. */
const MAX_ALL_SCORES = 100;

/** Marker the worker prefixes its result line with (see embed-worker.ts). */
const RESULT_MARKER = '__ROUTE_RESULT__';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteResult = any;

/** Run the embedding worker for one task. Resolves the RouteResult, or rejects. */
function runWorker(task: string): Promise<RouteResult> {
  // Cap task length before passing as argv to prevent OOM/DoS via oversized args.
  const safeTask = task.length > MAX_TASK_LENGTH ? task.slice(0, MAX_TASK_LENGTH) : task;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_PATH, safeTask], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      reject(new Error('embed worker timed out'));
    }, WORKER_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_WORKER_OUTPUT) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
        reject(new Error('embed worker produced excessive output'));
      }
    });
    child.stderr?.on('data', (d: Buffer) => { if (stderr.length < MAX_WORKER_OUTPUT) stderr += d.toString(); });
    child.on('error', (e: Error) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        // Truncate stderr before embedding in Error to prevent log-inflation via
        // a malicious or runaway child writing oversized diagnostic output.
        const stderrSnippet = stderr.trim().slice(0, MAX_STDERR_IN_ERROR);
        reject(new Error(stderrSnippet || `worker exited ${code}`));
        return;
      }
      // Extract the marked result line — model-loader output may have written
      // stray bytes to stdout, so don't assume the whole buffer is JSON.
      const markedLine = stdout
        .split('\n')
        .reverse()
        .find((l) => l.startsWith(RESULT_MARKER));
      if (!markedLine) { reject(new Error('worker produced no result marker')); return; }
      try { resolve(JSON.parse(markedLine.slice(RESULT_MARKER.length))); }
      catch { reject(new Error('worker produced invalid JSON')); }
    });
  });
}

export interface ConfiguredRouteLayer {
  route: (taskDescription: string) => Promise<RouteResult>;
}

export async function createConfiguredRouteLayer(
  opts: { debug?: boolean } = {},
): Promise<ConfiguredRouteLayer> {
  const { RouteLayer, KeywordPreFilter, LLMFallbackRouter, ALL_ROUTES } =
    await import('@monomind/routing' as string);
  const { createClaudeLLMCaller } = await import('./llm-caller.js');

  const llmCaller = createClaudeLLMCaller({ model: 'haiku' });
  const keyword = new KeywordPreFilter();

  return {
    async route(taskDescription: string): Promise<RouteResult> {
      // 1. Keyword pre-filter — fast, no model, avoids spawning the worker.
      const kw = keyword.match(taskDescription);
      if (kw) return kw;

      // 2. Real-embedding semantic scoring in the isolated worker.
      let semantic: RouteResult | null = null;
      try {
        semantic = await runWorker(taskDescription);
      } catch (err) {
        // Degradation must be visible: silently dropping to the hash encoder
        // (~12% top-1 accuracy) would look like working semantic routing.
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[route] semantic worker unavailable (${reason}); using keyword + hash fallback\n`,
        );
        semantic = null; // fall through to degraded path
      }

      if (semantic) {
        if (semantic.method === 'semantic') {
          // The worker always computes allScores (for the fallback path); only
          // surface them when the caller explicitly asked for debug output.
          if (!opts.debug) delete semantic.allScores;
          return semantic;
        }
        // 3. Below threshold → Claude fallback in the parent, reusing scores.
        if (llmCaller && Array.isArray(semantic.allScores) && semantic.allScores.length) {
          // Cap allScores to prevent downstream OOM if the worker sends an oversized array.
          const scores = semantic.allScores.length > MAX_ALL_SCORES
            ? semantic.allScores.slice(0, MAX_ALL_SCORES)
            : semantic.allScores;
          const fallback = new LLMFallbackRouter({ llmCaller, model: 'haiku' });
          return fallback.classify(taskDescription, ALL_ROUTES, scores);
        }
        if (!opts.debug) delete semantic.allScores;
        return semantic; // best semantic match (no Claude available)
      }

      // 4. Worker unavailable/crashed → degrade to hash encoder + Claude fallback.
      const layer = new RouteLayer({
        routes: ALL_ROUTES,
        enableKeywordFilter: false, // keyword pre-filter already ran above
        debug: opts.debug,
        ...(llmCaller ? { llmFallback: { llmCaller, model: 'haiku' } } : {}),
      });
      return layer.route(taskDescription);
    },
  };
}

/**
 * Proves the semantic routing worker is runnable when the CLI runs from src/
 * (tsx / vitest), not only from dist/.
 *
 * Before the fix, `route-layer-factory.ts` hardcoded `embed-worker.js`, which
 * does not exist under src/ — every source-side route logged
 * "[route] semantic worker unavailable ... using keyword + hash fallback" and
 * silently scored with the ~12%-accurate hash encoder. These tests fail if that
 * regression comes back: they assert the fallback stderr line is NEVER written
 * and that the result carries a real embedding score.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  resolveWorkerArgv,
  createConfiguredRouteLayer,
} from '../routing/route-layer-factory.js';

const SOURCE_WORKER = fileURLToPath(new URL('../routing/embed-worker.ts', import.meta.url));

/**
 * Is the local embedding model actually usable here?
 *
 * The semantic path needs both `@huggingface/transformers` (an
 * optionalDependency, so it can be absent) and the arctic-embed weights, which
 * are ~88MB cached under the package's `.cache/` and are NOT present on a fresh
 * checkout. Neither is something a unit test should download.
 *
 * This must be checked before asserting, because a missing model makes the
 * worker exit non-zero and the parent print the exact "semantic worker
 * unavailable" line this test watches for — a cold CI machine would otherwise
 * fail with a signature identical to the regression itself.
 */
async function embeddingModelAvailable(): Promise<boolean> {
  const require = createRequire(import.meta.url);
  let entry: string;
  try {
    // Resolve the main entry, not '<pkg>/package.json' — this package does not
    // list package.json in its `exports`, so asking for it throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED even when the package is installed.
    entry = require.resolve('@huggingface/transformers');
  } catch {
    return false; // optionalDependency not installed
  }

  // Walk up from dist/<entry>.cjs to the package root (the dir with its
  // package.json), then look for the weight cache beside it.
  let dir = dirname(entry);
  for (let i = 0; i < 5 && !existsSync(join(dir, 'package.json')); i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Without cached weights the first embed would download ~88MB from inside
  // `npm test`, so treat "installed but no weights" as unavailable.
  const cache = join(dir, '.cache');
  return existsSync(join(cache, 'Snowflake')) || existsSync(join(cache, 'Xenova'));
}

describe('embed worker resolution', () => {
  it('resolves the .ts worker (via tsx) when running from source', () => {
    // This suite runs from src/, so only the .ts worker exists.
    expect(existsSync(SOURCE_WORKER)).toBe(true);

    const argv = resolveWorkerArgv();
    expect(argv).toHaveLength(2);
    expect(argv[0]).toMatch(/tsx/);
    expect(argv[1]).toBe(SOURCE_WORKER);
  });
});

describe('semantic routing from source', () => {
  it(
    'routes through the REAL embedding worker, not the keyword/hash fallback',
    async (ctx) => {
      // This test needs the arctic-embed weights (~88MB), which are cached in
      // node_modules and absent on a fresh checkout. Without this guard the
      // test fails on a cold CI machine with the *exact* stderr signature it
      // exists to detect — "semantic worker unavailable" — so a missing model
      // would be indistinguishable from the regression. Skip loudly instead;
      // matches memory-retrieval-quality.test.ts, which guards the same way.
      if (!(await embeddingModelAvailable())) {
        ctx.skip(); // model not available in this environment — do not fake a pass
        return;
      }

      // The worker inherits this env. onnxruntime otherwise spins one compute
      // thread per core, which starves the rest of the suite (other test files
      // spawn servers with short startup deadlines) while the model runs.
      // Scoped to the worker rather than mutated globally: assigning to
      // process.env here would leak into every other test sharing this vitest
      // worker process.
      process.env.OMP_NUM_THREADS ??= '1';
      process.env.ORT_NUM_THREADS ??= '1';

      const stderrLines: string[] = [];
      const original = process.stderr.write.bind(process.stderr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = (chunk: any, ...rest: any[]) => {
        stderrLines.push(String(chunk));
        return original(chunk, ...rest);
      };

      let result: Record<string, unknown>;
      try {
        const layer = await createConfiguredRouteLayer({ debug: true });
        // Deliberately phrased so the keyword pre-filter cannot match it —
        // no agent name, no routing keyword, just a described symptom.
        result = await layer.route(
          'the login page throws a null pointer when the session cookie is missing',
        );
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.stderr as any).write = original;
      }

      // 1. The degradation notice must never have been printed.
      const degraded = stderrLines.filter((l) => l.includes('semantic worker unavailable'));
      expect(degraded).toEqual([]);

      // 2. The result must come from the embedding path.
      expect(result.method).toBe('semantic');

      // 3. Sanity only — NOT proof of the embedding path. The hash fallback
      //    was measured at 0.872 on this same phrase, so a high confidence
      //    does not discriminate between the two encoders. The assertions that
      //    actually fail when the fallback is active are #1 (the stderr line)
      //    and #5 (a semantically correct match, which the hash encoder gets
      //    wrong). Kept because a confidence outside this range would mean
      //    something else broke.
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence as number).toBeGreaterThan(0.8);

      // 4. Per-route scores present and distinct. Also non-discriminating on
      //    its own — the hash encoder yields distinct floats too.
      const scores = result.allScores as Array<{ routeName: string; score: number }>;
      expect(Array.isArray(scores)).toBe(true);
      expect(scores.length).toBeGreaterThan(10);
      const uniqueScores = new Set(scores.map((s) => s.score));
      expect(uniqueScores.size).toBeGreaterThan(10);

      // 5. Semantically correct top match for a security/auth symptom.
      expect(['security-engineer', 'security-auditor', 'security-architect']).toContain(
        result.routeName,
      );
    },
    240_000,
  );
});

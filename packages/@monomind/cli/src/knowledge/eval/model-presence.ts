/**
 * Model provisioning assert.
 *
 * WHY THIS EXISTS — a measured failure, not a hypothetical.
 *
 * The first `proven-blocked` baseline was produced on a machine whose model
 * cache was already warm. Relocating the cache and re-running showed the truth:
 * the embedding weights are NOT git-tracked (they live under
 * `node_modules/.../@huggingface/transformers/.cache`), so a genuinely clean
 * checkout has no model, and the first embedding call DOWNLOADS ~91MB.
 *
 * Worse, the harness was hiding it. The `searchMethod` probe ran BEFORE the
 * network guard was installed, so the download happened outside the guarded
 * window and the report still said "0 attempts". A check whose failure
 * condition has been quietly moved out of its own scope is not a check.
 *
 * Stop-condition clauses 3 ("clean checkout") and 4 ("no network at query
 * time") are jointly unsatisfiable if the first query fetches a model. The
 * ruling: weights are provisioned by an explicit, documented, NON-QUERY-TIME
 * step, and the eval ASSERTS their presence and fails loudly rather than ever
 * fetching them.
 *
 * @module v1/cli/knowledge/eval/model-presence
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

export interface ModelPresence {
  model: string;
  present: boolean;
  /** Where the weights were found, or the locations searched if absent. */
  resolvedPath: string | null;
  searched: string[];
  bytes: number;
  /** How the weights got there — the provisioning story, on the artefact. */
  provenance: 'node_modules cache (populated by a prior run or an explicit warm step)' | 'not provisioned';
}

const MODEL_ID = 'Alibaba-NLP/gte-modernbert-base';
const WEIGHT_CANDIDATES = [
  'onnx/model_quantized.onnx',
  'onnx/model_q8.onnx',
  'onnx/model.onnx',
];

/**
 * Where the weights could be. Resolution has to be thorough: the first version
 * of this only looked at `<cwd>/node_modules/@huggingface/...`, missed the real
 * pnpm-hoisted location entirely, and so reported "not provisioned" while a
 * perfectly good 89MB model sat on disk. An assert that fires for the wrong
 * reason is barely better than one that never fires.
 */
function transformersCacheDirs(searchRoots: string[]): string[] {
  const dirs: string[] = [];
  // Explicit override wins, and is the documented provisioning hook.
  if (process.env.TRANSFORMERS_CACHE) dirs.push(process.env.TRANSFORMERS_CACHE);
  if (process.env.MONOMIND_MODEL_CACHE) dirs.push(process.env.MONOMIND_MODEL_CACHE);

  for (const root of searchRoots) {
    try {
      const req = createRequire(path.join(root, 'index.js'));
      const pkg = req.resolve('@huggingface/transformers/package.json');
      dirs.push(path.join(path.dirname(pkg), '.cache'));
    } catch { /* not resolvable from this root */ }
    dirs.push(path.join(root, 'node_modules', '@huggingface', 'transformers', '.cache'));
    // pnpm keeps the real package under a mangled directory name; the resolver
    // above usually finds it, but not when the caller runs from a built dist
    // whose module graph never referenced the package.
    const pnpm = path.join(root, 'node_modules', '.pnpm');
    try {
      for (const entry of fs.readdirSync(pnpm)) {
        if (entry.startsWith('@huggingface+transformers')) {
          dirs.push(path.join(pnpm, entry, 'node_modules', '@huggingface', 'transformers', '.cache'));
        }
      }
    } catch { /* no pnpm store here */ }
  }
  return [...new Set(dirs)];
}

export function checkModelPresence(searchRoots: string[] = [process.cwd()]): ModelPresence {
  const searched: string[] = [];
  for (const dir of transformersCacheDirs(searchRoots)) {
    for (const rel of WEIGHT_CANDIDATES) {
      const p = path.join(dir, MODEL_ID, rel);
      searched.push(p);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.size > 1_000_000) {
          return {
            model: MODEL_ID, present: true, resolvedPath: p, searched, bytes: st.size,
            provenance: 'node_modules cache (populated by a prior run or an explicit warm step)',
          };
        }
      } catch { /* keep searching */ }
    }
  }
  return { model: MODEL_ID, present: false, resolvedPath: null, searched, bytes: 0, provenance: 'not provisioned' };
}

/** Throws unless the weights are already on disk. Never fetches. */
export function assertModelProvisioned(searchRoots: string[] = [process.cwd()]): ModelPresence {
  const p = checkModelPresence(searchRoots);
  if (!p.present) {
    throw new Error(
      `[doc eval] EMBEDDING MODEL NOT PROVISIONED: ${MODEL_ID} was not found on disk.\n` +
      `  The eval will not download it. A harness that silently fetches a model mid-run both\n` +
      `  violates the zero-network-at-query-time condition and makes the run non-reproducible.\n` +
      `  Provision it as an explicit, non-query-time step, then re-run.\n` +
      `  Searched:\n    ${p.searched.join('\n    ')}`,
    );
  }
  return p;
}

/**
 * The explicit, NON-QUERY-TIME provisioning step.
 *
 * This is the only place in the eval path permitted to touch the network, it
 * must be invoked deliberately (`monomind doc eval --provision-model`), and it
 * never runs as a side effect of measuring anything. That separation is the
 * whole point: it makes "clean checkout" and "zero network at query time"
 * jointly satisfiable, which they are not when the first query downloads 90MB.
 */
export async function provisionModel(log: (m: string) => void): Promise<ModelPresence> {
  const already = checkModelPresence([process.cwd()]);
  if (already.present) {
    log(`already provisioned: ${(already.bytes / 1e6).toFixed(0)}MB at ${already.resolvedPath}`);
  } else {
    log(`fetching ${MODEL_ID} — this is the provisioning step and it REQUIRES network access.`);
    log('It is deliberately separate from measurement; `doc eval` itself never fetches.');
    const t = await import('@huggingface/transformers');
    await (t as any).pipeline('feature-extraction', MODEL_ID, { revision: 'main', dtype: 'q8' });
    const after = checkModelPresence([process.cwd()]);
    if (!after.present) throw new Error('[doc eval] provisioning ran but the weights are still not on disk.');
    log(`provisioned: ${(after.bytes / 1e6).toFixed(0)}MB at ${after.resolvedPath}`);
  }
  // Also provision the cross-encoder reranker (ettin-32m) if not already present.
  await provisionReranker(log);
  return checkModelPresence([process.cwd()]);
}

const RERANKER_MODEL_ID = 'cross-encoder/ettin-reranker-32m-v1';

/** Check whether the reranker ONNX weights are present on disk. */
export function checkRerankerPresence(searchRoots: string[] = [process.cwd()]): ModelPresence {
  const searched: string[] = [];
  for (const dir of transformersCacheDirs(searchRoots)) {
    for (const rel of WEIGHT_CANDIDATES) {
      const p = path.join(dir, RERANKER_MODEL_ID, rel);
      searched.push(p);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.size > 500_000) {
          return {
            model: RERANKER_MODEL_ID, present: true, resolvedPath: p, searched, bytes: st.size,
            provenance: 'node_modules cache (populated by a prior run or an explicit warm step)',
          };
        }
      } catch { /* keep searching */ }
    }
  }
  return { model: RERANKER_MODEL_ID, present: false, resolvedPath: null, searched, bytes: 0, provenance: 'not provisioned' };
}

/** Provision the cross-encoder reranker model (ettin-32m). Same separation as
 *  the embedding model: explicit, non-query-time, never a side-effect. */
export async function provisionReranker(log: (m: string) => void): Promise<ModelPresence> {
  const already = checkRerankerPresence([process.cwd()]);
  if (already.present) {
    log(`reranker already provisioned: ${(already.bytes / 1e6).toFixed(0)}MB at ${already.resolvedPath}`);
    return already;
  }
  log(`fetching ${RERANKER_MODEL_ID} — provisioning the cross-encoder reranker.`);
  const t = await import('@huggingface/transformers');
  // text-classification pipeline loads the cross-encoder architecture.
  // No dtype override — ettin uses non-standard quantized filenames (e.g.
  // model_qint8_arm64.onnx) that don't match the _quantized suffix convention.
  // FP32 model.onnx is ~120MB for 32M params — acceptable for a reranker.
  await (t as any).pipeline('text-classification', RERANKER_MODEL_ID, { revision: 'main' });
  const after = checkRerankerPresence([process.cwd()]);
  if (!after.present) throw new Error('[doc eval] reranker provisioning ran but the weights are still not on disk.');
  log(`reranker provisioned: ${(after.bytes / 1e6).toFixed(0)}MB at ${after.resolvedPath}`);
  return after;
}

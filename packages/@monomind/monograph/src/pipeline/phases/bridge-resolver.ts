import type { PipelinePhase } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { ScanOutput } from './scan.js';
import { BUILTIN_BRIDGE_ADAPTERS } from './bridge-adapters/registry.js';
import type { BridgeEndpoint } from './bridge-adapters/types.js';

export interface BridgeResolverOutput {
  edgesCreated: number;
}

/**
 * Cross-language bridge resolution — links calls across an FFI/IPC boundary
 * that no single language's own import/call resolution can see (Wails'
 * generated Go<->JS bindings, Tauri's invoke() commands, Electron's IPC
 * channels, ...). Each adapter in bridge-adapters/ extracts (key, nodeId)
 * pairs from both sides; here they're matched by key and turned into CALLS
 * edges — reusing the existing relation so every existing consumer
 * (monograph_impact, monograph_neighbors, community detection) picks them up
 * with no changes on their end.
 *
 * Confidence is always INFERRED: a bridge edge is a name/key match, not an
 * AST-verified call. A key with more than one matching definition is
 * dropped rather than guessed at — the call site can't know which one was
 * meant, and a wrong edge is worse than a missing one. Multiple call sites
 * sharing one definition (the common case: several UI files calling the
 * same bound method) is normal and always kept.
 */
export const bridgeResolverPhase: PipelinePhase<BridgeResolverOutput> = {
  name: 'bridge-resolver',
  deps: ['scan', 'structure', 'parse'],
  async execute(ctx, deps) {
    if (ctx.allFilesCached) return { edgesCreated: 0 };

    const { filePaths } = deps.get('scan') as ScanOutput;
    const edges: MonographEdge[] = [];

    for (const adapter of BUILTIN_BRIDGE_ADAPTERS) {
      if (!adapter.detect(ctx, filePaths)) continue;

      const definitions = adapter.findDefinitions(ctx, filePaths);
      const callSites = adapter.findCallSites(ctx, filePaths);
      if (definitions.length === 0 || callSites.length === 0) continue;

      const definitionsByKey = new Map<string, BridgeEndpoint[]>();
      for (const def of definitions) {
        const arr = definitionsByKey.get(def.key);
        if (arr) arr.push(def);
        else definitionsByKey.set(def.key, [def]);
      }

      for (const callSite of callSites) {
        const matches = definitionsByKey.get(callSite.key);
        if (!matches || matches.length !== 1) continue; // 0 or ambiguous — drop, don't guess
        const target = matches[0]!;
        if (target.nodeId === callSite.nodeId) continue; // same node on both sides — nothing to link

        const id = makeId('bridge', adapter.name, callSite.nodeId, target.nodeId);
        edges.push({
          id,
          sourceId: callSite.nodeId,
          targetId: target.nodeId,
          relation: 'CALLS',
          confidence: 'INFERRED',
          confidenceScore: CONFIDENCE_SCORE.INFERRED,
          reason: `${adapter.name} bridge: "${callSite.key}"`,
          evidence: [{ kind: 'bridge', weight: CONFIDENCE_SCORE.INFERRED, note: adapter.name }],
        });
      }
    }

    if (edges.length > 0) insertEdges(ctx.db, edges);
    return { edgesCreated: edges.length };
  },
};

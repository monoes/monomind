import type { ResolvedBoundaryConfig } from '../config/boundary-config.js';
import { classifyZone, isImportAllowed } from '../config/boundary-config.js';
import type { ModuleNode } from '../graph/node-types.js';
import { ModuleNodeFlags } from '../graph/node-types.js';
import type { FallowBoundaryViolation } from '../results/fallow-results.js';

export interface BoundaryAnalysisResult {
  violations: FallowBoundaryViolation[];
  checkedEdges: number;
  uncheckedFiles: number;
}

function isReachableOrEntry(mod: ModuleNode): boolean {
  return (
    (mod.flags & ModuleNodeFlags.REACHABLE) !== 0 ||
    (mod.flags & ModuleNodeFlags.ENTRY_POINT) !== 0
  );
}

function hasRules(config: ResolvedBoundaryConfig, zoneName: string): boolean {
  return config.rules.some(r => r.from.name === zoneName);
}

interface CrossFileEdge {
  toFile: string;
  line: number;
  col: number;
}

/**
 * Every file `mod` reaches into another module through: barrel re-exports
 * (`mod.reExports`) and, WHEN PRESENT, symbol references (`mod.references`,
 * where `fromFile` is the file the imported symbol lives in — see
 * graph/node-types.ts). `references` carries real line numbers; `reExports`
 * does not, so those edges still report line 1.
 *
 * CAVEAT (found in review, kept here rather than silently reverted): the
 * ONLY writer of `ModuleNode.references` anywhere in this package is
 * graph/re-exports/propagate.ts's barrel-re-export propagation — a plain
 * `import { x } from '../other-zone/y'` with no barrel/re-export anywhere in
 * the chain never populates `references` at all, so this function does NOT
 * actually catch that case despite reading as if it does. Fixing that
 * properly means teaching some real import-graph builder to push a
 * SymbolReference for every ordinary import, which nothing in this package
 * currently does — `analyzeBoundaries`/`findBoundaryViolations` here (and
 * their sibling `unused-exports.ts`) have zero production callers; both
 * operate purely on hand-constructed ModuleNode fixtures in their own test
 * files, not on any real parsed codebase. If you need working, wired-up
 * boundary checking today, use `pipeline/phases/boundary.ts`'s
 * `detectBoundaryViolations`, which queries the SQLite `edges` table
 * directly and already covers every import edge, barrel or not.
 */
function edgesForModule(mod: ModuleNode): CrossFileEdge[] {
  const seen = new Set<string>();
  const edges: CrossFileEdge[] = [];
  for (const edge of mod.reExports) {
    if (seen.has(edge.toFile)) continue;
    seen.add(edge.toFile);
    edges.push({ toFile: edge.toFile, line: 1, col: 0 });
  }
  for (const ref of mod.references) {
    if (seen.has(ref.fromFile)) continue;
    seen.add(ref.fromFile);
    edges.push({ toFile: ref.fromFile, line: ref.line ?? 1, col: 0 });
  }
  return edges;
}

export function findBoundaryViolations(
  modules: ModuleNode[],
  config: ResolvedBoundaryConfig,
): FallowBoundaryViolation[] {
  return analyzeBoundaries(modules, config).violations;
}

export function analyzeBoundaries(
  modules: ModuleNode[],
  config: ResolvedBoundaryConfig,
): BoundaryAnalysisResult {
  if (config.zones.length === 0) {
    return { violations: [], checkedEdges: 0, uncheckedFiles: 0 };
  }

  const zoneCache = new Map<string, string | undefined>();

  const classify = (filePath: string): string | undefined => {
    if (zoneCache.has(filePath)) return zoneCache.get(filePath);
    const zone = classifyZone(config, filePath);
    zoneCache.set(filePath, zone);
    return zone;
  };

  const violations: FallowBoundaryViolation[] = [];
  let checkedEdges = 0;
  let uncheckedFiles = 0;

  for (const mod of modules) {
    if (!isReachableOrEntry(mod)) continue;

    const fromZone = classify(mod.filePath);
    if (!fromZone) {
      uncheckedFiles++;
      continue;
    }

    if (!hasRules(config, fromZone)) continue;

    for (const edge of edgesForModule(mod)) {
      const toPath = edge.toFile;
      checkedEdges++;

      const toZone = classify(toPath);
      if (!toZone) continue;
      if (fromZone === toZone) continue;

      if (!isImportAllowed(config, mod.filePath, toPath)) {
        violations.push({
          fromPath: mod.filePath,
          toPath,
          fromZone,
          toZone,
          importSpecifier: toPath,
          line: edge.line,
          col: edge.col,
        });
      }
    }
  }

  return { violations, checkedEdges, uncheckedFiles };
}

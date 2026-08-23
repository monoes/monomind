// Regression coverage for #118: the boundary checker only looped over
// `mod.reExports` (barrel `export ... from` edges); this adds a second pass
// over `mod.references` so an edge that reaches this function's input DOES
// get checked either way. This file had zero tests before this fix
// (findBoundaryViolations and analyzeBoundaries were dead code with zero
// callers and zero coverage — still true; see boundary-analysis.ts's own
// module comment).
//
// IMPORTANT CAVEAT (found in a later review pass, kept here rather than
// silently reverted): these fixtures hand-construct `references` directly,
// which is NOT representative of a real parsed codebase — the only writer
// of `ModuleNode.references` anywhere in this package is
// graph/re-exports/propagate.ts's barrel-re-export propagation. A genuine
// plain `import { x } from '...'` with no barrel/re-export in the chain
// never populates `references` in the real graph, so this fix does NOT
// actually close the "plain import invisible to the checker" gap in
// production — it closes it only for the (currently synthetic) case where
// `references` happens to be populated. See boundary-analysis.ts's
// edgesForModule() comment for the pointer to the checker that DOES work
// today (pipeline/phases/boundary.ts's detectBoundaryViolations).
import { describe, expect, it } from 'vitest';
import { analyzeBoundaries, findBoundaryViolations } from '../../analyze/boundary-analysis.js';
import { resolveBoundaryConfig } from '../../config/boundary-config.js';
import type { ModuleNode } from '../../graph/node-types.js';
import { ModuleNodeFlags } from '../../graph/node-types.js';

const SOURCE_ROOT = 'src';

function mod(filePath: string, overrides: Partial<ModuleNode> = {}): ModuleNode {
  return {
    fileId: 0,
    filePath,
    flags: ModuleNodeFlags.REACHABLE,
    exports: [],
    reExports: [],
    references: [],
    ...overrides,
  };
}

// layered preset: presentation -> application -> domain; domain allows nothing.
const config = resolveBoundaryConfig({ preset: 'layered' }, SOURCE_ROOT);

describe('#118: boundary checker catches ordinary imports, not just re-exports', () => {
  it('flags a plain `import` that crosses a disallowed zone boundary (the case that used to pass silently)', () => {
    const presentationFile = mod('src/components/widget.ts', {
      references: [
        { name: 'Repo', kind: 'Value', fromFile: 'src/infrastructure/repo.ts', line: 7 },
      ],
    });
    const infraFile = mod('src/infrastructure/repo.ts');

    const violations = findBoundaryViolations([presentationFile, infraFile], config);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      fromPath: 'src/components/widget.ts',
      toPath: 'src/infrastructure/repo.ts',
      fromZone: 'presentation',
      toZone: 'infrastructure',
      line: 7,
    });
  });

  it('does not flag a same-zone import', () => {
    const a = mod('src/domain/entity-a.ts', {
      references: [{ name: 'B', kind: 'Value', fromFile: 'src/domain/entity-b.ts', line: 3 }],
    });
    const b = mod('src/domain/entity-b.ts');

    expect(findBoundaryViolations([a, b], config)).toHaveLength(0);
  });

  it('does not flag an import into an explicitly allowed zone', () => {
    const app = mod('src/application/use-case.ts', {
      references: [{ name: 'Entity', kind: 'Value', fromFile: 'src/domain/entity.ts', line: 2 }],
    });
    const domain = mod('src/domain/entity.ts');

    // layered rule: application -> allow [domain]
    expect(findBoundaryViolations([app, domain], config)).toHaveLength(0);
  });

  it('still flags a re-export edge (pre-existing behavior)', () => {
    const presentationFile = mod('src/components/index.ts', {
      reExports: [
        {
          fromFile: 'src/components/index.ts',
          toFile: 'src/infrastructure/db.ts',
          isNamespace: false,
        },
      ],
    });
    const infraFile = mod('src/infrastructure/db.ts');

    const violations = findBoundaryViolations([presentationFile, infraFile], config);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      fromPath: 'src/components/index.ts',
      toPath: 'src/infrastructure/db.ts',
    });
  });

  it('does not double-count an edge that is both re-exported AND referenced', () => {
    const presentationFile = mod('src/components/index.ts', {
      reExports: [
        {
          fromFile: 'src/components/index.ts',
          toFile: 'src/infrastructure/db.ts',
          isNamespace: false,
        },
      ],
      references: [{ name: 'db', kind: 'Value', fromFile: 'src/infrastructure/db.ts', line: 4 }],
    });
    const infraFile = mod('src/infrastructure/db.ts');

    const violations = findBoundaryViolations([presentationFile, infraFile], config);
    expect(violations).toHaveLength(1);
  });

  it('analyzeBoundaries counts checked edges from references, and unchecked files for unclassified paths', () => {
    const presentationFile = mod('src/components/widget.ts', {
      references: [
        { name: 'Repo', kind: 'Value', fromFile: 'src/infrastructure/repo.ts', line: 7 },
      ],
    });
    const infraFile = mod('src/infrastructure/repo.ts');
    const outsideFile = mod('README.md'); // matches no zone pattern

    const result = analyzeBoundaries([presentationFile, infraFile, outsideFile], config);
    expect(result.violations).toHaveLength(1);
    expect(result.checkedEdges).toBeGreaterThanOrEqual(1);
    expect(result.uncheckedFiles).toBe(1);
  });

  it('findBoundaryViolations and analyzeBoundaries agree on violations for the same input', () => {
    const presentationFile = mod('src/components/widget.ts', {
      references: [
        { name: 'Repo', kind: 'Value', fromFile: 'src/infrastructure/repo.ts', line: 7 },
      ],
    });
    const infraFile = mod('src/infrastructure/repo.ts');

    const a = findBoundaryViolations([presentationFile, infraFile], config);
    const b = analyzeBoundaries([presentationFile, infraFile], config).violations;
    expect(a).toEqual(b);
  });

  it('ignores a module that is neither reachable nor an entry point', () => {
    const presentationFile = mod('src/components/widget.ts', {
      flags: 0, // not REACHABLE, not ENTRY_POINT
      references: [
        { name: 'Repo', kind: 'Value', fromFile: 'src/infrastructure/repo.ts', line: 7 },
      ],
    });
    const infraFile = mod('src/infrastructure/repo.ts');

    expect(findBoundaryViolations([presentationFile, infraFile], config)).toHaveLength(0);
  });

  it('returns no violations when no zones are configured', () => {
    const empty = resolveBoundaryConfig({}, SOURCE_ROOT);
    const presentationFile = mod('src/components/widget.ts', {
      references: [
        { name: 'Repo', kind: 'Value', fromFile: 'src/infrastructure/repo.ts', line: 7 },
      ],
    });
    expect(findBoundaryViolations([presentationFile], empty)).toHaveLength(0);
    expect(analyzeBoundaries([presentationFile], empty)).toEqual({
      violations: [],
      checkedEdges: 0,
      uncheckedFiles: 0,
    });
  });
});

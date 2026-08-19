/**
 * #124: four pricing tables (model-pricing.ts, ui/collector.mjs,
 * ui/server.mjs, .claude/helpers/token-tracker.cjs) previously hand-copied
 * the same model->price data and had already diverged on model coverage.
 * They can't literally share one JS module (plain .mjs/.cjs consumers can't
 * import a .ts source without a build step), so this test is the drift
 * guard: it extracts each table's model *key set* straight from source text
 * and asserts they all agree, the same way tests/repo/claude-tree-parity.test.ts
 * guards the two .claude trees.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_PRICING } from '../pricing/model-pricing.js';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

/** Pull `'model-key': { ... }` object-literal keys out of a JS/TS pricing table's source text. */
function extractModelKeys(source: string, tableStartMarker: RegExp): Set<string> {
  const startIdx = source.search(tableStartMarker);
  if (startIdx === -1) throw new Error(`table start marker not found: ${tableStartMarker}`);
  const closeIdx = source.indexOf('\n};', startIdx);
  const body = source.slice(startIdx, closeIdx === -1 ? undefined : closeIdx);
  const keys = new Set<string>();
  for (const m of body.matchAll(/^\s*'([a-zA-Z0-9.-]+)':\s*\{/gm)) keys.add(m[1]);
  return keys;
}

describe('#124: pricing table parity across the 4 duplicated sources', () => {
  const canonicalKeys = new Set(Object.keys(MODEL_PRICING));

  it('sanity: the canonical table itself is non-trivial', () => {
    expect(canonicalKeys.size).toBeGreaterThan(10);
  });

  it('ui/collector.mjs covers the same model set as model-pricing.ts', () => {
    const source = readFileSync(join(REPO_ROOT, 'packages/@monomind/cli/src/ui/collector.mjs'), 'utf-8');
    const keys = extractModelKeys(source, /const _TOK_PRICES = \{/);
    expect([...keys].sort()).toEqual([...canonicalKeys].sort());
  });

  it('ui/server.mjs covers the same model set as model-pricing.ts', () => {
    const source = readFileSync(join(REPO_ROOT, 'packages/@monomind/cli/src/ui/server.mjs'), 'utf-8');
    const keys = extractModelKeys(source, /const _SJ_PRICING = \{/);
    expect([...keys].sort()).toEqual([...canonicalKeys].sort());
  });

  it('.claude/helpers/token-tracker.cjs covers the same model set as model-pricing.ts', () => {
    const source = readFileSync(join(REPO_ROOT, '.claude/helpers/token-tracker.cjs'), 'utf-8');
    const keys = extractModelKeys(source, /const FALLBACK_PRICING = \{/);
    expect([...keys].sort()).toEqual([...canonicalKeys].sort());
  });

  it("org.ts's cost-estimate rate table derives from model-pricing.ts (ORG-14)", () => {
    // org.ts no longer hand-copies a rate table — it imports MODEL_PRICING and
    // derives a per-1M blended rate from each model's output price. This test
    // guards against a future regression back to a hardcoded literal copy.
    const source = readFileSync(join(REPO_ROOT, 'packages/@monomind/cli/src/commands/org.ts'), 'utf-8');
    expect(source).toMatch(/import\s*\{\s*MODEL_PRICING\s*\}\s*from\s*'\.\.\/pricing\/model-pricing\.js'/);
    expect(source).toMatch(/DERIVED_RATE_PER_1M[\s\S]{0,200}Object\.entries\(MODEL_PRICING\)/);
  });

  it('the packaged and .gemini copies of token-tracker.cjs are byte-identical to the root copy', () => {
    const root = readFileSync(join(REPO_ROOT, '.claude/helpers/token-tracker.cjs'), 'utf-8');
    const pkg = readFileSync(join(REPO_ROOT, 'packages/@monomind/cli/.claude/helpers/token-tracker.cjs'), 'utf-8');
    const gemini = readFileSync(join(REPO_ROOT, '.gemini/helpers/token-tracker.cjs'), 'utf-8');
    expect(pkg).toBe(root);
    expect(gemini).toBe(root);
  });
});

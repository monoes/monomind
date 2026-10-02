// Every committed scenario manifest is complete (spec section 10) and none is a draft.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../lib/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenarios = [
  'dev-feature-qa',
  'deliberative-design',
  'growth-like',
  'research-report',
  'sparse-dispatch',
];

describe('committed scenario manifests', () => {
  it('are exactly the five scenarios', () => {
    expect(
      readdirSync(here)
        .filter((f) => f.endsWith('.json'))
        .sort(),
    ).toEqual(scenarios.map((s) => `${s}.json`).sort());
  });
  it.each(scenarios)('%s validates and carries no draft marker', (id) => {
    const m = JSON.parse(readFileSync(join(here, `${id}.json`), 'utf8'));
    expect(validateManifest(m)).toEqual({ ok: true, problems: [] });
    expect(m.status).toBeUndefined();
    expect(m.id).toBe(id);
  });
});

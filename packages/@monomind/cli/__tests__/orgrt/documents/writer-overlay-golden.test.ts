// packages/@monomind/cli/__tests__/orgrt/documents/writer-overlay-golden.test.ts
// P4.2: the overlay golden. A small sections definition with one writer, a read-only lead with write grants it
// must lose, and a role that already denies the workspace, in two workspace settings. The expected overlay
// of every role and the preflight findings are in fixtures/writer/overlay-golden.json (reviewable as a diff).
// A change here is a change of what P4.4 will enforce: it needs a reason in the commit, not a re-record.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenDef, snapshot } from '../support/writer-defs.js';

const GOLDEN = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'writer', 'overlay-golden.json'),
    'utf8',
  ),
);

describe('overlay golden', () => {
  it('repo workspace', () => {
    expect(JSON.parse(JSON.stringify(snapshot(goldenDef('repo'), {})))).toEqual(GOLDEN.repo);
  });

  it('an absolute workspace with a known org root', () => {
    const snap = snapshot(goldenDef('/work/ws'), { orgRoot: '/work' });
    expect(JSON.parse(JSON.stringify(snap))).toEqual(GOLDEN.absolute);
  });
});

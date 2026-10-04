// packages/@monomind/cli/__tests__/orgrt/support/golden-capture.ts
//
// Org sections P3.0: the capture helper behind sections-off-golden.test.ts.
// `expectGolden(name, actual)` compares `actual` with the committed fixture
// `fixtures/sections-off/<name>.json` and never writes one on its own: a
// missing or different fixture is a failure. Re-capturing is a deliberate act
// (see the README block at the top of sections-off-golden.test.ts) and needs
// SECTIONS_OFF_GOLDEN_RECAPTURE set to a piece id that may do it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'sections-off',
);

/** The pieces allowed to re-capture: the initial capture, and the one piece
 *  that intentionally changes prompts. Any other value is refused. */
export const RECAPTURE_PIECES = ['P3.0', 'P3.12'];

export function recapturePiece(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env.SECTIONS_OFF_GOLDEN_RECAPTURE;
  if (v === undefined || v === '') return undefined;
  if (!RECAPTURE_PIECES.includes(v))
    throw new Error(
      `SECTIONS_OFF_GOLDEN_RECAPTURE=${v} is refused: only ${RECAPTURE_PIECES.join(' and ')} may re-capture the sections-off goldens`,
    );
  return v;
}

const pretty = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

/** `hostNeutral` is applied to both sides before comparing (never when recapturing): it drops what a host
 *  without bubblewrap does not create, so the golden reads the same with and without it. */
export function expectGolden(
  name: string,
  actual: unknown,
  hostNeutral: (v: any) => unknown = (v) => v,
): void {
  const file = join(GOLDEN_DIR, `${name}.json`);
  // round-trip so undefined and class instances compare as the file will
  const got = JSON.parse(JSON.stringify(actual)) as unknown;
  if (recapturePiece()) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, pretty(got));
    return;
  }
  if (!existsSync(file))
    throw new Error(`sections-off golden "${name}" is missing; fixtures are committed, never created by a test run`);
  try {
    expect(hostNeutral(got)).toEqual(hostNeutral(JSON.parse(readFileSync(file, 'utf8'))));
  } catch (err) {
    // the actual value, for diffing against the fixture
    const dir = join(process.env.TMPDIR ?? '/var/tmp', 'sections-off-golden-actual');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${name}.json`), pretty(got));
    } catch {
      /* best effort */
    }
    throw err;
  }
}

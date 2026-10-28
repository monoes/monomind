/**
 * Rug-pull detection for the copies of approved catalog skills that other
 * tools load. The package store is content-addressed and re-verified on every
 * read (digest.ts), but `catalog project` copies the files into
 * `.claude/skills` and `.agents/skills`, and Claude Code, Codex, Gemini and
 * the rest load THOSE. A copy edited after approval (by a prompt-injected
 * agent turn, a sync tool, a hand edit) is no longer what was approved.
 *
 * At projection time the sha256 of every projected file as it stands on disk
 * is recorded in `.monomind/catalog/projection-pins.json` (inside the
 * operator-protected catalog dir: roles cannot rewrite it). `verifyPins`
 * re-hashes and names each file that changed or disappeared.
 *
 * Limit: the pin file lives beside the state it protects and has no
 * signature. It catches an edited skill copy; someone who can write both the
 * copy and `.monomind/catalog/` is stopped by the write-deny, not by this.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../platform-adapters/mutation.js';
import { catalogDir } from './digest.js';

const pinFile = (root: string): string => join(catalogDir(root), 'projection-pins.json');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

type Pins = Record<string, string>;

function readPins(root: string): Pins {
  try {
    const raw = JSON.parse(readFileSync(pinFile(root), 'utf8')) as { pins?: Pins };
    return raw.pins && typeof raw.pins === 'object' ? raw.pins : {};
  } catch {
    return {};
  }
}

function writePins(root: string, pins: Pins): void {
  atomicWrite(
    pinFile(root),
    `${JSON.stringify({ version: 1, pins: Object.fromEntries(Object.entries(pins).sort()) }, null, 2)}\n`,
  );
}

/**
 * Pin the files a projection just wrote (`written`, project-relative) and
 * drop pins under `removedDirs`. A file the projection left alone (`present`)
 * is pinned only when it has no pin yet: re-pinning it would bless a copy
 * that was edited after approval.
 */
export function recordPins(
  root: string,
  written: string[],
  present: string[] = [],
  removedDirs: string[] = [],
): void {
  if (!existsSync(catalogDir(root))) return;
  const pins = readPins(root);
  const before = JSON.stringify(pins);
  for (const dir of removedDirs)
    for (const k of Object.keys(pins)) if (k.startsWith(`${dir}/`)) delete pins[k];
  const pin = (rel: string): void => {
    try {
      pins[rel] = sha256(readFileSync(join(root, rel)));
    } catch {
      delete pins[rel];
    }
  };
  for (const rel of present) if (!(rel in pins)) pin(rel);
  for (const rel of written) pin(rel);
  // Nothing pinned or changed: write nothing (an empty apply creates no files).
  if (JSON.stringify(pins) !== before) writePins(root, pins);
}

export interface PinProblem {
  path: string;
  problem: 'changed' | 'missing';
  message: string;
}

/** Projected files that no longer match what was approved and projected. */
export function verifyPins(root: string): PinProblem[] {
  const out: PinProblem[] = [];
  for (const [rel, want] of Object.entries(readPins(root))) {
    let got: string | undefined;
    try {
      got = sha256(readFileSync(join(root, rel)));
    } catch {
      /* gone */
    }
    if (got === want) continue;
    out.push(
      got === undefined
        ? {
            path: rel,
            problem: 'missing',
            message: `${rel} was projected from an approved catalog skill but is gone`,
          }
        : {
            path: rel,
            problem: 'changed',
            message: `${rel} changed after approval (projected sha256 ${want.slice(0, 12)}, now ${got.slice(0, 12)}): not the content that was approved`,
          },
    );
  }
  return out;
}

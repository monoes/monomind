/**
 * Assembles the run-to-run diff (RIG-10) from what the previous run left in
 * the history directory: its structural signature (in the JSON record) and
 * its screenshot (the sibling PNG).
 *
 * Every missing piece degrades into a note rather than an absent section, so
 * a reader can tell "nothing changed" apart from "we could not check".
 */

import { type HistoryRun, loadRunScreenshot } from './history.js';
import { type PixelDiffOptions, pixelDiff } from './pixel-diff.js';
import { pngFromDataUrl } from './png.js';
import { diffStructure } from './structure.js';
import type { Report, RunDiff } from './types.js';

export interface BuildRunDiffOptions {
  pixels?: PixelDiffOptions;
  /** Set false to skip the pixel half entirely. */
  comparePixels?: boolean;
}

export async function buildRunDiff(
  dir: string,
  previous: HistoryRun | undefined,
  current: Report,
  options: BuildRunDiffOptions = {},
): Promise<RunDiff | undefined> {
  if (!previous) return undefined;

  const notes: string[] = [];
  const diff: RunDiff = {
    previousRunId: previous.id,
    previousCapturedAt: previous.capturedAt,
    notes,
  };

  if (previous.structure?.length && current.structure?.length) {
    diff.structure = diffStructure(previous.structure, current.structure);
  } else if (!current.structure?.length) {
    notes.push('No accessibility tree this run — structural diff skipped.');
  } else {
    notes.push('The previous run stored no structural signature — nothing to diff against.');
  }

  if (options.comparePixels !== false) {
    const currentShot =
      current.screenshots.find((s) => s.label === 'page') ?? current.screenshots[0];
    const previousPng = await loadRunScreenshot(dir, previous);
    if (!previousPng) {
      notes.push('The previous run archived no screenshot — pixel diff skipped.');
    } else if (!currentShot?.dataUrl) {
      notes.push('No screenshot this run — pixel diff skipped.');
    } else {
      try {
        diff.pixels = pixelDiff(previousPng, pngFromDataUrl(currentShot.dataUrl), options.pixels);
      } catch (err) {
        notes.push(`Pixel diff failed: ${(err as Error).message}`);
      }
    }
  }

  return diff;
}

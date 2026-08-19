/**
 * Regression test for CMD-10: `performance bottleneck` used to recommend
 * `monomind performance optimize` and `monomind memory compact` — neither
 * subcommand exists, so following the advice failed. This asserts every
 * `solution:` string emitted by the bottleneck analyzer that names a
 * `monomind <...>` command points at a subcommand that is actually
 * registered in the CLI's command tree, so this cannot silently rot again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getCommandAsync } from '../commands/index.js';
import type { Command } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Extract every single-quoted `solution: '...'` literal from performance.ts. */
function extractSolutionStrings(): string[] {
  const src = readFileSync(join(__dirname, '..', 'commands', 'performance.ts'), 'utf8');
  const matches = [...src.matchAll(/solution:\s*'((?:[^'\\]|\\.)*)'/g)];
  return matches.map(m => m[1]);
}

/** Resolve a dotted `monomind foo bar baz` path against the real command tree. */
async function resolveCommandPath(words: string[]): Promise<boolean> {
  if (words.length === 0) return false;
  const root = await getCommandAsync(words[0]);
  if (!root) return false;
  let current: Command = root;
  for (const word of words.slice(1)) {
    const next: Command | undefined = current.subcommands?.find(
      (c) => c.name === word || c.aliases?.includes(word),
    );
    if (!next) return false;
    current = next;
  }
  return true;
}

describe('performance bottleneck recommendation strings', () => {
  it('never references the removed fake commands again', () => {
    const solutions = extractSolutionStrings();
    for (const s of solutions) {
      expect(s).not.toContain('performance optimize');
      expect(s).not.toContain('memory compact');
    }
  });

  it('every "Run: monomind <...>" recommendation points at a real, registered subcommand', async () => {
    const solutions = extractSolutionStrings();
    const runRecommendations = solutions.filter(s => s.startsWith('Run: monomind '));

    // Guard against the extractor itself silently finding nothing (e.g. if the
    // solution strings get reworded to template literals) — that would make
    // this test vacuously pass.
    expect(runRecommendations.length).toBeGreaterThan(0);

    for (const rec of runRecommendations) {
      const withoutPrefix = rec.slice('Run: monomind '.length);
      // Keep only the leading run of bare words — stop at the first flag
      // (anything starting with `-`), since flag values that follow (e.g.
      // `--method quantize`) are not command-path segments.
      const allWords = withoutPrefix.split(/\s+/);
      const flagIndex = allWords.findIndex(w => w.startsWith('-'));
      const words = flagIndex === -1 ? allWords : allWords.slice(0, flagIndex);
      const exists = await resolveCommandPath(words);
      expect(exists, `"monomind ${words.join(' ')}" (from "${rec}") is not a registered command`).toBe(true);
    }
  });
});

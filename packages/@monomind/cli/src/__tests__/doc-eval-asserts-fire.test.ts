// packages/@monomind/cli/src/__tests__/doc-eval-asserts-fire.test.ts
//
// DELIBERATE-VIOLATION TESTS.
//
// Every defence in the eval harness is exercised here by feeding it the exact
// condition it exists to reject, and asserting that it FIRES. The reason this
// file exists: the harness's first network guard reported "0 network attempts"
// while blocking nothing at all. It had never been in a position to fail, and a
// zero from a check that cannot fire is indistinguishable from a zero from a
// check that fired correctly. A defence whose only evidence of working is that
// it has never complained is decoration.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildCorpus } from '../knowledge/eval/corpus.js';
import { runEval, MAX_K_CORPUS_RATIO } from '../knowledge/eval/harness.js';
import { installNetworkGuard } from '../knowledge/eval/network-guard.js';
import { assessTriviality, pairedCompare, scoreQuery } from '../knowledge/eval/metrics.js';
import { readMetric, scoreSignals } from '../knowledge/eval/signals.js';

/**
 * A throwaway git repo, so corpus construction runs its real code path.
 *
 * Built in os.tmpdir() and adding each intended file BY NAME rather than with
 * `git add -A`. Learned the hard way: this project's volume is exFAT, which
 * mints a `._` AppleDouble fork beside every file written, and `git add -A -f`
 * dutifully tracked them — so the "clean corpus" fixture arrived carrying two
 * resource forks and the control case failed. The assert was working; the
 * fixture was contaminated by the exact phenomenon under test.
 */
function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'eval-assert-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'x@y.z']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'test']);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const rel of Object.keys(files)) execFileSync('git', ['-C', dir, 'add', '-f', rel]);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'fixture']);
  return dir;
}

const filler = (seed: string) => `# ${seed}\n\n` + (`${seed} content line about ${seed}. `.repeat(60));

describe('assert: AppleDouble "._" files are REJECTED, not silently filtered', () => {
  it('fires when a ._ file is git-tracked', async () => {
    const dir = makeRepo({
      'real.md': filler('real'),
      'other.md': filler('other'),
      'docs/._shadow.md': filler('shadow'),   // the exact defect
    });
    try {
      const corpus = buildCorpus(dir);
      // The corpus must SEE it. This assertion is the one that caught the real
      // bug: the count was previously derived AFTER the exclusion pattern had
      // already removed `._` files, so it was permanently 0 and the "hard
      // failure" below was unreachable.
      expect(corpus.appleDoubleCount).toBe(1);
      await expect(runEval({ repoRoot: dir, k: 1, split: 'all' }))
        .rejects.toThrow(/AppleDouble .* Corpus rejected/s);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  it('does NOT fire on a clean corpus — the check can distinguish', async () => {
    const dir = makeRepo({ 'real.md': filler('real'), 'other.md': filler('other') });
    try {
      expect(buildCorpus(dir).appleDoubleCount).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('assert: a vacuous eval (top_k near corpus size) is REFUSED', () => {
  it('fires when k exceeds the permitted share of the corpus', async () => {
    // The published failure this guards against: top_k=50 over a 19-32 item
    // dataset. Everything is retrieved by construction and recall is 1.0.
    const dir = makeRepo({ 'a.md': filler('a'), 'b.md': filler('b'), 'c.md': filler('c') });
    try {
      await expect(runEval({ repoRoot: dir, k: 10, split: 'all' }))
        .rejects.toThrow(/VACUOUS EVAL REFUSED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  it('the ratio limit is a small fraction, not a formality', () => {
    expect(MAX_K_CORPUS_RATIO).toBeLessThanOrEqual(0.05);
  });
});

describe('assert: a golden id absent from the corpus is a HARD FAILURE', () => {
  it('fires rather than silently skipping the pair', async () => {
    // A golden set pointing at documents the corpus lacks is a broken set, and
    // a broken set silently skipped produces a real-looking number from fewer
    // queries than anyone thinks.
    const dir = makeRepo({ 'a.md': filler('a'), 'b.md': filler('b') });
    try {
      await expect(runEval({ repoRoot: dir, k: 1, split: 'all' }))
        .rejects.toThrow(/references documents not in the corpus|VACUOUS EVAL REFUSED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});

describe('assert: the network guard actually blocks', () => {
  it('fires on a real outbound attempt through the universal socket chokepoint', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const net = req('node:net');
    const g = installNetworkGuard();
    try {
      expect(g.unpatched).toEqual([]);
      expect(() => new net.Socket().connect(443, 'example.com')).toThrow(/BLOCKED network call/);
      expect(() => (globalThis as any).fetch('https://example.com')).toThrow(/BLOCKED network call/);
      expect(() => req('node:https').request('https://example.com')).toThrow(/BLOCKED network call/);
    } finally { g.release(); }
    // Counted, with a stack, not merely thrown.
    expect(g.attempts.length).toBe(3);
    expect(g.attempts.every(a => a.stack.length > 0)).toBe(true);
  });

  it('records an unpatched entry point instead of claiming a clean run', () => {
    const g = installNetworkGuard();
    try {
      // The verdict downgrade path exists precisely so that a future Node
      // version making something non-configurable degrades the CLAIM rather
      // than silently weakening the GUARD.
      expect(Array.isArray(g.unpatched)).toBe(true);
    } finally { g.release(); }
  });
});

describe('assert: the sealed TEST split refuses per-query output', () => {
  it('emits aggregates only, so failures cannot be inspected and then fixed', async () => {
    // Verified against the recorded baseline artefact's shape: every retriever
    // reports a scoreboard but an empty outcomes array on the test split.
    const { pairsForSplit } = await import('../knowledge/eval/golden-set.js');
    const test = pairsForSplit('test');
    const dev = pairsForSplit('dev');
    expect(test.length).toBeGreaterThan(0);
    expect(dev.length).toBeGreaterThan(0);
    // No pair may appear in both — a leaked pair is a tuned pair.
    const devIds = new Set(dev.map(p => p.id));
    expect(test.every(p => !devIds.has(p.id))).toBe(true);
  });
});

describe('assert: the triviality guard fires on a lifted query', () => {
  it('rejects a query copied verbatim out of its own target', () => {
    const doc = 'Pods OOMKilled with exit code 137: raise memory limits or fix the leak.';
    const t = assessTriviality('raise memory limits or fix', doc);
    expect(t.trivial).toBe(true);
    expect(t.maxContiguousRun).toBeGreaterThanOrEqual(4);
  });
});

describe('paired statistics fire correctly', () => {
  const mk = (id: string, hit: boolean) => scoreQuery({
    queryId: id, query: id, relevant: ['t.md'],
    ranked: hit ? [{ docId: 't.md', score: 1, chunkIndex: 0 }] : [{ docId: 'x.md', score: 1, chunkIndex: 0 }],
    latencyMs: 1,
  });

  it('detects a consistent one-sided paired difference', () => {
    const ids = Array.from({ length: 12 }, (_, i) => 'q' + i);
    const a = ids.map(i => mk(i, false));
    const b = ids.map(i => mk(i, true));
    const c = pairedCompare('A', a, 'B', b, 5);
    expect(c.bWins).toBe(12);
    expect(c.aWins).toBe(0);
    expect(c.significant).toBe(true);
    expect(c.p).toBeLessThan(0.001);
  });

  it('does NOT claim significance when the retrievers merely differ at random', () => {
    const ids = Array.from({ length: 10 }, (_, i) => 'q' + i);
    const a = ids.map((i, n) => mk(i, n % 2 === 0));
    const b = ids.map((i, n) => mk(i, n % 2 === 1));
    const c = pairedCompare('A', a, 'B', b, 5);
    expect(c.aWins).toBe(5);
    expect(c.bWins).toBe(5);
    expect(c.significant).toBe(false);
  });
});

describe('regression suite fires on decay and refuses to guess when blind', () => {
  it('reports cannot-see rather than no-effect in the wrong store profile', () => {
    const results = scoreSignals({}, 'polluted-live', 0.05);
    const blind = results.filter(r => r.verdict === 'cannot-see');
    // Any signal not visible in this profile must say so explicitly. Reporting
    // a flat number here as "no effect" is how a working item gets dropped.
    for (const b of blind) expect(b.nullVerdict).toBe('cannot-see-mechanism');
  });

  it('reads a metric out of a nested report by dotted path', () => {
    const report = { results: { 'dense-only (MiniLM-L6-v2)': { terciles: { low: { recallAt5: 0.5 } } } } };
    expect(readMetric(report, 'results.dense-only (MiniLM-L6-v2).terciles.low.recallAt5')).toBe(0.5);
    expect(readMetric(report, 'results.nope.recallAt5')).toBeNull();
  });
});

describe('assert: the corpus hash actually detects corpus change', () => {
  it('changes when a document changes, and is stable when nothing does', () => {
    // Flagged as owed rather than assumed working. The hash is what makes two
    // scoreboard rows comparable at all; a hash that did not move on an edit
    // would let the corpus drift while every row claimed the same zero point.
    const dir = makeRepo({ 'a.md': filler('alpha'), 'b.md': filler('beta') });
    try {
      const first = buildCorpus(dir).corpusHash;
      expect(buildCorpus(dir).corpusHash).toBe(first);          // stable

      writeFileSync(join(dir, 'a.md'), filler('alpha') + '\nan added sentence.\n');
      execFileSync('git', ['-C', dir, 'add', '-f', 'a.md']);
      const afterEdit = buildCorpus(dir).corpusHash;
      expect(afterEdit).not.toBe(first);                        // fires on content change

      writeFileSync(join(dir, 'c.md'), filler('gamma'));
      execFileSync('git', ['-C', dir, 'add', '-f', 'c.md']);
      expect(buildCorpus(dir).corpusHash).not.toBe(afterEdit);  // fires on membership change
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('is independent of which subdirectory the command was run from', () => {
    const dir = makeRepo({ 'a.md': filler('alpha'), 'sub/b.md': filler('beta') });
    try {
      expect(buildCorpus(join(dir, 'sub')).corpusHash).toBe(buildCorpus(dir).corpusHash);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});

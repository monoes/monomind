# Follow-up fixes: FTS5 sync/scoring, monoKey NUL byte, issues #223/#224

Date: 7 September 2026. Fixes four items raised after the memory-KG next-steps handoff's four stages ([1](memory-kg-stage1-scope-reconciliation-2026-09-07.md), [2](../../packages/@monomind/cli/src/memory/memory-kg.ts#L2132), [3/K7](memory-kg-stage3-indexed-lookup-2026-09-07.md), [4/K9](memory-kg-stage4-retrieval-eval-baseline-2026-09-07.md)) landed: the two items flagged at the end of that work, plus GitHub issues [#223](https://github.com/monoes/monomind/issues/223) and [#224](https://github.com/monoes/monomind/issues/224). Reviewed/built revision: `3140df0a3` plus this change.

## 1. FTS5 index desync on upsert (the K9 `u1b` anomaly)

**Root cause, confirmed by direct inspection of the raw SQLite tables** (`memory_entries` and `memory_entries_fts`), not left as a guess: `SqlBackend.store()`'s plain unconditional upsert writes via `INSERT OR REPLACE`. Its internal conflict-resolution delete does **not** reliably fire the `memory_entries_fts_ad` (`AFTER DELETE`) trigger — verified this is not fixed by `PRAGMA recursive_triggers = ON` either, which is the documented lever for exactly this SQLite behavior in general but empirically made no difference for this specific conflict-resolution delete. The result: updating an entry via the plain upsert path left its OLD fts row behind, and the new content got a SECOND fts row for the same `entry_id` — a search then returned the same entry twice, once scored against stale content and once against current.

**Fix** (`packages/@monomind/memory/src/sql-schema.ts`): rather than trying to make the unreliable `AFTER DELETE` path work, made the trigger that DOES fire reliably through `INSERT OR REPLACE` (`memory_entries_fts_ai`, `AFTER INSERT` — confirmed empirically: the new-content row was always correctly added) self-healing: it now deletes any existing fts row for `NEW.id` before inserting. `memory_entries_fts_ad`/`_au` are left as they were (still correct for genuine `DELETE`/`UPDATE` statements, e.g. `storeIfVersion`'s CAS path).

This alone only stops NEW duplicates. Two more pieces close the gap for existing installations:

- `ensureFTS5Triggers()` now runs on **every** `initializeSchema()` call, not only when the FTS5 table is first created — `CREATE TRIGGER IF NOT EXISTS` meant a trigger-definition fix would otherwise never reach a database whose FTS5 table already existed (`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` is cheap and idempotent; triggers hold no data).
- `dedupeFTS5Rows()` runs once whenever the FTS5 table already existed at init: `DELETE FROM memory_entries_fts WHERE rowid NOT IN (SELECT MAX(rowid) FROM memory_entries_fts GROUP BY entry_id)` — keeps the most-recently-written row per entry (FTS5 rowids are monotonically increasing on insert), removing any duplicate left by the pre-fix trigger. A no-op once a store is clean, so it costs nothing on every subsequent init.

**Tests:** `packages/@monomind/cli/src/__tests__/memory-bridge-fts-sync.test.ts`, against a real backend (temp SQLite store, not mocked — this is backend/trigger behavior a mock cannot reproduce). Covers: an upsert leaves exactly one search hit with current content; a database with a pre-existing stale duplicate (hand-injected via a second raw connection, simulating what the old trigger left behind) is repaired the next time it's opened.

## 2. GitHub issue #224 — keyword-fallback scores the correct (sole) hit as 0.00

**Root cause:** `bridgeSearchEntries`' FTS5-path normalisation (`memory-bridge.ts`) floored the divisor unconditionally: `Math.max(...fts5Results.map(r => Math.abs(r.rank)), 1)`. BM25's IDF term goes to zero or negative when a query term appears in most or all of the matched rows — a small or lexically-homogeneous result set (finding 1 above, before it was fixed, was exactly this: a duplicated FTS row where a query term necessarily matched "all" rows). A genuinely-best, or sole, match can legitimately carry `|rank| < 1`; the hard floor then divided that down toward 0, displaying the correct top result at a misleading ~0.00 instead of its best-available 1.0.

This is the **identical bug class** already found and fixed once in this same function, a few lines below, for the JS BM25 fallback path (`#126-review`'s comment: "Only fall back to 1 when there is no positive score to divide by") — the fix here mirrors that exactly, applied to the FTS5 fast path, which had been missed.

**Fix:** compute `rawMaxRank` without a floor; only substitute `1` for the divisor (and directly assign `score = 1`) when `rawMaxRank` is genuinely `0` — i.e. nothing to normalise against, every result equally best. Otherwise normalise against the real maximum, so the actual top match reaches 1.0.

Root-cause confirmation note: my own attempts to reproduce the issue's exact repro (`memory store` then `memory search` in a fresh, single-entry store) initially returned `1.00`, not `0.00` — the bug needs a corpus where BM25's IDF genuinely degenerates (a query term appearing in most/all matched rows), which a clean single-document store doesn't trigger by itself. Finding 1's duplicate-row bug is one concrete way to reach that state (confirmed: same fixture, same score-floor code path, same displayed `0.00`); a real, populated project store with common query words shared across many entries is very plausibly another. The fix addresses the actual defective normalisation regardless of which path produced the degenerate rank.

**Tests:** `memory-bridge-fts-sync.test.ts`'s first case exercises this directly (single clean entry, expects `score > 0.9`); the second case (upsert) exercised the original `0.000001` value before the fix, now also `> 0.9`.

## 3. GitHub issue #223 — `monograph search --format json` silently ignored

**Root cause:** `searchCommand.action` in `packages/@monomind/cli/src/commands/monograph.ts` never read `ctx.flags.format` at all — it always printed the ASCII table, matching every other subcommand's `if (ctx.flags.format === 'json') { output.printJson(...); return ... }` convention (already used by `agent-lifecycle.ts`, `agent-ops.ts`, `hooks-workers.ts`, `config.ts`, and others) except this one, which had never been wired up.

**Fix:** added the same convention. When `--format json` is set: the human-oriented header (`Monograph Search — "…"`) is skipped, and once results are computed, `output.printJson({ query, mode, label, limit, count, results })` is emitted instead of the table — covering both the empty-results and populated-results cases, matching how the un-flagged path already handles both. No change to the un-flagged (table) path.

**Tests:** `packages/@monomind/cli/src/__tests__/monograph-search-format.test.ts`, built against a REAL monograph index (small real repo, indexed via the actual `monograph_build` tool — same pattern as `monograph-tools-real-index.test.ts`), not a mocked query result. Confirms `--format json` calls `output.printJson` exactly once with structured, real results and never calls `output.printTable`; confirms the un-flagged path is unchanged (table printed, JSON not called).

## 4. `memoKey`'s literal NUL byte (`memory-kg.ts`)

Pre-existing (not introduced by any of this session's other work — present before stage 1 began), harmless at runtime (the string is an in-memory `Map` key inside `kgIngest`, scoped to one call, never persisted or compared across process boundaries), but made git treat the whole file as binary past that byte offset — the same authoring mistake (writing a backslash-u-0000 escape sequence intending it as literal text, which a tool along the way decoded into an actual NUL byte) fixed once already this session in a test file.

**Fix:** replaced the NUL separator with a length-prefixed encoding — `` `${t.length}:${t}${canonicalName(name)}` `` — the same discipline `hashTuple()` (a few lines above, in the same file) already uses for the same reason: the split point stays unambiguous regardless of what characters `name` contains (it can legitimately hold spaces, unlike the src/relation/dst identifiers this session's earlier NUL-byte fix used a plain space for). No behavior change — `memoKey` was never persisted or read back.

**Tests:** no new test needed (pure internal key-encoding change); the full existing `memory-kg-*` suite (104+ tests exercising `kgIngest`'s dedup path) re-run clean after the change, confirming no behavioral regression.

## Verification

```bash
# From packages/@monomind/cli
MONOMIND_NO_LOCAL_EMBEDDINGS=1 vitest run src/__tests__/memory-bridge-fts-sync.test.ts src/__tests__/monograph-search-format.test.ts src/__tests__/memory-kg-*.test.ts src/__tests__/kg-eval-*.test.ts
# From packages/@monomind/memory
vitest run
```

- `@monomind/memory` package suite: 125 passed, 46 skipped (pre-existing semantic-mode skips).
- CLI regression sweep (memory-kg, K7/K9 eval, knowledge-retrieval-contract, knowledge-mcp-parity, memory-bridge/crud/data-loss/list/transfer/retrieval-quality, memory-search-type-mismatch, monograph search/real-index/dead-code): 209 passed, 2 skipped.
- `memory-search-method-honesty.test.ts` needs embeddings enabled (`env -u MONOMIND_NO_LOCAL_EMBEDDINGS`) — pre-existing requirement, unrelated to these fixes; passes cleanly under its own required environment (5/5).
- Full `packages/@monomind/cli` typecheck: clean except the same two pre-existing, unrelated errors (`doc.ts`, `knowledge-tools.ts`) noted in every prior report this session.

## Known limitations

- The FTS5 dedup repair (`dedupeFTS5Rows`) runs once per `initializeSchema()` call when the FTS5 table already existed — it is not a targeted migration with its own version gate, just an idempotent cleanup query that costs nothing once the store is clean. Fine for this table's size (one row per canonical entry) but worth remembering if `memory_entries_fts` ever needs a real versioned-migration story for other reasons.
- Issue #224's exact reported repro (a fresh, single-entry store) was not reproduced bit-for-bit in this environment; the fix targets the confirmed defective normalisation logic itself (verified via finding 1's duplicate-row case, which shares the identical code path and displayed the identical symptom), not a byte-for-byte replay of the reporter's exact terminal session.

// P3.14: the Phase 3 acceptance suite, end-to-end scripted scenarios in the real daemon (no model, no paid call).
//
// PHASE 3 ACCEPTANCE CHECKLIST (spec 13.1 "Acceptance for Phase 3 as a whole" and the P3.14 piece entry; each item
// is mapped below to the test names that prove it, and the table in this file checks that every named test exists)
//
//  P3.14 (A) the synthesiser is briefed first, ends its turn, is woken by each notice, reads, checks, decides
//      r24.e2e.test.ts: "briefed before any document exists and ending its turn, it reads, checks and decides every document, woken by notices alone"
//      sweep-loop.e2e.test.ts: "check, reject with reasons, relay, republish, accept, synthesise from the accepted versions"
//  P3.14 (B) inconsistent document: check flags it, consumer rejects, relay reaches the producer, republish supersedes,
//      the supersede notice brings the consumer back, all end accepted
//      sweep-loop.e2e.test.ts: "check, reject with reasons, relay, republish, accept, synthesise from the accepted versions"
//      sweep-loop.e2e.test.ts: "the full trail equals the pinned golden"
//  P3.14 (C) a publish disagreeing with the producer's file is refused naming the file; an accept after a file changed is refused
//      consistency.e2e.test.ts: "a publish disagreeing with the files is refused and counted as a consistency refusal; the producer fixes the file and republishes"
//      consistency.e2e.test.ts: "an accept refused after the producer changed a file triggers the changed-deliverable relay; the republish supersedes and is accepted"
//  P3.14 (D) a document published and never read raises the lead-watch event
//      r24.e2e.test.ts: "regression: the same script with the notices off deadlocks, the unread-watch tells the lead, and enabling delivery completes the run"
//      full-queue.e2e.test.ts: "is reported by the unread watch and sent again by the next start, then the consumer decides it"
//  P3.14 (E) a sections-off org in the same daemon is untouched (bus, files, mailbox, prompts, tools)
//      gate-parity.e2e.test.ts: "has no docs directory, no org_doc_* tool, no notice, no runtime sender and no new bus reason"
//      gate-parity.e2e.test.ts: "sections-on prompts differ from sections-off prompts by the guidance block alone, per role (scenario 9)"
//      (the sections-off golden suite sections-off-golden.test.ts, frozen-sha-tripwire.test.ts and src/__tests__/org-loadouts-default-off.test.ts run untouched)
//  P3.14 (F) stop the daemon mid-run, resume: derived state equals the replayed events, undelivered notices and relays go out once
//      crash-resume.e2e.test.ts: "after a publish (notice never sent) and after a reject (relay never sent): the resume delivers each obligation exactly once and the loop completes"
//      crash-resume.e2e.test.ts: "the unread watch is seeded from the bus history on resume: the episode count carries over"
//  P3.14 (G) a start without the eval gate is refused; a boss crash ends the run with closedBy eval-boss-crash
//      gate-parity.e2e.test.ts: "a sections org cannot start without the gate; with it, it starts"
//      gate-parity.e2e.test.ts: "a boss crash stops a sections org with closedBy eval-boss-crash and no restart"
//  Also asked of P3.14: cross-section org_send refused in the loop; access refusals in flight; no fault-record information
//      routing-access.e2e.test.ts: "a producer cannot message another section or the consumer; the lead can be reached; the documents route is open"
//      routing-access.e2e.test.ts: "a wrong producer, reader or decider is refused in flight, changes nothing, and the loop then completes"
//      sweep-loop.e2e.test.ts: "no fault-record information reaches any message, journal, event or check record"
//      gate-parity.e2e.test.ts: "the guidance block of each role names only tools that role has"
//
//  Phase 3 (1) the real-runtime scripted scenarios pass in the daemon: all of the above.
//  Phase 3 (2) the sections-off golden suite and the four SHAs pass unchanged on the final main: sections-off-golden.test.ts,
//      frozen-sha-tripwire.test.ts, src/__tests__/org-loadouts-default-off.test.ts, context-surface.test.ts (run in the gate, untouched);
//      the one-byte mutation check of P3.0 was re-run for P3.14 by hand (one changed byte in session-prompt.ts fails one test of
//      sections-off-golden.test.ts; reverted).
//  Phase 3 (3) open items 17 (relay), 18 (checks, consistency) and 19 (notice and wake) in the runtime path, by scripted tests only:
//      sweep-loop.e2e.test.ts exercises all three together; r24.e2e.test.ts is the R24 acceptance (idle consumer, deadlock regression).
//  Phase 3 (4) eval-tree parity of the runtime and the harness store on the existing v2 scenarios: piece P3.15, not part of P3.14.
//  Phase 3 (5), (6) reports, merges and migration notes: process items, no test.
//
//  Spec section 11 R24 acceptance, line by line: idle consumer completes read/check/decide and deadlocks with notices off (r24);
//  briefed before any document and woken by the first publish (r24); a republish notifies again and names the superseded version
//  (consistency, "an accept refused after the producer changed a file ..."; sweep-loop trail); the completeness notice is sent once
//  (r24, sweep-loop); the notice carries no fault or seed field (sweep-loop, "no fault-record information ..."); a full consumer queue
//  does not lose the notice for good (full-queue: the bounded mailbox evicts it, the watch tells the lead, the next start sends it
//  again); 6.2(f) raises a lead event for a document nobody reads (r24, full-queue). DEVIATION recorded by P3.13: the watch also raises
//  for a notice the runtime could not deliver, labelled cause "notice-undelivered", instead of staying silent while a notice is pending.
//
// DEFERRED BY 9.1, NOT TESTED HERE (no test in this suite or in Phase 3 covers them; the build did not implement them):
//  - provenance before exposure          - freshness (on_stale)               - review grants (publish-time read grants, gates)
//  - store write-protection (A29)        - requests and answers (request/answer types, via-lead routing, settlement)
//  - the non-evicting outbox (A41)       - budget partitions                  - completion gates
//  - reload epochs
//  Also not covered end to end: a real process kill (the crash scenarios stop the daemon and use the notice engine's test switch
//  for the "died after the commit" moments), concurrent producers racing the same document, and any measurement of catch rates.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** Every test name the checklist above cites, by file. */
const MAPPED: Record<string, string[]> = {
  'r24.e2e.test.ts': [
    'briefed before any document exists and ending its turn, it reads, checks and decides every document, woken by notices alone',
    'regression: the same script with the notices off deadlocks, the unread-watch tells the lead, and enabling delivery completes the run',
  ],
  'sweep-loop.e2e.test.ts': [
    'check, reject with reasons, relay, republish, accept, synthesise from the accepted versions',
    'no fault-record information reaches any message, journal, event or check record',
    'the full trail equals the pinned golden',
  ],
  'consistency.e2e.test.ts': [
    'a publish disagreeing with the files is refused and counted as a consistency refusal; the producer fixes the file and republishes',
    'an accept refused after the producer changed a file triggers the changed-deliverable relay; the republish supersedes and is accepted',
  ],
  'routing-access.e2e.test.ts': [
    'a producer cannot message another section or the consumer; the lead can be reached; the documents route is open',
    'a wrong producer, reader or decider is refused in flight, changes nothing, and the loop then completes',
  ],
  'crash-resume.e2e.test.ts': [
    'after a publish (notice never sent) and after a reject (relay never sent): the resume delivers each obligation exactly once and the loop completes',
    'the unread watch is seeded from the bus history on resume: the episode count carries over',
  ],
  'full-queue.e2e.test.ts': ['is reported by the unread watch and sent again by the next start, then the consumer decides it'],
  'gate-parity.e2e.test.ts': [
    'a sections org cannot start without the gate; with it, it starts',
    'a boss crash stops a sections org with closedBy eval-boss-crash and no restart',
    'has no docs directory, no org_doc_* tool, no notice, no runtime sender and no new bus reason',
    'sections-on prompts differ from sections-off prompts by the guidance block alone, per role (scenario 9)',
    'the guidance block of each role names only tools that role has',
  ],
};

const DEFERRED = [
  'provenance before exposure',
  'freshness',
  'review grants',
  'store write-protection',
  'requests and answers',
  'non-evicting outbox',
  'budget partitions',
  'completion gates',
  'reload epochs',
];

describe('the Phase 3 acceptance checklist', () => {
  it('names only tests that exist, and every e2e test file is in the checklist', () => {
    const files = readdirSync(here).filter((f) => f.endsWith('.e2e.test.ts') && f !== 'index.e2e.test.ts');
    expect(files.sort()).toEqual(Object.keys(MAPPED).sort());
    for (const [file, titles] of Object.entries(MAPPED)) {
      const src = readFileSync(join(here, file), 'utf8');
      for (const t of titles) expect(src, `${file}: ${t}`).toContain(`'${t}'`);
      // and no test of the file is left out of the checklist
      const all = [...src.matchAll(/\n\s+it\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
      expect(all.sort(), file).toEqual([...titles].sort());
    }
  });

  it('the checklist header cites every mapped test and lists every deferred item', () => {
    const header = readFileSync(join(here, 'index.e2e.test.ts'), 'utf8').split('\nimport ')[0];
    for (const titles of Object.values(MAPPED)) for (const t of titles) expect(header, t).toContain(t);
    for (const d of DEFERRED) expect(header.toLowerCase(), d).toContain(d.toLowerCase());
  });
});

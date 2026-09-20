/**
 * i-052: the single source of truth for files under `.monomind/` that must
 * NEVER be committed, consumed by all three previously-independent curated
 * lists — the generated `.monomind/.gitignore` body and
 * `MONOMIND_GITIGNORE_SPECIFIC_EXCLUDES` (`write-runtime-config.ts`), and
 * `doctor-project-checks.ts`'s `REQUIRED_GITIGNORE_PATTERNS`. All three
 * independently omitted `dashboard-token` — a live monomind dashboard
 * credential that ended up committed to a public GitHub repository — and
 * the doctor check written specifically to catch gitignore gaps was one of
 * them. Three hand-maintained lists agreeing to omit the same file is proof
 * that curation has failed; a fourth hand-maintained entry in each is not
 * the fix. One list, three consumers, so they cannot disagree again.
 *
 * `enable-terminal.json` (i-032a) is included for the same reason: a
 * terminal-access opt-in flag that, if committed, silently re-enables
 * terminal access for anyone who clones the repo. `write-runtime-config.ts`'s
 * deny-by-default `.monomind/.gitignore` inversion (i-052 commit 2) covers
 * both files for NEW projects by construction (neither is on the
 * allow-list), but existing projects are migrated only by a content-guarded
 * append, never a rewrite — so an entry here is what actually reaches the
 * installed base, which is exactly where `dashboard-token` was already
 * tracked.
 *
 * Deliberately its own file with NO other project imports: both
 * `write-runtime-config.ts` and `doctor-project-checks.ts` need this list,
 * and `write-runtime-config.ts` transitively imports `doctor.ts` (via
 * `write-capabilities.ts`), which imports `doctor-project-checks.ts` — so a
 * direct import from either of those two files into the other is a real
 * circular dependency (reproduced: `MONOMIND_NEVER_COMMIT` read as
 * `undefined` at module-evaluation time when doctor-project-checks.ts
 * imported it directly from write-runtime-config.ts). A leaf module with no
 * imports of its own cannot participate in a cycle.
 */
export interface NeverCommitEntry {
  readonly file: string;
  readonly reason: string;
}

export const MONOMIND_NEVER_COMMIT: readonly NeverCommitEntry[] = [
  {
    file: 'monoes-connection.json',
    reason: 'the monoes.me OAuth refresh token (i-066) — must never be committed',
  },
  {
    file: 'dashboard-token',
    reason:
      'live monomind dashboard credential (i-052) — grants cross-project file reads and agent execution; rewritten on every dashboard restart, so an already-tracked path re-commits a fresh live token on every restart',
  },
  {
    file: 'enable-terminal.json',
    reason:
      'terminal-access opt-in flag (i-032a) — committing it can silently re-enable terminal access for anyone who clones the repo',
  },
];

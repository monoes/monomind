# Cleanup --scratch Design

**Problem:** The taskdev workflow (brief/report/diff files, progress ledger) writes scratch to `.monomind/taskdev/`, and tillend/repeat loops write state to `.monomind/loops/`. Completed loops delete their own state, but crashed or abandoned runs leave files behind forever. Nothing prunes either directory.

**Decision (auto mode):** Add a `--scratch` flag to the existing `monomind cleanup` command. When set, cleanup targets ONLY stale mastermind scratch instead of the full uninstall-style artifact list.

## Approaches considered

1. **`cleanup --scratch` flag (chosen)** — reuses cleanup's existing dry-run/`--force` semantics and output shape; smallest surface.
2. Auto-prune from the taskdev skill doc — doc-only, but crashed runs (the actual problem) never reach the cleanup step.
3. A background hooks worker — heavier, new worker lifecycle, overkill for an `rm` of a handful of files.

## Behavior

- `monomind cleanup --scratch` — dry run (default): list what would be removed.
- `monomind cleanup --scratch --force` — delete.
- `--keep-config` is irrelevant to scratch and ignored.

**Stale means:**

| Target | Rule |
|---|---|
| `.monomind/taskdev/<file>` | plain file with mtime older than 7 days; `progress.md` (the ledger) is NEVER pruned |
| `.monomind/loops/<id>.json` | `nextRunAt` more than 24 hours in the past (a live loop reschedules every ≤1h) |
| `.monomind/loops/<id>.stop` | no matching `<id>.json` (orphaned stop request) |

**Safety rules:** unreadable/unparseable loop JSON is skipped, never deleted (don't delete what can't be classified). Only plain files are touched — no directories, no symlink traversal. Missing directories are a no-op.

## Success criteria

- Dry run lists stale items and deletes nothing.
- `--force` deletes exactly the stale set; fresh scratch, the ledger, live loops, and paired stopfiles survive.
- Existing cleanup behavior (without `--scratch`) is unchanged.
- Tests cover all rows of the stale table plus the safety rules.

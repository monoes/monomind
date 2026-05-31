---
name: mastermind-autodev
description: Autonomous research → build → review loop. Researches the project, picks the best improvement, builds it, and reviews until clean. Repeat N times with a leading integer (e.g. `/mastermind:autodev 9`). Use --newfeature N to discover and fully deliver N brand-new features (build → review → document → stage). Supports --tillend.
---

**Pre-PREAMBLE compatibility check:** Before following the REPEAT PREAMBLE, scan `$ARGUMENTS` for both `--newfeature` and `--tillend` present simultaneously. If both are found, emit `[autodev] Warning: --tillend is not supported with --newfeature and will be ignored.` and remove `--tillend` from `$ARGUMENTS` now — before the PREAMBLE processes it — so the PREAMBLE never creates a tillend loop state file.

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- **Leading integer** (first token is a bare number, e.g. `9`) → `count = 9` (how many improvements to build)
- `--count <N>` → `count = N`
- `--newfeature <N>` → activate feature mode; `newfeature_count = N`. Discovers N best genuinely-new features and runs full pipeline: Build → Review → Documentation → Delivery for each. Overrides the normal improvement loop.
- `--focus <topic>` → focus hint (e.g. "performance", "security", "dx")
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- Remaining text → additional focus context

If no count is set, default `count = 1`.
If `--newfeature` is present without a valid N, default `newfeature_count = 3`.
If `newfeature_count > 10`: warn the user and set `newfeature_count = 10`.
(The `--newfeature + --tillend` incompatibility is already handled by the pre-PREAMBLE check above.)

Load brain context for the `autodev` domain (follow _protocol.md Brain Load Procedure).

Default mode for this command: **auto** (unless `--confirm` flag present).

Invoke `Skill("mastermind:autodev")` passing: brain_context, count, newfeature_count, focus, mode, board_id (create if needed).

After skill returns: follow _protocol.md Brain Write Procedure for domain `autodev`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.

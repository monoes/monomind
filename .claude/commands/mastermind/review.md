<!-- Mastermind review domain — code review, security audit, content and strategy review. Default mode: auto. -->

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What would you like reviewed?"

Load brain context for the `review` domain (follow _protocol.md Brain Load Procedure).

Run intake if prompt is vague (follow _intake.md — stop at Q3, domain is already known as `review`).

Default mode for this command: **auto** (unless `--confirm` flag present or intake Q4 says confirm).

Invoke `Skill("mastermind-skills:review")` passing: brain_context, prompt, project_name, board_id (create if needed), mode.

**After review findings are collected — AUTO-FIX STEP (mode = auto only):**

When `mode = auto` (the default): if the review produced any fixable findings (code issues, bugs, style problems, security vulnerabilities with clear fixes), apply the fixes immediately in this same run. Do not ask the user whether to fix — auto mode means fix without asking. Specifically:
1. For each fixable finding, edit the file directly to resolve it.
2. After all fixes are applied, output a summary: `[review] Auto-fixed N issues. Remaining M issues require manual intervention.`
3. Non-fixable findings (architectural concerns, design questions, trade-off decisions) are reported but not acted on.

When `mode = confirm`: present findings and ask the user which to fix. This is the ONLY mode where asking is appropriate.

**When `--tillend` is active:** auto-fix is especially critical. Without it, the loop finds the same unfixed issues every round and either loops forever or the AI falsely declares an empty round. The tillend contract is: find → fix → verify (next round) → stop when clean.

After skill returns: follow _protocol.md Brain Write Procedure for domain `review`.

**MANDATORY — invoke `Skill("mastermind-skills:_repeat")` now.** This is required regardless of how the skill above completed, regardless of whether you think the work is done, regardless of whether you plan to end your response. For `--repeat N`: the count is non-negotiable — all N runs must happen. For `--tillend`: only a verified empty round (confirmed by git diff) stops the loop. Do not end your response without invoking this skill.

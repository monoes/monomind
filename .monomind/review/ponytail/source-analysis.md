# Source Analysis: ponytail

**Analyst role:** Source Analyst
**Source path:** /Users/morteza/Desktop/tools/ponytail
**Date:** 2026-06-24

---

## Module Inventory

| Module | File(s) | Purpose |
|--------|---------|---------|
| core-skill | skills/ponytail/SKILL.md | Main laziness-ladder skill (7 rungs, 3 intensity levels) |
| review-skill | skills/ponytail-review/SKILL.md | Diff-level over-engineering review with tagged findings |
| audit-skill | skills/ponytail-audit/SKILL.md | Repo-wide complexity scan, ranked findings |
| debt-skill | skills/ponytail-debt/SKILL.md | Harvest `ponytail:` comment markers into ledger |
| gain-skill | skills/ponytail-gain/SKILL.md | ASCII scoreboard of benchmark medians |
| help-skill | skills/ponytail-help/SKILL.md | Reference card: levels, skills, config, deactivation |
| session-hook | hooks/ponytail-activate.js | SessionStart: reads mode, emits instructions to context |
| subagent-hook | hooks/ponytail-subagent.js | SubagentStart: propagates mode+instructions to subagents |
| mode-tracker | hooks/ponytail-mode-tracker.js | UserPromptSubmit: parses /ponytail commands, updates flag file |
| config-module | hooks/ponytail-config.js | VALID_MODES, getDefaultMode (env→file→'full'), isDeactivationCommand |
| instructions-module | hooks/ponytail-instructions.js | filterSkillBodyForMode, getPonytailInstructions |
| runtime-module | hooks/ponytail-runtime.js | writeHookOutput: abstracts Copilot/Codex/Claude output formats |
| statusline-script | hooks/ponytail-statusline.sh | ANSI-colored [PONYTAIL] statusline badge |
| hooks-manifest | hooks/claude-codex-hooks.json | Hook registration (SessionStart, SubagentStart, UserPromptSubmit) |
| mcp-server | ponytail-mcp/index.js | Prompt + tool registration via @modelcontextprotocol/sdk |
| mcp-instructions | ponytail-mcp/instructions.js | resolveMode, buildInstructions for MCP callers |
| pi-extension | pi-extension/index.js | Full Pi IDE extension (commands, status bar, agent injection) |
| agents-md | AGENTS.md | Plain-markdown ladder for direct agent file injection |

---

## Core Concept: The Laziness Ladder

7-rung decision tree, stop at first rung that holds:

1. Does this need to exist at all? (YAGNI)
2. Already in this codebase? Reuse it.
3. Stdlib does it? Use it.
4. Native platform feature covers it? Use it.
5. Already-installed dependency solves it? Use it.
6. Can it be one line? One line.
7. Only then: minimum code that works.

## Intensity Levels

| Level | Behavior |
|-------|----------|
| lite | Suggest lazier alternative in one line; user decides |
| full | Ladder enforced. Stdlib/native first. Shortest diff. (Default) |
| ultra | YAGNI extremist. Deletion before addition. Challenge requirement in same breath. |

## Key Technical Mechanics

**Flag file:** `$CLAUDE_CONFIG_DIR/.ponytail-active` — stores active mode string.

**Mode resolution:** env var `PONYTAIL_DEFAULT_MODE` → `~/.config/ponytail/config.json` → `'full'`.

**filterSkillBodyForMode(body, mode):** strips YAML frontmatter, then for the intensity table keeps only the row matching `| **<mode>** |`, for examples keeps lines matching `- <mode>:` prefix. All other lines pass through verbatim.

**SessionStart hook:** reads mode, writes flag file, emits `getPonytailInstructions(mode)` to session context, optionally nudges statusline setup.

**SubagentStart hook (issue #252 fix):** reads flag file, re-emits filtered instructions to subagent context. Critical: solves SessionStart context not propagating to spawned subagents.

**UserPromptSubmit mode tracker:** matches `/^[/@$]ponytail/` and `"stop ponytail"/"normal mode"` for deactivation.

**MCP server:** registers both a prompt (user-invocable) and a tool (for hosts that pull via tools) — dual-surface delivery.

**`ponytail:` comment convention:** marks deliberate shortcuts. Format: `// ponytail: <ceiling> [, upgrade path]`. Harvested by ponytail-debt skill.

**Output format rule:** code first, then at most 3 short lines: what was skipped, when to add it. `[code] → skipped: [X], add when [Y].`

## Claimed Benchmarks (ponytail-gain skill)

Benchmark medians from the scoreboard:
- Lines of code: 6-20% of original (80-94% reduction)
- Cost: 23-53% of original (47-77% reduction)
- Speed: 3-6x faster

Note: These are benchmark medians from examples tested with ponytail active. Per-repo numbers require `/ponytail-audit` + `/ponytail-debt`.

## "When NOT to be lazy" Boundaries

Never simplify away: input validation at trust boundaries, error handling preventing data loss, security measures, accessibility basics, anything explicitly requested, understanding the problem (always trace full flow before ladder).

## Structural Strengths

1. The skill is self-contained — works standalone with zero infrastructure.
2. The SubagentStart propagation solves a real problem (context loss in spawned agents).
3. filterSkillBodyForMode reduces token payload by only injecting the relevant intensity section.
4. The `ponytail:` comment convention creates an in-code audit trail (harvested by debt skill).
5. Deactivation commands are exact-match-only (prevents false positives).
6. AGENTS.md provides a no-frontmatter injection target for repos that inject agent context files.

## Structural Weaknesses

1. No integration with token tracking — cannot measure whether instructions are saving tokens in practice.
2. Flag file approach is per-machine, per-config-dir — doesn't survive context compaction in a new session.
3. The benchmark numbers in ponytail-gain are medians from examples, not live per-project measurements.
4. MCP server has no streaming — all instructions delivered in one payload.
5. pi-extension is tightly coupled to Pi IDE — not portable to other editors.
6. `filterSkillBodyForMode` hardcodes `| **<mode>** |` and `- <mode>:` patterns — brittle to SKILL.md edits.
7. No learning: the system cannot observe that rung 2 ("reuse from codebase") repeatedly fires in this project and surface that insight.

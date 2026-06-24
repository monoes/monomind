# Target Analysis: monomind

**Analyst role:** Target Analyst
**Target path:** /Users/morteza/Desktop/tools/monomind
**Date:** 2026-06-24

---

## Relevant Existing Capabilities

### Skills System
- Location: `/Users/morteza/Desktop/tools/monomind/.claude/skills/`
- Format: `<name>/SKILL.md` with YAML frontmatter (name, description, argument-hint, license)
- Skill tool invoked via `Skill` tool in Claude Code
- ~20 skills currently: monodesign, mastermind, monomotion, stop-slop, pair-programming, sparc-methodology, etc.
- No efficiency/laziness/lean-code skill exists

### Hooks System
- Registration: `.claude/settings.json` hooks array
- Active hooks at SessionStart: `session-restore`, `graphify-freshen`, `control-start`
- Active hooks at SubagentStart: `pre-task` (auto-spawns agents), `capture-handler` (JSONL token snapshot)
- Active hooks at UserPromptSubmit: (none currently)
- Hook scripts in `.claude/helpers/`
- Token tracking via capture-handler.cjs diffs JSONL file sizes on SubagentStop

### Token Tracking
- `packages/@monomind/cli/src/commands/tokens.ts`: dashboard, summary, today subcommands
- `.claude/helpers/capture-handler.cjs`: snapshots JSONL token data at SubagentStart, diffs at SubagentStop
- Already tracks cost-per-call, call counts per project
- Does NOT track whether code complexity decisions affect token consumption

### Intelligence / Learning
- ReasoningBank: vector-based pattern storage and retrieval
- `hooks-extended-commands.ts` `token-optimize` command: queries ReasoningBank, shows anti-drift config
- Workers: `optimize`, `refactor`, `audit` background workers already exist
- Intelligence trajectory logging: records task→outcome for routing improvement

### Statusline
- `packages/@monomind/hooks/src/statusline/index.ts`: StatuslineGenerator class
- Reads `.monomind/metrics/v1-progress.json`, `audit-status.json`, `swarm-activity.json`
- Shows DDD progress, swarm activity, CVE count, memory MB, context%, intelligence%
- No mode-indicator slot currently

### CLI Command Registration
- `packages/@monomind/cli/src/commands/hooks.ts`: 17+ subcommands
- Pattern: `program.command('hooks <subcommand>').action(handler)`
- New hook commands can be added by extending this file

### Monograph Knowledge Graph
- 26,826 nodes, 35,858 edges
- BM25 search, can identify installed dependencies, import chains
- Relevant for rung 5 of the ladder ("already-installed dependency solves it?")

### Existing Relevant Skills (Overlap Check)
- `stop-slop`: removes AI writing patterns — operates on prose, not code complexity
- No skill covers: YAGNI decisions, stdlib-first choices, over-engineering detection, code review for complexity

---

## Integration Fit Assessment

### High-Fit Integration Points

| Integration Point | Fit | Reason |
|------------------|-----|--------|
| `.claude/skills/monolean/SKILL.md` | Excellent | Slots directly into existing skill infrastructure |
| SessionStart hook injection | Excellent | Pattern already in settings.json; capture-handler proves the SubagentStart pattern works |
| SubagentStart hook injection | Excellent | Already present for capture-handler; add monolean-propagate.cjs alongside it |
| Statusline badge | Good | StatuslineGenerator is extensible; monolean mode can add a [LEAN] indicator |
| `hooks monolean-mode` CLI command | Good | Extends existing hooks.ts pattern cleanly |
| UserPromptSubmit mode-tracker | Good | No hook currently at this event; clean addition |

### Superpower Extensions (monomind-only)

| Extension | Fit | Ponytail Has This? |
|-----------|-----|-------------------|
| ReasoningBank stores which rungs fire per project | Excellent | No |
| Token tracking correlates lean mode active vs cost | Excellent | No |
| Monograph rung-5 assist (query installed deps) | Good | No |
| `optimize` worker auto-applies lean review pass | Good | No |
| AGENTS.md injection via init flow | Good | No |

### Low-Fit / Skip

| Component | Fit | Reason |
|-----------|-----|--------|
| ponytail-mcp server | Low | monomind already has an MCP server; adding a separate one is overhead |
| pi-extension | Skip | Pi IDE not in use; monomind uses Claude Code |
| ponytail-gain scoreboard | Low | Ponytail-specific benchmark numbers; monomind should measure its own via tokens.ts |

---

## Gaps to Close

1. **No laziness/efficiency coding skill** — gap is confirmed, no overlap with existing skills.
2. **SubagentStart does not propagate any coding discipline** — it runs capture-handler but nothing about how to write code. Adding monolean-propagate fills this gap.
3. **UserPromptSubmit hook not registered at all** — ponytail mode-tracker needs this event. Clean addition.
4. **Statusline has no mode indicator slot** — StatuslineGenerator needs one new optional field read from `.monomind/metrics/monolean-mode.json` or flag file.
5. **No debt-tracking for deliberate shortcuts** — `monolean:` comment harvesting is not implemented anywhere.
6. **No correlation between lean mode and token cost** — tokens.ts tracks totals but not mode-conditional savings.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Hook conflicts at SessionStart if monolean-activate runs after session-restore | Low | Hook order in settings.json is deterministic; append last |
| Mode flag file survives context compaction? | Medium | Store in `.monomind/state/monolean-mode` (project-scoped), not config dir |
| filterSkillBodyForMode fragility | Low | Port the function with improved regex; test against SKILL.md |
| Token overhead of injecting full instructions | Low | filterSkillBodyForMode already solves this; inject only active mode section |

---

## Summary

monomind has all the infrastructure needed: skills system, hook pipeline, token tracking, intelligence/learning backend, and statusline. The monolean concept slots in cleanly with zero architectural conflicts. The monomind-specific extensions (ReasoningBank rung-learning, monograph dep-assist, token correlation) make it strictly more powerful than the source.

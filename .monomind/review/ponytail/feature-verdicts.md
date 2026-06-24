# Feature Verdicts

**Analyst role:** Critic Architect
**Date:** 2026-06-24

Verdicts: ADOPT (use as-is with rebrand), ADAPT (port with modifications), RESTRUCTURE (significant redesign needed), VETO (do not port).

---

## Module Verdicts

### core-skill → monolean skill

**Verdict: ADAPT**

The skill body is excellent. The 7-rung ladder, intensity levels, output format, and "When NOT to be lazy" boundaries are all sound and well-tested. Port with these changes:

- Remove all `ponytail` branding; rename to `monolean` throughout
- Rebrand the skill invocation triggers: "monolean", "be lean", "lean mode", "simplest solution", "minimal solution", "yagni", "do less", "shortest path", and complaints about over-engineering/bloat/boilerplate
- Replace `ponytail:` comment convention with `monolean:` comment convention
- Replace `[lite|full|ultra]` argument-hint (keep the levels themselves — they are sound)
- Prepend an optional monomind-integration note: "In monomind projects, rung 2 is assisted by the knowledge graph (monograph); rung 5 is assisted by installed-dep lookup"
- Remove worked examples section that contain `ponytail` word — rewrite with mono* naming

Net change: primarily a rebrand + minor monomind integration notes. The ladder itself is ADOPT-quality.

---

### review-skill → monolean-review skill

**Verdict: ADOPT**

The format (`L<line>: <tag> <what>. <replacement>.`), tag vocabulary (delete/stdlib/native/yagni/shrink), scoring (`net: -N lines possible`), and scope boundaries are clean, useful, and non-overlapping with existing monomind skills. Port as-is except:
- Rename `ponytail-review` → `monolean-review`
- Update trigger description
- Replace `ponytail minimum` reference with `monolean minimum`

---

### audit-skill → monolean-audit skill

**Verdict: ADOPT**

Repo-wide scan, ranked findings. Same tags. Useful standalone. Port with rebrand only.

---

### debt-skill → monolean-debt skill

**Verdict: ADAPT**

The grep-based harvesting is sound. Adapt the comment marker from `ponytail:` to `monolean:`. Additionally extend to write output to `.monomind/metrics/monolean-debt.json` so the statusline worker can consume it (this is the Proposal 4 extension — wire it in at port time).

---

### gain-skill → monolean-gain skill

**Verdict: VETO**

The scoreboard numbers (6-20% LOC, 23-53% cost, 3-6x speed) are benchmark medians from ponytail's own test suite. They do not apply to monomind and cannot be validated. Publishing these numbers as a monomind skill would be misleading. Instead, Proposal 2 (token-delta correlation via capture-handler) gives real per-project numbers. The gain skill is replaced by the `monomind hooks lean-delta` command.

See veto-log.md for full reasoning.

---

### help-skill → monolean-help skill

**Verdict: ADAPT**

Reference card is useful. Port with rebrand and update config section: replace `~/.config/ponytail/config.json` and `PONYTAIL_DEFAULT_MODE` with `.monomind/state/monolean-mode` and `MONOLEAN_DEFAULT_MODE`. Update the skills table to list monolean-* skill names.

---

### session-hook → monolean-activate.cjs

**Verdict: ADAPT**

The SessionStart hook pattern is directly compatible with monomind's settings.json hook array. Port `ponytail-activate.js` as `monolean-activate.cjs` with:
- Mode read from `.monomind/state/monolean-mode` (project-scoped, survives context compaction)
- Remove Pi/Copilot/Codex branches (not needed in monomind/Claude Code context)
- Remove statusline nudge (monomind statusline is already configured)
- Optionally query ReasoningBank for rung-affinity hint before emitting instructions (Proposal 1 — optional, Phase 2)
- Register in `.claude/settings.json` under SessionStart

---

### subagent-hook → monolean-propagate.cjs

**Verdict: ADOPT**

This is the most critical hook to port. SubagentStart context loss (issue #252 in ponytail) is a real problem in monomind too. The capture-handler already uses SubagentStart; add monolean-propagate.cjs alongside it. Port directly, adapting only the flag file path and filterSkillBodyForMode import path.

---

### mode-tracker → monolean-tracker.cjs

**Verdict: ADAPT**

Port the UserPromptSubmit mode-tracking pattern. Adapt triggers from `/^[/@$]ponytail/` to `/^[/@$]monolean/`. Add optional Proposal 3 extension (monograph dep-query) in the same file. Register in `.claude/settings.json` under UserPromptSubmit (currently empty).

---

### config-module → monolean-config.cjs

**Verdict: ADOPT**

VALID_MODES, getDefaultMode (env→file→'full'), isDeactivationCommand ("stop monolean"/"normal mode"), isShellSafe — port with rebrand. Move config path to `.monomind/state/monolean-mode`.

---

### instructions-module → monolean-instructions.cjs

**Verdict: ADOPT**

filterSkillBodyForMode and getPonytailInstructions (renamed getMonoleanInstructions). Port directly. Harden the intensity table regex slightly: use `\|\s*\*\*${mode}\*\*\s*\|` instead of exact string match.

---

### runtime-module → monolean-runtime.cjs

**Verdict: RESTRUCTURE**

The multi-platform output abstraction (Copilot/Codex/Claude/Pi) is overengineered for monomind's use case. Monomind only targets Claude Code. Replace with a single `writeHookOutput(text)` that writes to stdout directly. No platform detection needed. Net: ~70% fewer lines.

---

### statusline-script → statusline integration

**Verdict: ADAPT**

Do not add a separate shell script. Instead, extend `StatuslineGenerator` to read `.monomind/metrics/monolean-mode.json` (written by monolean-activate.cjs) and append `[LEAN]` or `[LEAN:ultra]` to the existing statusline output. Zero new files, one new field in the existing class.

---

### hooks-manifest → settings.json additions

**Verdict: ADOPT**

Add three hook entries to `.claude/settings.json`:
- SessionStart: `node "$CLAUDE_PROJECT_DIR/.claude/helpers/monolean-activate.cjs"`
- SubagentStart: `node "$CLAUDE_PROJECT_DIR/.claude/helpers/monolean-propagate.cjs"`
- UserPromptSubmit: `node "$CLAUDE_PROJECT_DIR/.claude/helpers/monolean-tracker.cjs"`

---

### mcp-server → VETO

**Verdict: VETO**

monomind already has an MCP server. A separate MCP server for monolean mode adds operational overhead for zero user benefit. The skill + hook approach delivers the same functionality without a second process. See veto-log.md.

---

### pi-extension → VETO

**Verdict: VETO**

Pi IDE is not used. Monomind targets Claude Code exclusively. See veto-log.md.

---

### AGENTS.md pattern → Proposal 6 (init --lean)

**Verdict: RESTRUCTURE**

The pattern of injecting a condensed ladder into AGENTS.md is sound, but the manual copy approach is not how monomind works. Restructure as a `monomind init --lean` flag that auto-writes the AGENTS.md fragment. This integrates cleanly with the existing init command rather than adding a standalone file.

---

## Innovation Proposals — Verdicts

| Proposal | Verdict | Priority |
|----------|---------|----------|
| 1: ReasoningBank rung memory | ADOPT — Phase 2 | Medium |
| 2: Token delta correlation | ADOPT — Phase 1 | High |
| 3: Monograph rung-5 dep assist | ADOPT — Phase 2 | Medium |
| 4: monolean-debt worker | ADOPT — Phase 1 | High |
| 5: monolean-review inline hook (ultra) | ADAPT — Phase 2 | Low |
| 6: AGENTS.md via init --lean | ADOPT — Phase 1 | Medium |

---

## Summary Counts

| Verdict | Count |
|---------|-------|
| ADOPT | 7 |
| ADAPT | 7 |
| RESTRUCTURE | 2 |
| VETO | 3 |

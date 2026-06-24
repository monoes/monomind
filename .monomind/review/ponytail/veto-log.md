# Veto Log

**Analyst role:** Critic Architect
**Date:** 2026-06-24

---

## VETO: ponytail-gain skill → monolean-gain

**Component:** `skills/ponytail-gain/SKILL.md`

**Reason:** The scoreboard numbers (6-20% LOC reduction, 23-53% cost reduction, 3-6x speed improvement) are benchmark medians from ponytail's own test suite using ponytail's own examples. They are not derived from real-world monomind sessions. Publishing these as a monomind feature claim would be misleading.

The skill itself states: "NEVER prints per-repo savings (unbuilt version was never written)." This confirms the numbers are illustrative, not measured.

**What replaces it:** Proposal 2 (Token Delta Correlation) produces real per-project savings numbers from monomind's existing capture-handler token tracking. When `lean-delta` command accumulates enough data, a `monolean-gain` skill backed by real numbers can be written. Until then, this feature is deferred, not ported.

**Condition to revisit:** After 30+ sessions with monolean active, `monomind hooks lean-delta` produces sufficient data. At that point the gain skill can be written with real monomind numbers.

---

## VETO: ponytail-mcp server

**Component:** `ponytail-mcp/index.js`, `ponytail-mcp/instructions.js`

**Reason:** monomind already runs an MCP server (`npx monomind@latest mcp start`). Adding a second MCP server for lean mode delivery duplicates process management overhead (separate stdio transport, separate Node process, separate registration in CLAUDE.md `claude mcp add` entries) for zero user benefit. The skill + SessionStart hook approach delivers identical functionality: the model receives the same instructions, just via hook injection rather than MCP prompt pull.

The MCP dual-surface pattern (prompt + tool) was designed for environments that don't have Claude Code's hook system — environments monomind doesn't target.

**What replaces it:** SessionStart hook (`monolean-activate.cjs`) injects instructions directly. SubagentStart hook (`monolean-propagate.cjs`) propagates to subagents. Same outcome, no new process.

---

## VETO: pi-extension

**Component:** `pi-extension/index.js`

**Reason:** Pi IDE is not used in the monomind development environment. The extension is tightly coupled to Pi's plugin API (`pi.ui.setStatus`, `pi.on('before_agent_start')`, `pi.registerCommand`). Porting it would produce dead code with no execution path.

**What replaces it:** The statusline integration in `StatuslineGenerator` (ADAPT verdict) provides equivalent mode visibility in the Claude Code terminal UI. The hook-based mode-tracking covers the `before_agent_start` injection path.

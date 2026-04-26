# agency-agents (msitarzewski/agency-agents)

**Source:** https://github.com/msitarzewski/agency-agents  
**Category:** Agent Architecture  
**Role in Monomind:** Agent definition patterns and markdown-based agent files

---

## What It Is

Agency-agents is a lightweight multi-agent framework that defines agents as self-contained markdown files with embedded role descriptions, capabilities, and behavioral constraints. It demonstrated that agent identity could be expressed purely in structured natural language rather than code.

## What We Extracted

### 1. Markdown Agent Files
The concept that each agent is a `.md` file under `.claude/agents/` comes directly from agency-agents. Each file carries the agent's name, description, system prompt, tool access list, and behavioral rules in a human-readable format that Claude Code can load on demand.

### 2. Multi-Agent Coordination via Shared Instructions
The `.agents/shared_instructions.md` pattern — a single file that propagates common rules to all agents — was inspired by agency-agents' shared context approach. In Monomind, this file is auto-loaded on every `SessionStart` with a hard 1500-character budget enforced by `hook-handler.cjs`.

### 3. Role Specialization Over Generalism
Agency-agents proved that giving each agent a tightly scoped role (coder, tester, reviewer) with explicit boundaries produces better results than one general-purpose agent. Monomind adopted this as a first principle: 60+ specialized agent types, each with a distinct system prompt and tool set.

## How It Improved Monomind

The agent-as-markdown pattern made Monomind's agent roster inspectable and version-controllable without any runtime compilation. Users can read, edit, and create agents by editing plain text files. The routing system can load an agent's full text on demand via `loadExtrasAgent()` and inject it into the current session context.

## Key Files Influenced

- `.claude/agents/*.md` — every agent definition file
- `.agents/shared_instructions.md` — cross-agent shared context
- `hook-handler.cjs` `load-agent` handler — runtime agent injection
- `hook-handler.cjs` `list-extras` handler — agent discovery

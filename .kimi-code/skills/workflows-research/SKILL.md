---
name: workflows-research
description: Research workflow pattern — parallel researcher agents via the Task tool with findings kept in memory, or a research-pod org via npx monomind org
type: flow
---

# Research Workflow Coordination

Coordinate multi-agent research. The CLI has no `workflow` command; run the stages with the Task tool, or as a `research-pod` org.

## How to Invoke

```
Skill("workflows:research")
```

---

## Stages

1. **Discovery** — identify sources, gather raw information
2. **Analysis** — evaluate and compare findings
3. **Synthesis** — combine into conclusions
4. **Documentation** — write up findings

## In the Conversation (Task Tool)

Search past research first:

```bash
npx monomind memory search --query "web framework performance" --namespace research
```

Spawn one researcher per angle, in one message:

```javascript
Task({ subagent_type: "researcher", prompt: "Benchmarks and SSR performance of Next.js vs Astro vs SvelteKit (2026 sources)." })
Task({ subagent_type: "researcher", prompt: "Bundle size and hydration cost comparisons for the same frameworks." })
Task({ subagent_type: "researcher", prompt: "Production case studies and migration reports for the same frameworks." })
```

Synthesize the results in the conversation, then store the conclusion:

```bash
npx monomind memory store --key "research-web-frameworks-2026" \
  --value "Next.js leads for SSR; Astro for static; Svelte for runtime performance" \
  --namespace research
```

Optional: record a mesh topology for the roster with `npx monomind monoswarm init --topology mesh --max-agents 5`.

## As an Org

```bash
npx monomind org create fw-brief --template research-pod --goal "Brief on web framework performance"
npx monomind org run fw-brief
npx monomind org report fw-brief
```

The `research-pod` template has lead-analyst, researcher, and fact-checker roles.

## What Claude Code Actually Does

1. **WebSearch / WebFetch** — find and read sources
2. **Read** — analyze documentation and code
3. **Task** — parallel research agents for different angles
4. Synthesizes findings and stores them in memory

## Related Skills

- `workflows:workflow-execute` — Running workflows
- `monoswarm:research` — Monoswarm-based research coordination
- `mastermind-research` — Structured research protocol
- `memory:memory-search` — Search past findings

# LangGraph (langchain-ai/langgraph)

**Source:** https://github.com/langchain-ai/langgraph  
**Category:** Workflow Orchestration Framework  
**Role in Monobrain:** Graph checkpointing, StateGraph DSL, entity extraction

---

## What It Is

LangGraph is LangChain's framework for building stateful, multi-step agentic workflows as directed graphs. Its core innovation is treating agent execution as a traversable graph where each node is an LLM call or tool invocation, edges are conditional transitions, and state persists across the entire graph traversal.

## What We Extracted

### 1. Graph Checkpointing + Resume
LangGraph's checkpointer pattern — serializing the full graph state to persistent storage at each node so execution can resume from any point after a crash or interruption — was adopted as Monobrain's session checkpoint model. Sessions are saved with `hooks session-save` and restored via `session-restore`, allowing work to continue after context window limits or crashes.

### 2. StateGraph Workflow DSL
LangGraph's `StateGraph` with fan-out (parallel branches), fan-in (merge), conditional edges, and loop detection shaped Monobrain's `workflow create` command and the workflow execution engine. Monobrain workflows support the same structural patterns: parallel agent spawning (fan-out), result synthesis (fan-in), and conditional routing based on task outcomes.

### 3. Entity Extraction from Conversation State
LangGraph demonstrated that structured entities (people, places, decisions, artifacts) can be automatically extracted from conversation state and stored separately for cross-graph retrieval. Monobrain's closet-building in the Memory Palace (`buildClosets()`) mirrors this: proper nouns and action phrases are regex-extracted from every stored chunk and indexed for boosted retrieval.

## How It Improved Monobrain

Without LangGraph's influence, Monobrain's workflow system would have been a simple sequential task runner. The StateGraph model introduced the crucial concept of conditional branching — a failing test can route to a debugger agent, a passing test routes to the reviewer — making the swarm adaptive rather than rigid.

The checkpointing model also solved a practical problem: Claude Code sessions have finite context windows. By treating sessions as resumable graph executions, Monobrain can handle tasks that span multiple sessions without losing state.

## Key Files Influenced

- `packages/@monobrain/cli/src/commands/workflow/` — StateGraph-style workflow DSL
- `hook-handler.cjs` `session-restore` / `session-end` — checkpoint save/restore
- `.claude/helpers/memory-palace.cjs` `buildClosets()` — entity extraction
- `packages/@monobrain/cli/src/agents/halt-signal.ts` — loop termination signal

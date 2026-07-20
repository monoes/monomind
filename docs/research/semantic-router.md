# Semantic Router (aurelio-labs/semantic-router)

**Source:** https://github.com/aurelio-labs/semantic-router  
**Category:** LLM Routing Library  
**Role in Monomind:** Utterance-based RouteLayer, dynamic routes, hybrid routing mode

---

## What It Is

Semantic Router is a library that routes LLM inputs to the correct handler using semantic similarity rather than keyword matching or regex. Routes are defined by example utterances — "what would a user say if they wanted this?" — and inputs are matched by computing cosine similarity against the utterance embeddings.

> **Current-state correction (verified against source):** the design below describes `@monoes/routing`'s `RouteLayer` — a real implementation of this pattern that exists in the codebase, but is **opt-in only** (`route semantic`, `agent --task`, or MCP `hooks_route_semantic`). It is **not** what the `hook-handler.cjs` / `UserPromptSubmit` default routing path actually runs. That path calls `router.cjs`'s `routeTask()`, and `router.routeTaskSemantic` is a **literal alias for that same function** (`router.cjs:438-440`, `routeTaskSemantic: routeTask`) — despite the name, it performs the identical regex/`TASK_PATTERNS` + keyword-array matching as the non-"semantic" entry point, with `semanticRouting: false` on every return path. There is no embedding or utterance-similarity computation in the default hook path. Treat the sections below as "what RouteLayer does when you opt into it," not as a description of default routing behavior.

## What We Extracted

### 1. Utterance-Based `RouteLayer` Replacing Static Routing Codes
Before semantic-router's influence, Monomind used hard-coded keyword patterns (arrays of strings) to route tasks to agents. This worked for obvious cases but failed on paraphrases and novel phrasing. The utterance-based `RouteLayer` (`@monoes/routing`) replaced this with a model where each agent type is described by example utterances, and incoming tasks are matched by semantic similarity — **when explicitly invoked** via `route semantic`/`agent --task`/`hooks_route_semantic`.

The default `hook-handler.cjs` routing path does **not** call this. Its `routeTaskSemantic()` name is misleading — it's an alias for the same keyword/regex `routeTask()` used everywhere else in that file.

### 2. Dynamic Routes
Semantic Router supports routes that are defined at runtime rather than at startup — useful when new agents are discovered or loaded dynamically. Monomind's "extras" agent category uses this: when a task doesn't match any built-in route, the system dynamically loads the available extras agents and matches the task against their capability descriptions, returning the top-5 matches.

### 3. Hybrid Routing Mode (opt-in `RouteLayer` only)
Semantic Router's hybrid mode combines keyword pre-filtering with semantic matching — cheap keyword checks eliminate the clearly irrelevant routes before the more expensive embedding comparison runs. `@monoes/routing`'s `RouteLayer` mirrors this, when you opt into it:
1. **Keyword pre-filter**: Fast pattern match against known agent slugs
2. **Real embedding match**: cosine similarity against utterance embeddings, computed in an isolated worker process (kept out-of-process because loading `onnxruntime` in-process causes SIGSEGVs)
3. **LLM fallback**: Haiku-tier model call for cases below the similarity threshold

The **default** `hook-handler.cjs` path does not run any of these three tiers as described — it runs `router.cjs`'s own separate 4-tier keyword/regex waterfall instead (see `docs/concepts/hooks.md`).

## How It Improved Monomind (for the opt-in `RouteLayer` path)

For callers that explicitly opt into semantic routing, replacing static keyword arrays with utterance matching improves routing accuracy for complex, multi-step task descriptions — e.g. "analyze the codebase and identify security vulnerabilities in the auth module" routing to `security-auditor` instead of a naive keyword hit on "analyze" → `coder`. This benefit does **not** apply to the default `monomind route "task"` / `hook-handler.cjs` path, which stays keyword-only unless you explicitly request semantic routing.

## Key Files Influenced

- `hook-handler.cjs` route and pre-task handlers — call `routeTaskSemantic()`, which is an alias for the same keyword/regex `routeTask()` (not real semantic matching)
- `packages/@monomind/cli/src/routing/` — RouteLayer implementation
- `hook-handler.cjs` `list-extras` handler — dynamic extras route loading
- `.claude/helpers/statusline.cjs` — displaying routing result with confidence

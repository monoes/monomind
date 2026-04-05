# Semantic Router (aurelio-labs/semantic-router)

**Source:** https://github.com/aurelio-labs/semantic-router  
**Category:** LLM Routing Library  
**Role in Monobrain:** Utterance-based RouteLayer, dynamic routes, hybrid routing mode

---

## What It Is

Semantic Router is a library that routes LLM inputs to the correct handler using semantic similarity rather than keyword matching or regex. Routes are defined by example utterances — "what would a user say if they wanted this?" — and inputs are matched by computing cosine similarity against the utterance embeddings.

## What We Extracted

### 1. Utterance-Based `RouteLayer` Replacing Static Routing Codes
Before semantic-router's influence, Monobrain used hard-coded keyword patterns (arrays of strings) to route tasks to agents. This worked for obvious cases but failed on paraphrases and novel phrasing. The utterance-based `RouteLayer` replaced this with a model where each agent type is described by 10-20 example utterances, and incoming tasks are matched by semantic similarity.

The routing system in `hook-handler.cjs` now calls `router.routeTaskSemantic()` which runs this utterance-matching logic, emitting confidence scores and matched patterns alongside the routing decision.

### 2. Dynamic Routes
Semantic Router supports routes that are defined at runtime rather than at startup — useful when new agents are discovered or loaded dynamically. Monobrain's "extras" agent category uses this: when a task doesn't match any built-in route, the system dynamically loads the available extras agents and matches the task against their capability descriptions, returning the top-5 matches.

### 3. Hybrid Routing Mode
Semantic Router's hybrid mode combines keyword pre-filtering with semantic matching — cheap keyword checks eliminate the clearly irrelevant routes before the more expensive embedding comparison runs. Monobrain's three-tier routing mirrors this:
1. **Keyword pre-filter**: Fast pattern match against known agent slugs
2. **Semantic matching**: Utterance similarity for ambiguous inputs
3. **LLM fallback**: Haiku-tier model call for cases where semantic matching is uncertain

## How It Improved Monobrain

Replacing static keyword arrays with semantic utterance matching dramatically improved routing accuracy for complex, multi-step task descriptions. A task like "analyze the codebase and identify security vulnerabilities in the auth module" would previously route to `coder` (keyword: "analyze"). With semantic routing it correctly routes to `security-auditor` because the utterance pool for that agent includes similar descriptions.

## Key Files Influenced

- `hook-handler.cjs` route and pre-task handlers — `routeTaskSemantic()` call
- `packages/@monobrain/cli/src/router/` — RouteLayer implementation
- `hook-handler.cjs` `list-extras` handler — dynamic extras route loading
- `.claude/helpers/statusline.cjs` — displaying routing result with confidence

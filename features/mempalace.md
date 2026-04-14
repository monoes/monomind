# Memory Palace Integration

Monobrain integrates the memory architecture from [MemPalace](https://github.com/nokhodian/mempalace) — a spatially-organized, verbatim-retrieval memory system that achieves 96.6% recall on LongMemEval by storing raw content rather than summaries and retrieving via hybrid BM25 + vector search.

## How It Works

Memory is organized as a spatial hierarchy:

```
Wing → Room → Hall
```

- **Wing** — broad domain (`tasks`, `sessions`, `general`)
- **Room** — specific context within a wing (e.g. agent slug, project area)
- **Hall** — temporal sub-division (e.g. date `2026-04-14`)

Content is never summarized. Everything is stored verbatim in 800-character chunks with 100-character overlap (Drawers), so no information is lost to compression.

## Memory Stack

| Layer | Name | What it does | When |
|-------|------|-------------|------|
| **L0** | Identity | Loads `.monobrain/palace/identity.md` — static project context | Every session start |
| **L1** | Essential story | Top-scored recent Drawers → brief narrative injected into context | Every session start |
| **L2** | On-demand | `recall(wing, room)` — namespace-filtered Drawers sorted by score | Explicit call |
| **L3** | Deep search | `search(query)` — Okapi BM25 + closet-topic boost across all Drawers | Explicit call |

### Session Injection (L0 + L1)

On every `SessionStart`, the hook fires and outputs:

```
[MEMORY_PALACE_L0] Identity:
Project: monobrain (nokhodian/monobrain) ...

[MEMORY_PALACE_L1] Essential story (5 drawers):
[tasks/coder/2026-04-14] Implemented session-restore wiring ...
[tasks/coder/2026-04-13] Fixed BM25 scoring in search() ...
```

Claude Code sees this output as session context — no extra prompt injection needed.

## Storage Files

All palace files live under `.monobrain/palace/` (gitignored):

| File | Purpose |
|------|---------|
| `identity.md` | L0 identity — user-maintained, loaded verbatim |
| `drawers.jsonl` | Verbatim 800-char content chunks with Wing/Room/Hall metadata and access score |
| `closets.jsonl` | Regex-extracted topic pointers (headers, action phrases, proper nouns, quoted passages) |
| `kg.json` | Temporal knowledge graph — triples with `valid_from` / `valid_to` windows |

## Retrieval: Okapi BM25 + Closet Boost

`search()` runs Okapi BM25 (k₁=1.5, b=0.75) across all Drawer content, then applies a **+0.5 closet boost** per topic-index term that overlaps with the query. Retrieved Drawers have their score incremented so frequently-accessed content rises to L1 automatically.

```
final_score = bm25_score + Σ(0.5 × closet_term_matches)
```

The closet index is built with zero AI calls — pure regex:
- Section headers (`## Title`)
- Action phrases (`built X`, `fixed Y`, `implemented Z`)
- Consecutive Title Case proper nouns
- Quoted passages (3–60 characters)

## Score-Based Promotion to L1

Every Drawer starts at `score: 1.0`. Each time a Drawer is returned by `search()` or `recall()`, its score is incremented by 1.0 in `drawers.jsonl`. The L1 essential story is built from the **top-5 highest-scoring drawers from the last 30 days** — so content that is repeatedly relevant naturally surfaces at session start.

## Temporal Knowledge Graph

`kgAdd()` stores factual triples with explicit validity windows:

```javascript
kgAdd(cwd, 'memory-palace.cjs', 'implements', 'BM25 search', '2026-04-14', 1.0, 'source-id')
// → { subject, predicate, object, valid_from, valid_to: null, confidence, source_id }
```

- `kgQuery(cwd, entity, asOf)` — facts valid at a specific point in time
- `kgTimeline(cwd, entity)` — full chronological history of facts about an entity

Facts remain valid until explicitly closed (`valid_to` set), supporting both point-in-time and current-state queries.

## Hook Wire Points

The palace is wired into `hook-handler.cjs` at three hook events:

| Hook | Action | Effect |
|------|--------|--------|
| `SessionStart` (session-restore) | `palace.wakeUp(CWD)` | Injects L0 + L1 into session context |
| `post-task` | `palace.storeVerbatim(CWD, taskPrompt, { wing:'tasks', room:agentSlug })` | Files the task description as a Drawer |
| `session-end` | `palace.storeVerbatim(...)` + `palace.kgAdd(sessionId, 'ended_at', ...)` | Archives session closure in Drawers and KG |

## Seeding L0 Identity

Create or edit `.monobrain/palace/identity.md` to define the project identity that appears at every session start:

```markdown
Project: monobrain (nokhodian/monobrain)
Stack: Node.js/TypeScript monorepo, pnpm workspaces
Key packages: @monobrain/cli, @monobrain/graph, @monobrain/memory
Working style: concurrent tool calls, CJS helpers in .claude/helpers/
Git remote: git@github.com:nokhodian/monobrain.git, main branch
```

Keep it under ~300 characters — it is injected verbatim on every session start.

## Implementation

The entire memory palace is implemented in a single CJS file with no native dependencies:

```
.claude/helpers/memory-palace.cjs   (270 lines, pure Node.js built-ins only)
```

Exports: `wakeUp`, `storeVerbatim`, `buildClosets`, `search`, `recall`, `bm25`, `kgAdd`, `kgQuery`, `kgTimeline`

## Maintenance

`drawers.jsonl` grows over time. Prune entries older than 90 days when needed:

```bash
node -e "
const fs = require('fs');
const f = '.monobrain/palace/drawers.jsonl';
const cutoff = Date.now() - 90*24*60*60*1000;
const kept = fs.readFileSync(f,'utf-8').split('\n').filter(Boolean)
  .filter(l => { try { return new Date(JSON.parse(l).ts).getTime() > cutoff; } catch { return false; }});
fs.writeFileSync(f, kept.join('\n') + '\n');
console.log('kept', kept.length, 'drawers');
"
```

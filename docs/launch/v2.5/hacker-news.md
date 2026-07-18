# Hacker News — v2.5 Launch (Show HN)

> Updated from channels/hacker-news.md for the v2.5 launch (covers releases 2.3.0 → 2.5.1). Keeps the persistent-agent-orgs wedge; folds in what is genuinely new in v2.5. All claims grounded in docs/announcements/2026-07-18-v2.5-announcement.md and project docs.

## Lead Wedge (unchanged)

**Persistent agent orgs** remains the flagship claim — confirmed whitespace vs. Cursor/Windsurf/Devin/Cline/Aider/CrewAI/LangGraph/AutoGen. What's new in v2.5 strengthens the wedge rather than replacing it: the orgs now share a local-first memory (Second Brain), run on a rebuilt local engine, and can pause to ask a human. Single-wedge discipline holds — everything else is comment material.

## Show HN Copy (v2.5)

### Title (primary — fits HN's 80-char cap)

```
Show HN: Monomind – persistent agent orgs with local-first memory (v2.5)
```

(Boss decision 2026-07-19: the shorter title is primary unless analyst objects. Longer alternate, 93 chars incl. "Show HN: " (over the 80 cap), kept for reference only: `Show HN: Monomind v2.5 – persistent agent orgs with local-first shared memory, on Claude Code`)

### Body (first paragraph is the whole pitch — no copy follows it)

```
Monomind runs agent orgs as daemon-controlled processes that persist across sessions — a
coordinator, researcher, coder, etc. keep their state and role history whether or not you've
closed the terminal, and can run on a schedule instead of only when you're typing. New in
v2.5: the whole org can query a shared local-first memory ("Second Brain") that spans your
projects; we rebuilt the memory engine on local SQLite + local MiniLM embeddings (dropping
LanceDB and ~600MB of native deps), with a paraphrase golden-set eval in CI; and agents can
pause mid-run to ask a human a question and wait for the answer. Everything runs locally —
no cloud memory service. Open source: github.com/monoes/monomind
```

## Comment Handling Strategy

### Tone (unchanged — this matters more than the post)

- Honest framing including limitations: **hive-mind consensus is experimental — single-process vote counting, not distributed consensus.** Say so unprompted if consensus comes up.
- No marketing adjectives. Answer technical questions with specifics (file paths, architecture decisions, trade-offs). Acknowledge what competitors do better.

### v2.5-specific talking points (new)

1. **"Why did you drop LanceDB?"** — ~600MB of native dependencies for no measured value in a single-user local tool. Replaced with local SQLite (better-sqlite3, sql.js WASM fallback) + local MiniLM embeddings. The rewrite also fixed real bugs: empty semantic-search results, keyword search that only matched exact phrases, and namespace leaks.
2. **"How do you know retrieval quality didn't regress?"** — A paraphrase golden-set evaluation now runs in CI to keep retrieval honest. This is a strong HN answer: evals over vibes.
3. **"Did you test this beyond unit tests?"** — We ran a 49-agent adversarial review against the swarm and memory stack and fixed all 33 findings it produced — including a critical `cleanup --data` rule that would have deleted live memory stores, and a window where org messages could be silently lost during session restarts. Lead with the findings we fixed, not the review's cleverness — HN respects disclosed bugs.
4. **"What is the Second Brain exactly?"** — Local-first cross-project memory with heading-aware chunking (`§` section prefixes show exactly which section a hit came from). Sessions could already query it; v2.5 makes it available to entire agent orgs.
5. **"Human in the loop?"** — Any role in a running org can ask a human a free-form question and pause until answered (`monomind org questions` / `monomind org answer`). Orgs are unattended-capable but not human-free.
6. **"Is this just CrewAI/AutoGen?"** — Those are frameworks you script per run; this is a daemon that owns the org lifecycle: `org run/stop/status/serve/logs/report`, a real scheduler, and per-agent policy (file scopes, web allowlists, token budgets) enforced at the tool-call layer.

### Carried-over talking points (still valid)

- Knowledge-graph grounding vs embedding-only RAG ("embeddings find similar code, graphs find dependent code") — comments only.
- 3-wave framing: autocomplete → autonomous single agent → orchestrated agent teams with guardrails.
- Open-source/local control as trust close, not hook.

## Timing

- **Launch date: Tuesday, July 21, 2026, 8–9am ET — LOCKED (boss, 2026-07-19).** Blog/announcement goes live that AM ahead of HN, per existing playbook.
- Author present answering every comment for the first 4 hours minimum.
- Announcement/blog live before the HN post so it can be the landing page.

## Status

- Title: FINAL (≤80-char version primary, per boss; analyst may veto)
- Body: DRAFT-FINAL — pending analyst fact-check
- Comment strategy: UPDATED for v2.5
- Launch date: LOCKED — Tue Jul 21, 2026, 8–9am ET

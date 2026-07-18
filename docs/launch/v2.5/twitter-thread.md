# X Thread — Monomind v2.5 Launch: "The Second Brain Grows Up"

**Wedge:** v2.5 release narrative, led by Second Brain (local-first memory). One claim per post.
**Format:** 8 posts. Opener hook → one claim each → CTA + repo link in final post.
**Grounding:** All claims from docs/announcements/2026-07-18-v2.5-announcement.md + README (org command surface, experimental labels). No claims from design specs.

---

**Post 1 (opener):**
We just deleted ~600MB of native dependencies from our memory engine — and it got *better*. Monomind v2.5 is out. The Second Brain grew up. Here's what changed across 2.3.0 → 2.5.1. 🧵

**Post 2 (arc 1 — Second Brain everywhere):**
The Second Brain is local-first memory that follows you across projects. Your notes, handbooks, and docs get indexed on your machine — and every session can query them. No cloud, no upload, no "sync your knowledge base to our servers."

**Post 3 (arc 1 — chunking):**
Retrieval you can actually trust starts with knowing *where* a hit came from. v2.3.2 added heading-aware chunking with § section prefixes — every search result tells you exactly which section of which doc it's quoting. No more mystery snippets.

**Post 4 (arc 1 → arc 3 bridge):**
New in this wave: the Second Brain isn't just for your sessions anymore. Entire agent orgs can query it. A content agent grounds its claims in your actual docs. A researcher checks your past decisions before redoing work. Shared knowledge, every lookup audited.

**Post 5 (arc 2 — leaner engine):**
The rebuild: LanceDB is gone. In its place — local SQLite (better-sqlite3, with a sql.js WASM fallback) + local MiniLM embeddings. Same semantic search, ~600MB lighter, no native-compilation roulette on install. And it fixed real bugs: empty semantic results, exact-phrase-only keyword search, namespace leaks.

**Post 6 (arc 2 — hardening):**
Then we attacked it. A 49-agent adversarial review ran against the swarm + memory stack. It produced 33 findings. We fixed all 33 — including a cleanup rule that could have deleted live memory stores, and a window where org messages could be silently lost on restart. A paraphrase golden-set eval now runs in CI so retrieval quality can't quietly regress.

**Post 7 (arc 3 — Org Runtime v2):**
Org Runtime v2 got the boring-but-critical tooling for running unattended: daemon-controlled orgs with a real CLI surface — run, stop, status, serve, logs, report — plus human-in-the-loop: an agent can pause, ask you a question (`org questions` / `org answer`), and continue with your answer. Consensus features are still labeled experimental — we'd rather say so than pretend.

**Post 8 (CTA):**
Local-first memory. A leaner engine that survived its own red team. Orgs that run unattended but know when to ask a human.

npx monomind@latest init

⭐ github.com/monoes/monomind

---

## Notes for scheduling
- Post as one thread, 9–11am ET weekday (per x-twitter.md cadence).
- No image dependency required; optional: designer Template A code-block of a `§`-prefixed knowledge_search result for Post 3.
- Hashtags: skip in-thread (voice discipline); if quoting for reach: #opensource #devtools #ai

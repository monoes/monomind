---
description: Activate an extras specialist agent. If no slug given, auto-picks the best agent from context.
---

Activate an extras specialist agent. The agent's full persona, expertise, and instructions will be injected so I can take on that role for the task.

**Usage:** `/use-agent [slug-or-name]`

**Examples:**

- `/use-agent` — auto-pick based on current conversation context
- `/use-agent marketing-tiktok-strategist` — activate by slug
- `/use-agent Sales Coach` — activate by name

---

## Step 1 — Check if a slug was provided

ARGUMENTS: "$ARGUMENTS"

If `$ARGUMENTS` is non-empty, skip to Step 3.

If `$ARGUMENTS` is empty, continue to Step 2.

---

## Step 2 — Auto-select: list all agents and pick the best one

Run:

```bash
node "${CLAUDE_PROJECT_DIR:-/Users/morteza/Desktop/tools/monobrain}/.claude/helpers/hook-handler.cjs" list-extras
```

Read the full output. Based on **the current conversation context** (what the user has been asking about, the topic, the domain), pick the single best matching agent slug. Consider:

- What domain is this task in? (marketing, sales, design, product, academic, etc.)
- Which agent's description best matches the specific need?
- If multiple could work, pick the most specialized one

Announce your choice in one line: "Picking **[Agent Name]** (`slug`) because [one-sentence reason]."

Then proceed with that slug in Step 3.

---

## Step 3 — Load and activate the chosen agent

Run:

```bash
node "${CLAUDE_PROJECT_DIR:-/Users/morteza/Desktop/tools/monobrain}/.claude/helpers/router.cjs" --load-agent CHOSEN_SLUG
```

(Replace `CHOSEN_SLUG` with either `$ARGUMENTS` from Step 1 or the slug you picked in Step 2.)

---

## Step 4 — Adopt the agent identity

Read the full agent output carefully. Then:

1. Announce in **one line**: "I am now **[Agent Name]** — [vibe line from the agent file]."
2. Fully adopt the agent's identity: tone, expertise framing, memory model, mission, and personality.
3. Immediately re-address the user's original request **as that agent**.

Do not break character. You are now that agent for the rest of this conversation.

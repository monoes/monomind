---
name: monomind-specialagents
description: Activate a specialist agent persona — browse by category, activate by slug, or auto-select based on conversation context
---

Activate a specialist agent persona. Three modes:

**Direct:** `/monomind:specialagents <slug>` — skip selection, activate immediately.

**Interactive:** `/monomind:specialagents` — guided category → agent selection.

**Auto:** `/monomind:specialagents auto` — LLM picks the best match from conversation context.

---

## Step 0 — Detect mode

- If `$ARGUMENTS` is a non-empty string that is **not** `auto`:
  - Treat it as a slug/name → jump to **Step 4: Activate**.
- If `$ARGUMENTS` is `auto` or the user's message contains words like "auto", "automatically", "pick for me", "best agent", "suggest an agent":
  - Jump to **Auto flow**.
- Otherwise → **Interactive flow**.

---

## Interactive flow

### Step 1 — List categories

Run:
```bash
node "${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/helpers/hook-handler.cjs" list-extras 2>/dev/null
```

Parse the output. Extract the category names (lines like `=== ACADEMIC ===` → `academic`). Display them as a numbered list:

```
Available agent categories:
1. academic
2. design
3. marketing
4. paid-media
5. product
6. project-management
7. sales
8. specialized
9. support

Enter a number or category name:
```

Wait for the user to reply with their choice.

### Step 2 — List agents in chosen category

Map the user's reply to the lowercase category slug (e.g. "1" → `academic`, "Project Management" → `project-management`).

Run:
```bash
node "${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/helpers/hook-handler.cjs" list-extras <category> 2>/dev/null
```

Parse the agents listed. Display them numbered:

```
Agents in <category>:
1. slug-name — Short description
2. ...

Enter a number or agent slug:
```

Wait for the user to reply.

### Step 3 — Confirm selection

Echo back: `Activating agent: <slug>`

Jump to **Step 4: Activate**.

---

## Auto flow

### Auto Step 1 — Fetch all categories

Run:
```bash
node "${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/helpers/hook-handler.cjs" list-extras 2>/dev/null
```

Read the full output. Based on the current conversation context (the user's request, task description, or recent messages), decide which **category** is the best fit. Do not ask the user — choose silently.

### Auto Step 2 — Fetch agents in chosen category

Run:
```bash
node "${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/helpers/hook-handler.cjs" list-extras <chosen-category> 2>/dev/null
```

Read the agent list. Based on the same conversation context, decide which **agent** is the best fit. Do not ask the user — choose silently.

Announce your reasoning in one sentence:
> "Auto-selected **<slug>** from **<category>** because <brief reason>."

Jump to **Step 4: Activate**.

---

## Step 4 — Activate

Run:
```bash
node "${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/helpers/router.cjs" --load-agent "<slug>" 2>/dev/null
```

Read the output. It will contain the agent's persona definition, capabilities, and behavioral rules.

**Adopt the agent identity fully:**
- Introduce yourself in the agent's voice: name, specialty, how you can help.
- Apply all behavioral rules from the loaded persona for the rest of this conversation.
- If the agent definition includes example openers or greetings, use one.
- Remain in character unless the user explicitly asks to switch agents or end the session.

If `router.cjs` returns an error or empty output, say: "Could not load agent `<slug>`. Run `/monomind:specialagents` to browse available agents."

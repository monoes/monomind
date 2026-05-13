---
name: mastermind-createorg
description: Define and save an autonomous agent organization — roles, hierarchy, and communication topology. Suggest or confirm roles, then persist the org for use with runorg.
---

**If $ARGUMENTS is empty:** Output the following and wait.

---

**MASTERMIND: CREATE ORG**

An org is a named, persistent agent team — not a one-shot Mastermind run. Once created, the org runs autonomously across sessions: a boss agent coordinates specialists who pick up tasks from a shared board, execute them, and loop until stopped.

Use orgs when the work is ongoing, not single-shot. A content team that ships 10 posts a month. A research squad that runs competitive scans weekly. A dev team with a permanent backlog.

**What you provide:**
- A goal — what should this org continuously accomplish?
- Optional roles — or let Mastermind suggest them from the goal

**Examples:**

```
/mastermind:createorg A content team that publishes 3 blog posts per week — writer, editor, SEO reviewer, publisher

/mastermind:createorg --name research-pod Weekly competitor intelligence: researcher, analyst, summarizer

/mastermind:createorg --auto An engineering team for ongoing feature development on my SaaS product
```

**Options:**
`--name <slug>` — org identifier used with `/mastermind:runorg` (derived from goal if omitted)
`--roles <list>` — explicit role list (e.g. "boss, writer, reviewer, marketer")
`--auto` — skip confirmation, create immediately
`--confirm` — always ask before saving (default)

Once created, start the org with `/mastermind:runorg --org <name>`.

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto (no confirmation prompt)
- `--confirm` flag → mode = confirm
- `--name <name>` → org_name = <name> (must match `^[a-z0-9][a-z0-9-]{0,63}$`; if omitted, derived from goal)
- `--roles <desc>` → roles_desc = <desc> (explicit role list, e.g. "boss, writer, reviewer, marketer")
- Remaining text = prompt (goal description)

If neither `--auto` nor `--confirm` was provided, default: **mode = confirm**.

If prompt is empty: ask "Describe your org's goal and optionally list the roles you want (e.g. 'a content team with a boss, writer, reviewer, and marketer to produce 10 blog posts per month')."

Load brain context for the `ops` domain (follow _protocol.md Brain Load Procedure, namespace: `ops`).

Generate a session ID as a real shell variable:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
session_id="mm-$(date -u +%Y%m%dT%H%M%S)"
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
```

Emit `session:start` to dashboard:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg prompt "$prompt" \
    --arg mode "$mode" \
    --arg proj "$(pwd)" \
    '{type:"session:start",session:$session,domain:"ops",prompt:$prompt,mode:$mode,project:$proj,ts:(now*1000|floor)}')" || true
```

Emit `domain:dispatch`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    '{type:"domain:dispatch",session:$session,domain:"ops",cmd:"Designing and saving org definition",ts:(now*1000|floor)}')" || true
```

Invoke `Skill("mastermind:createorg")` passing: brain_context, prompt, org_name, roles_desc, mode, session_id: `$session_id`, caller: "command".

After skill returns: note the status (`complete`, `partial`, or `blocked`). Emit `session:complete`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg status "<status>" \
    '{type:"session:complete",session:$session,domain:"ops",status:$status,domains:["ops"],ts:(now*1000|floor)}')" || true
```

Follow _protocol.md Brain Write Procedure for domain `ops`.

<!-- Define and save an autonomous agent organization (Org Runtime v2) — roles and hierarchy. Suggest or confirm roles, then persist the org config for `monomind org run`/`serve`. -->

**If $ARGUMENTS is empty:** Output the following and wait.

---

**MASTERMIND: CREATE ORG**

An org is a named, persistent agent team, run by the Org Runtime v2 daemon — not a one-shot Mastermind run and not a Task-tool-spawned boss. Once created, every role in the config starts as its own live agent session the moment you run the org; roles message each other directly (no shared task board) and the org keeps running until stopped.

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
`--name <slug>` — org identifier used with `monomind org run <name>` (derived from goal if omitted)
`--roles <list>` — explicit role list (e.g. "boss, writer, reviewer, marketer")
`--schedule <interval>` — daemon schedule for `monomind org serve` to pick up, e.g. `"30m"`, `"2h"`, `"1440m"` for daily (omit for a manual, one-shot org)
`--auto` — skip confirmation, create immediately
`--confirm` — always ask before saving (default)
`--delete <name>` — delete a saved org and all associated data files (`monomind org delete <name> --yes`)
`--list` — list all saved orgs with their status (`monomind org list`)

Once created, start the org with `monomind org run <name>` (foreground, one-shot) or let `monomind org serve` pick it up if `--schedule` was set. Check status with `monomind org status <name>`; stop with `monomind org stop <name>`.

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto (no confirmation prompt)
- `--confirm` flag → mode = confirm
- `--name <name>` → org_name = <name> (must match `^[a-z0-9][a-z0-9-]{0,63}$`; if omitted, derived from goal)
- `--roles <desc>` → roles_desc = <desc> (explicit role list, e.g. "boss, writer, reviewer, marketer")
- `--schedule <interval>` → schedule = <interval>, daemon format only: `"<N>s"`, `"<N>m"`, or `"<N>h"` (e.g. `"30m"`, `"2h"`) — this is passed straight into `parseSchedule()` in `orgrt/scheduler.ts`, whose regex `^(\d+)\s*(s|m|h)$` rejects anything else (e.g. `"every 30 minutes"`, `"daily"`) and silently leaves the org unscheduled
- `--delete <name>` → delete_mode = true, delete_name = <name>
- `--list` flag → list_mode = true
- Remaining text = prompt (goal description)

**If `--list` flag is set:**
```bash
# org list knows how to skip artifact side-car files (-state/-goals/…) and
# shows role count, schedule, and runtime status per org
npx -y monomind@latest org list || {
  # fallback for environments without the CLI: config files only
  orgs_dir=".monomind/orgs"
  if [ ! -d "$orgs_dir" ] || [ -z "$(ls "$orgs_dir"/*.json 2>/dev/null)" ]; then
    echo "No saved orgs. Run /mastermind:createorg <goal> to create one."
  else
    echo "Saved orgs:"
    ls "$orgs_dir"/*.json | grep -vE -- '-(state|goals|threads|activity|approvals|members|secrets|budgets|routines|issues|projects|workspaces|worktrees|environments|plugins|adapters|join-requests|bootstrap|project-workspaces|approval-comments|skills)\.json$' \
      | while IFS= read -r f; do
          echo "  • $(basename "$f" .json) — $(jq -r '.goal // ""' "$f" 2>/dev/null | cut -c1-60)"
        done
  fi
}
```
Stop after listing. Do not proceed to skill invocation.

**If `--delete <name>` is set:**
1. Confirm the org exists:
   ```bash
   [ -f ".monomind/orgs/${delete_name}.json" ] || { echo "Org '${delete_name}' not found."; exit 1; }
   ```
2. In confirm mode (default): ask "Delete org '${delete_name}' and all its data? This cannot be undone. Type 'yes' to confirm."
   In auto mode: proceed without asking.
3. Delete via the CLI (it refuses to delete a running org unless --force, and
   removes every artifact side-car file); fall back to the dashboard server's
   DELETE endpoint only if the CLI is unavailable:
   ```bash
   npx -y monomind@latest org delete "${delete_name}" --yes || {
     REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
     CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
     result=$(curl -s -X DELETE -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" "${CTRL_URL}/api/orgs/${delete_name}")
     echo "$result" | jq -r 'if .ok then "Org '\'''"${delete_name}"'''\'' deleted." else "Error: " + (.error // "unknown") end'
   }
   ```
4. Stop after deleting. Do not proceed to skill invocation.

If neither `--auto` nor `--confirm` was provided, default: **mode = confirm**.

If prompt is empty (and not list/delete mode): ask "Describe your org's goal and optionally list the roles you want (e.g. 'a content team with a boss, writer, reviewer, and marketer to produce 10 blog posts per month')."

Load brain context for the `ops` domain (follow mastermind-protocol/SKILL.md Brain Load Procedure, namespace: `ops`).

Generate a session ID as a real shell variable:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
session_id="mm-$(date -u +%Y%m%dT%H%M%S)"
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
```

Emit `session:start` to dashboard:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg prompt "$prompt" \
    --arg mode "$mode" \
    --arg proj "$REPO_ROOT" \
    '{type:"session:start",session:$session,domain:"ops",prompt:$prompt,mode:$mode,project:$proj,ts:(now*1000|floor)}')" || true
```

Emit `domain:dispatch`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    '{type:"domain:dispatch",session:$session,domain:"ops",cmd:"Designing and saving org definition",ts:(now*1000|floor)}')" || true
```

Invoke `Skill("mastermind-createorg")` passing: brain_context, prompt, org_name, roles_desc, schedule, mode, session_id: `$session_id`, caller: "command".

After skill returns: note the status (`complete`, `partial`, or `blocked`). Emit `session:complete`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg status "<status>" \
    '{type:"session:complete",session:$session,domain:"ops",status:$status,domains:["ops"],ts:(now*1000|floor)}')" || true
```

Follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.


Invoke `Skill("mastermind-repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.

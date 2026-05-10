---
name: mastermind-architect
description: Mastermind architect domain — architecture review, file structure deduplication, coupling analysis, design pattern audit, DDD mapping, and system design. Default mode: confirm.
---

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm (default)
- `--project <name>` → project_name = <name> (if omitted, default to `basename "$PWD"`)
- `--scope <scope>` → scope = review | design | deduplicate | migrate | all (default: infer from prompt using these keyword rules: "review"/"audit"/"check"/"assess" → review; "deduplicate"/"dedup"/"consolidate" → deduplicate; "design"/"architect"/"model"/"bounded context" → design; "migrate"/"migration"/"port to"/"convert" → migrate; no keyword match → all; if more than one scope keyword matches, use `all`)
- `--stack <stack>` → stack hint (e.g. typescript, python, react, go) — auto-detected if omitted
- `--iterate <N>` → iterate = N (integer ≥ 1; default 0 = no iteration) — run N autonomous fix+review cycles after the initial architect pass
- Remaining text = prompt

If prompt is empty: ask "What would you like the architect to do? (e.g. 'review the codebase structure', 'deduplicate files', 'design the API layer', 'map bounded contexts')"

Load brain context for the `architect` domain (follow _protocol.md Brain Load Procedure).

Run intake if prompt is vague (follow _intake.md — stop at Q3, domain is already known as `architect`).

Default mode for this command: **confirm** (show architecture plan before executing, unless `--auto` flag present).

Generate a session ID: take the current UTC datetime formatted as `YYYYMMDDTHHmmss` and prefix with `mm-` (e.g. `mm-20260506T142345`)

Emit `session:start` before invoking the skill using WebFetch (handles prompt encoding safely for any characters):
```javascript
WebFetch({
  url: "http://localhost:4242/api/mastermind/event",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "session:start", session: sessionId, domain: "architect", prompt: prompt, ts: Date.now() })
})
```

Emit `domain:dispatch` immediately after session:start. Before executing the curl below, substitute the generated sessionId for `<sessionId>`:
```bash
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d '{"type":"domain:dispatch","session":"<sessionId>","domain":"architect","ts":'"$(date +%s)"'000}' || true
```

Invoke `Skill("mastermind:architect")` passing: brain_context, prompt, project_name, board_id (create board named "architect" inside the project_name monotask space if not already present), mode, scope, stack, sessionId, iterate, caller: "command".

After skill returns: note the status from the skill's output (`complete`, `partial`, or `blocked`). Emit `session:complete` using that status, then follow _protocol.md Brain Write Procedure for domain `architect`. Before executing the curl below, substitute the generated sessionId for `<sessionId>` and the skill's actual status for `<status>`:
```bash
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d '{"type":"session:complete","session":"<sessionId>","domain":"architect","status":"<status>","domains":["architect"],"ts":'"$(date +%s)"'000}' || true
```

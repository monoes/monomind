---
name: mastermind-threads
description: Mastermind threads — list, view, and create conversation threads within an org. Threads are human-or-agent discussions attached to issues, goals, or the org itself. Reads from -threads.jsonl org state files.
type: domain-skill
default_mode: auto
---

# Mastermind Threads

This skill is invoked by `mastermind:threads` or directly via `/mastermind:threads`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to query (required)
- `action`: list | view | create | reply
- `thread_id`: thread ID (required for view/reply)
- `issue_id`: filter by issue ID (optional)
- `message`: message body (required for create/reply)
- `author`: author name or agent ID (default: current user)
- `limit`: max threads to show (default: 20)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Threads File

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

threadsFile=".monomind/orgs/${org_name}-threads.jsonl"
limit="${limit:-20}"
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "THREADS — $org_name"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$threadsFile" ] || [ ! -s "$threadsFile" ]; then
  echo "  No threads found."
  echo ""
  echo "  Create: /mastermind:threads --org $org_name --action create --message 'Hello team'"
  exit 0
fi

python3 - "$threadsFile" "${issue_id:-}" "$limit" <<'PYEOF'
import json, sys

path       = sys.argv[1]
issue_f    = sys.argv[2]
limit      = int(sys.argv[3])

threads = []
with open(path) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            t = json.loads(line)
            if t.get("type","thread") == "thread":
                threads.append(t)
        except: pass

if issue_f:
    threads = [t for t in threads if t.get("issueId") == issue_f]

threads = threads[-limit:]

if not threads:
    print(f"  (no threads{'  filtered by issue=' + issue_f if issue_f else ''})")
else:
    print(f"  {'ID':<28} {'SUBJECT':<32} {'AUTHOR':<20} {'MSGS':<6} CREATED")
    print("  " + "─" * 96)
    for t in threads:
        tid     = t.get("id","?")[:28]
        subj    = (t.get("subject") or "(no subject)")[:32]
        author  = (t.get("authorName") or t.get("authorId") or "—")[:20]
        msgs    = len(t.get("messages", []))
        created = (t.get("createdAt") or "-")[:10]
        print(f"  {tid:<28} {subj:<32} {author:<20} {msgs:<6} {created}")

print(f"\n  {len(threads)} thread(s). View: /mastermind:threads --org <org> --action view --thread-id <id>")
PYEOF
```

### view

```bash
[ -z "$thread_id" ] && { echo "ERROR: --thread-id required."; exit 1; }

if [ ! -f "$threadsFile" ]; then
  echo "No threads found for org '$org_name'."
  exit 0
fi

python3 - "$threadsFile" "$thread_id" <<'PYEOF'
import json, sys

path, tid = sys.argv[1], sys.argv[2]

thread = None
with open(path) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            t = json.loads(line)
            if t.get("id") == tid and t.get("type","thread") == "thread":
                thread = t
        except: pass

if not thread:
    print(f"ERROR: Thread '{tid}' not found.")
    sys.exit(1)

subj   = thread.get("subject","(no subject)")
issue  = thread.get("issueId","")
created = thread.get("createdAt","-")

print(f"THREAD: {subj}")
print(f"  ID:       {tid}")
if issue: print(f"  Issue:    {issue}")
print(f"  Created:  {created}")
print()
print("MESSAGES")
print("────────────────────────────────────────────────────────")

msgs = thread.get("messages", [])
if not msgs:
    print("  (no messages)")
else:
    for m in msgs:
        author = m.get("authorName") or m.get("authorId") or "?"
        ts     = (m.get("createdAt") or "?")[:16].replace("T"," ")
        body   = m.get("body","")
        print(f"  [{ts}] {author}:")
        for line in body.split("\n"):
            print(f"    {line}")
        print()
PYEOF
```

### create

```bash
[ -z "$message" ] && { echo "ERROR: --message required."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
newId="thread-$(python3 -c 'import time; print(int(time.time()*1000))')"
authorVal="${author:-operator}"

python3 - "$threadsFile" "$newId" "${title:-}" "$message" "$authorVal" "${issue_id:-}" "$ts" <<'PYEOF'
import json, sys

path, tid, subj, body, author, issue, ts = sys.argv[1:]
thread = {
    "id": tid,
    "type": "thread",
    "subject": subj or "(no subject)",
    "issueId": issue or None,
    "authorId": author,
    "authorName": author,
    "createdAt": ts,
    "messages": [{
        "id": f"msg-{tid}",
        "authorId": author,
        "authorName": author,
        "body": body,
        "createdAt": ts,
    }]
}
with open(path, "a") as f:
    f.write(json.dumps(thread) + "\n")
print(f"  Created thread: {tid}")
print(f"  Subject: {subj or '(no subject)'}")
print(f"  Message: {body[:80]}{'...' if len(body) > 80 else ''}")
PYEOF
```

### reply

```bash
[ -z "$thread_id" ] && { echo "ERROR: --thread-id required."; exit 1; }
[ -z "$message" ] && { echo "ERROR: --message required."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
authorVal="${author:-operator}"

# Read all threads, append message to matching thread, rewrite file
python3 - "$threadsFile" "$thread_id" "$message" "$authorVal" "$ts" <<'PYEOF'
import json, sys

path, tid, body, author, ts = sys.argv[1:]
threads = []
found = False
with open(path) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            t = json.loads(line)
            if t.get("id") == tid:
                msg_id = f"msg-{tid}-{len(t.get('messages',[]))}"
                t.setdefault("messages",[]).append({
                    "id": msg_id,
                    "authorId": author,
                    "authorName": author,
                    "body": body,
                    "createdAt": ts,
                })
                found = True
            threads.append(t)
        except: pass

if not found:
    print(f"ERROR: Thread '{tid}' not found.")
    sys.exit(1)

with open(path, "w") as f:
    for t in threads:
        f.write(json.dumps(t) + "\n")

print(f"  Reply added to thread: {tid}")
print(f"  Author: {author}  |  {ts}")
PYEOF
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
thread_id: <thread_id or new_id>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

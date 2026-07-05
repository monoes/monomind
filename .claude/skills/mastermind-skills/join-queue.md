---
name: mastermind-join-queue
description: Mastermind join-queue — lists pending join requests for an org, approves or rejects them, and filters by request type (human/agent/all) and status. Mirrors JoinRequestQueue.tsx.
type: domain-skill
default_mode: auto
---

# Mastermind Join Queue

This skill is invoked by `mastermind:join-queue` or directly via `/mastermind:join-queue`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage join requests for (required)
- `action`: list | approve | reject
- `request_id`: join request ID (required for approve/reject)
- `status`: pending_approval | approved | rejected (filter; default: pending_approval)
- `request_type`: all | human | agent (filter; default: all)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

joinFile=".monomind/orgs/${org_name}-join-requests.json"
```

---

## Step 2 — Execute Action

### list (default)

```bash
statusFilter="${status:-pending_approval}"
typeFilter="${request_type:-all}"

echo "JOIN REQUESTS — $org_name  (status: $statusFilter  type: $typeFilter)"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$joinFile" ]; then
  echo "  No join requests found."
  echo ""
  echo "  Approve: /mastermind:join-queue --org $org_name --action approve --request-id <id>"
  exit 0
fi

python3 - "$joinFile" "$statusFilter" "$typeFilter" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
status_f = sys.argv[2]
type_f   = sys.argv[3]

requests = data.get("requests", [])
filtered = [r for r in requests
  if r.get("status") == status_f
  and (type_f == "all" or r.get("type") == type_f)]

if not filtered:
  print("  (no matching requests)")
else:
  print(f"  {'ID':<32} {'TYPE':<8} {'REQUESTER':<28} {'STATUS':<20} {'CREATED'}")
  print("  " + "─" * 102)
  for r in filtered:
    rid     = r.get("id","?")[:32]
    rtype   = r.get("type","?")[:8]
    req     = (r.get("requesterName") or r.get("requesterId","?"))[:28]
    st      = r.get("status","?")[:20]
    created = r.get("createdAt","-")[:10]
    print(f"  {rid:<32} {rtype:<8} {req:<28} {st:<20} {created}")

print(f"\n  Total: {len(filtered)} request(s) (status={status_f}, type={type_f})")
PYEOF

echo ""
echo "  Approve: /mastermind:join-queue --org $org_name --action approve --request-id <id>"
echo "  Reject:  /mastermind:join-queue --org $org_name --action reject  --request-id <id>"
```

### approve

```bash
[ -z "$request_id" ] && { echo "ERROR: --request-id required."; exit 1; }
[ ! -f "$joinFile" ] && { echo "ERROR: No join requests file found for org '${org_name}'."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$joinFile" "$request_id" "$ts" <<'PYEOF'
import json, sys
path, rid, ts = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path))
requests = data.get("requests", [])
found = False
for r in requests:
    if r.get("id") == rid:
        r["status"] = "approved"
        r["resolvedAt"] = ts
        found = True
        break
if not found:
    print(f"ERROR: Request '{rid}' not found.")
    sys.exit(1)
data["requests"] = requests
with open(path, "w") as f:
    json.dump(data, f, indent=2)
print(f"  Approved: {rid}  (resolvedAt: {ts})")
PYEOF
```

### reject

```bash
[ -z "$request_id" ] && { echo "ERROR: --request-id required."; exit 1; }
[ ! -f "$joinFile" ] && { echo "ERROR: No join requests file found for org '${org_name}'."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$joinFile" "$request_id" "$ts" <<'PYEOF'
import json, sys
path, rid, ts = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path))
requests = data.get("requests", [])
found = False
for r in requests:
    if r.get("id") == rid:
        r["status"] = "rejected"
        r["resolvedAt"] = ts
        found = True
        break
if not found:
    print(f"ERROR: Request '{rid}' not found.")
    sys.exit(1)
data["requests"] = requests
with open(path, "w") as f:
    json.dump(data, f, indent=2)
print(f"  Rejected: {rid}  (resolvedAt: {ts})")
PYEOF
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
status_filter: <status>
type_filter: <request_type>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

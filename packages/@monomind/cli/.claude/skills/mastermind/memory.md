---
name: mastermind-memory
description: Mastermind memory — org-scoped persistent memory using PARA method (Projects, Areas, Resources, Archives). Ingest facts, recall context, maintain knowledge graph, run weekly synthesis. Reads from .monomind/orgs/<org>-memory/ directory. Port of Paperclip's para-memory-files skill for org-level context.
type: domain-skill
default_mode: auto
---

# Mastermind Memory

This skill is invoked by `mastermind:memory` or directly via `/mastermind:memory`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org whose memory to operate on (required)
- `action`: ingest | recall | query | update | forget | synthesize | decay | list
- `topic`: topic or entity name (required for ingest/recall/update/forget)
- `layer`: knowledge | daily | tacit (default: knowledge)
- `category`: projects | areas | resources | archives (for layer=knowledge; default: resources)
- `content`: fact or note body (required for ingest/update)
- `caller`: command | master

---

## Memory Architecture (PARA)

Three layers, mirrored to `.monomind/orgs/<org_name>-memory/`:

```
.monomind/orgs/<org>-memory/
  knowledge/              ← Layer 1: PARA knowledge graph
    projects/<topic>/
      summary.md
      items.yaml
    areas/<topic>/
      summary.md
      items.yaml
    resources/<topic>/
      summary.md
      items.yaml
    archives/<topic>/
      summary.md
      items.yaml
    index.md
  daily/                  ← Layer 2: Raw timeline (YYYY-MM-DD.md)
  tacit.md                ← Layer 3: Org operating patterns
```

**PARA rules:**
- **projects** — active work with a goal/deadline; archive when complete
- **areas** — ongoing responsibilities, no end date
- **resources** — reference material, topics of interest
- **archives** — inactive items from any category

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Memory Root

```bash
memRoot=".monomind/orgs/${org_name}-memory"
mkdir -p "$memRoot/knowledge/projects" "$memRoot/knowledge/areas" \
         "$memRoot/knowledge/resources" "$memRoot/knowledge/archives" \
         "$memRoot/daily"
```

---

## Step 2 — Execute Action

### ingest (default for new facts)

Store a durable fact in Layer 1 (knowledge graph) or Layer 2 (daily note).

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
day=$(date -u +%Y-%m-%d)
layer="${layer:-knowledge}"
category="${category:-resources}"
topicSlug=$(echo "${topic:-general}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')

if [ "$layer" = "daily" ]; then
  dailyFile="$memRoot/daily/${day}.md"
  [ ! -f "$dailyFile" ] && echo "# Daily Notes — ${day}" > "$dailyFile"
  echo "" >> "$dailyFile"
  echo "## [${ts}] ${topic:-note}" >> "$dailyFile"
  echo "${content}" >> "$dailyFile"
  echo "  [daily] Appended to $dailyFile"
elif [ "$layer" = "tacit" ]; then
  [ ! -f "$memRoot/tacit.md" ] && echo "# Org Operating Patterns — ${org_name}" > "$memRoot/tacit.md"
  echo "" >> "$memRoot/tacit.md"
  echo "## ${topic}" >> "$memRoot/tacit.md"
  echo "${content}" >> "$memRoot/tacit.md"
  echo "  [tacit] Pattern saved."
else
  # Layer 1: knowledge graph
  entityDir="$memRoot/knowledge/${category}/${topicSlug}"
  mkdir -p "$entityDir"
  factId="fact-$(python3 -c 'import time; print(int(time.time()*1000))')"
  python3 - "$entityDir/items.yaml" "$factId" "${topic}" "${content}" "$ts" <<'PYEOF'
import sys, yaml, os
path, fid, topic, body, ts = sys.argv[1:]
facts = []
if os.path.exists(path):
    try:
        with open(path) as f:
            loaded = yaml.safe_load(f)
            if isinstance(loaded, list): facts = loaded
    except: pass
facts.append({"id": fid, "topic": topic, "body": body, "createdAt": ts, "status": "active"})
with open(path, "w") as f:
    yaml.dump(facts, f, default_flow_style=False, allow_unicode=True)
print(f"  Fact saved: {fid} → {path}")
PYEOF
fi
```

### recall / query

Search org memory across all layers for a topic or keyword.

```bash
q="${topic:-${content}}"
echo "MEMORY RECALL — ${org_name}"
echo "Query: $q"
echo "────────────────────────────────────────────────────────"

python3 - "$memRoot" "$q" <<'PYEOF'
import os, sys, yaml, re
root, query = sys.argv[1], sys.argv[2].lower()
results = []

# Layer 1: scan items.yaml files
kg = os.path.join(root, "knowledge")
for cat in ["projects","areas","resources","archives"]:
    cpath = os.path.join(kg, cat)
    if not os.path.isdir(cpath): continue
    for topic in os.listdir(cpath):
        ypath = os.path.join(cpath, topic, "items.yaml")
        if not os.path.exists(ypath): continue
        try:
            facts = yaml.safe_load(open(ypath)) or []
            for f in facts:
                if f.get("status") == "superseded": continue
                body = str(f.get("body","")).lower()
                ftopic = str(f.get("topic","")).lower()
                if query in body or query in ftopic or query in topic.lower():
                    results.append(("knowledge/"+cat+"/"+topic, f.get("createdAt","?")[:10], f.get("body","")[:120]))
        except: pass

# Layer 2: daily notes
daily_dir = os.path.join(root, "daily")
if os.path.isdir(daily_dir):
    for fname in sorted(os.listdir(daily_dir), reverse=True)[:30]:
        try:
            text = open(os.path.join(daily_dir, fname)).read().lower()
            if query in text:
                results.append(("daily/"+fname, fname[:10], "(match in daily notes)"))
        except: pass

# Layer 3: tacit
tacit = os.path.join(root, "tacit.md")
if os.path.exists(tacit):
    text = open(tacit).read().lower()
    if query in text:
        results.append(("tacit.md", "", "(match in org patterns)"))

if not results:
    print("  No matches found.")
else:
    print(f"  {len(results)} result(s):")
    for path, date, body in results[:20]:
        print(f"\n  [{date}] {path}")
        print(f"    {body[:100]}{'...' if len(body)>100 else ''}")
PYEOF
```

### list

List all entities in the knowledge graph.

```bash
echo "KNOWLEDGE GRAPH — ${org_name}"
echo "────────────────────────────────────────────────────────"

python3 - "$memRoot/knowledge" <<'PYEOF'
import os, sys, yaml
kg = sys.argv[1]
total = 0
for cat in ["projects","areas","resources","archives"]:
    cpath = os.path.join(kg, cat)
    if not os.path.isdir(cpath): continue
    topics = [d for d in os.listdir(cpath) if os.path.isdir(os.path.join(cpath,d))]
    if not topics: continue
    print(f"\n  {cat.upper()} ({len(topics)})")
    for t in sorted(topics):
        ypath = os.path.join(cpath, t, "items.yaml")
        count = 0
        try:
            facts = yaml.safe_load(open(ypath)) or []
            count = len([f for f in facts if f.get("status") != "superseded"])
        except: pass
        print(f"    · {t}  ({count} facts)")
    total += len(topics)
print(f"\n  Total entities: {total}")
PYEOF
```

### forget

Mark a fact as superseded (never delete — supersede).

```bash
topicSlug=$(echo "${topic}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
category="${category:-resources}"
entityDir="$memRoot/knowledge/${category}/${topicSlug}"
ypath="$entityDir/items.yaml"

python3 - "$ypath" "$ts" "${content:-forgot}" <<'PYEOF'
import sys, yaml, os
path, ts, reason = sys.argv[1], sys.argv[2], sys.argv[3]
if not os.path.exists(path):
    print("  No facts found for this entity.")
    sys.exit(0)
facts = yaml.safe_load(open(path)) or []
active = [f for f in facts if f.get("status") == "active"]
for f in active:
    f["status"] = "superseded"
    f["supersededAt"] = ts
    f["supersededReason"] = reason
with open(path, "w") as out:
    yaml.dump(facts, out, default_flow_style=False, allow_unicode=True)
print(f"  {len(active)} fact(s) superseded in {path}")
PYEOF
```

### synthesize

Rebuild summary.md for an entity from its active facts.

```bash
topicSlug=$(echo "${topic}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
category="${category:-resources}"
entityDir="$memRoot/knowledge/${category}/${topicSlug}"
ypath="$entityDir/items.yaml"
[ ! -f "$ypath" ] && { echo "  No facts found for '${topic}'."; exit 0; }

python3 - "$ypath" "$entityDir/summary.md" "${topic}" <<'PYEOF'
import sys, yaml
ypath, sumpath, topic = sys.argv[1], sys.argv[2], sys.argv[3]
facts = [f for f in (yaml.safe_load(open(ypath)) or []) if f.get("status") == "active"]
lines = [f"# {topic}", "", f"{len(facts)} active fact(s):", ""]
for f in facts:
    date = str(f.get("createdAt","?"))[:10]
    lines.append(f"- [{date}] {f.get('body','')}")
open(sumpath, "w").write("\n".join(lines) + "\n")
print(f"  Summary rebuilt: {sumpath}")
PYEOF
```

### decay

Archive entities with no facts updated in the last 90 days.

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$memRoot/knowledge" "$ts" <<'PYEOF'
import os, sys, yaml, shutil
from datetime import datetime, timedelta
kg, ts = sys.argv[1], sys.argv[2]
cutoff = datetime.utcnow() - timedelta(days=90)
archived = 0
for cat in ["projects","areas","resources"]:
    cpath = os.path.join(kg, cat)
    if not os.path.isdir(cpath): continue
    for topic in os.listdir(cpath):
        ypath = os.path.join(cpath, topic, "items.yaml")
        if not os.path.exists(ypath): continue
        try:
            facts = yaml.safe_load(open(ypath)) or []
            active = [f for f in facts if f.get("status") == "active"]
            if not active: continue
            last = max(f.get("createdAt","")[:19] for f in active)
            dt = datetime.fromisoformat(last)
            if dt < cutoff:
                dst = os.path.join(kg, "archives", topic)
                shutil.move(os.path.join(cpath, topic), dst)
                archived += 1
                print(f"  Archived: {cat}/{topic} (last active: {last[:10]})")
        except: pass
print(f"\n  Decay complete: {archived} entity/entities moved to archives.")
PYEOF
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
layer: <layer>
topic: <topic>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

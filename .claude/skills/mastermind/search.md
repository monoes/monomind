---
name: mastermind-search
description: Mastermind search — fuzzy cross-org search across tasks, goals, agents, approvals, routines, projects, and activity log. Returns ranked results with org context.
type: domain-skill
default_mode: auto
---

# Mastermind Search

This skill is invoked by `mastermind:search` or directly via `/mastermind:search`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `query`: search term (required)
- `org_name`: filter to a specific org (optional — searches all orgs if omitted)
- `scope`: all | tasks | goals | agents | approvals | routines | projects | activity (default: all)
- `limit`: max results per category (default: 10)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Orgs

```bash
if [ -n "$org_name" ]; then
  orgs="$org_name"
else
  orgs=$(ls .monomind/orgs/*.json 2>/dev/null | grep -v '\-state\|-goals\|-routines\|-approvals\|-projects\|-worktrees\|-secrets' | xargs -I{} basename {} .json | sort)
fi
[ -z "$orgs" ] && { echo "No orgs found. Run /mastermind:createorg first."; exit 0; }
```

---

## Step 2 — Search All Scopes

```bash
query_lower=$(echo "$query" | tr '[:upper:]' '[:lower:]')
limit="${limit:-10}"
total_hits=0

echo "SEARCH: \"${query}\""
echo "════════════════════════════════════════════════"
echo ""

for org in $orgs; do
  orgFile=".monomind/orgs/${org}.json"
  [ ! -f "$orgFile" ] && continue

  org_hits=0

  # ── Agents ────────────────────────────────────────
  if [ "$scope" = "all" ] || [ "$scope" = "agents" ]; then
    hits=$(jq -r --arg q "$query_lower" \
      '.roles[] | select((.id + " " + .title + " " + (.responsibilities // [] | join(" "))) | ascii_downcase | test($q)) |
       "[AGENT] \(.id): \(.title)  type=\(.agent_type)"' \
      "$orgFile" 2>/dev/null | head -"$limit")
    if [ -n "$hits" ]; then
      echo "── $org / agents ──"
      echo "$hits"
      echo ""
      org_hits=$((org_hits + $(echo "$hits" | wc -l)))
    fi
  fi

  # ── Goals ─────────────────────────────────────────
  goalsFile=".monomind/orgs/${org}-goals.json"
  if [ -f "$goalsFile" ] && { [ "$scope" = "all" ] || [ "$scope" = "goals" ]; }; then
    hits=$(jq -r --arg q "$query_lower" \
      '.goals[] | select((.title + " " + (.description // "") + " " + (.status // "")) | ascii_downcase | test($q)) |
       "[GOAL] [\(.id)] \(.title)  status=\(.status // "open")"' \
      "$goalsFile" 2>/dev/null | head -"$limit")
    if [ -n "$hits" ]; then
      echo "── $org / goals ──"
      echo "$hits"
      echo ""
      org_hits=$((org_hits + $(echo "$hits" | wc -l)))
    fi
  fi

  # ── Routines ──────────────────────────────────────
  routinesFile=".monomind/orgs/${org}-routines.json"
  if [ -f "$routinesFile" ] && { [ "$scope" = "all" ] || [ "$scope" = "routines" ]; }; then
    hits=$(jq -r --arg q "$query_lower" \
      '.routines[] | select((.name + " " + (.description // "") + " " + (.schedule // "")) | ascii_downcase | test($q)) |
       "[ROUTINE] \(.name)  schedule=\(.schedule // "-")"' \
      "$routinesFile" 2>/dev/null | head -"$limit")
    if [ -n "$hits" ]; then
      echo "── $org / routines ──"
      echo "$hits"
      echo ""
      org_hits=$((org_hits + $(echo "$hits" | wc -l)))
    fi
  fi

  # ── Approvals ─────────────────────────────────────
  approvalsFile=".monomind/orgs/${org}-approvals.json"
  if [ -f "$approvalsFile" ] && { [ "$scope" = "all" ] || [ "$scope" = "approvals" ]; }; then
    hits=$(jq -r --arg q "$query_lower" \
      '.approvals[] | select((.title + " " + (.action // "") + " " + (.agent_id // "")) | ascii_downcase | test($q)) |
       "[APPROVAL] [\(.id)] \(.agent_id): \(.title)  status=\(.status)"' \
      "$approvalsFile" 2>/dev/null | head -"$limit")
    if [ -n "$hits" ]; then
      echo "── $org / approvals ──"
      echo "$hits"
      echo ""
      org_hits=$((org_hits + $(echo "$hits" | wc -l)))
    fi
  fi

  # ── Projects ──────────────────────────────────────
  projectsFile=".monomind/orgs/${org}-projects.json"
  if [ -f "$projectsFile" ] && { [ "$scope" = "all" ] || [ "$scope" = "projects" ]; }; then
    hits=$(jq -r --arg q "$query_lower" \
      '.projects[] | select((.name + " " + (.description // "") + " " + (.lead // "")) | ascii_downcase | test($q)) |
       "[PROJECT] \(.name)  status=\(.status // "active")  lead=\(.lead // "-")"' \
      "$projectsFile" 2>/dev/null | head -"$limit")
    if [ -n "$hits" ]; then
      echo "── $org / projects ──"
      echo "$hits"
      echo ""
      org_hits=$((org_hits + $(echo "$hits" | wc -l)))
    fi
  fi

  # ── Activity log ──────────────────────────────────
  if [ "$scope" = "all" ] || [ "$scope" = "activity" ]; then
    eventsFile="data/mastermind-events.jsonl"
    if [ -f "$eventsFile" ]; then
      hits=$(grep "\"org\":\"$org\"" "$eventsFile" 2>/dev/null | \
        jq -r --arg q "$query_lower" \
          'select((tostring | ascii_downcase | test($q))) |
           "[EVENT] \(.type)  org=\(.org)  \(if .task then "task=\(.task)" elif .role then "role=\(.role)" else "" end)"' \
        2>/dev/null | tail -"$limit")
      if [ -n "$hits" ]; then
        echo "── $org / activity ──"
        echo "$hits"
        echo ""
        org_hits=$((org_hits + $(echo "$hits" | wc -l)))
      fi
    fi
  fi

  total_hits=$((total_hits + org_hits))
done

if [ "$total_hits" -eq 0 ]; then
  echo "  No results found for \"${query}\""
  echo ""
  echo "  Tips:"
  echo "  • Try a shorter or more general query"
  echo "  • Use --scope to narrow: tasks, goals, agents, approvals, routines, projects, activity"
  echo "  • Use --org to limit to a specific org"
fi

echo "════════════════════════════════════════════════"
echo "Found: ${total_hits} result(s)"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
query: <query>
scope: <scope>
orgs_searched: <N>
total_hits: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

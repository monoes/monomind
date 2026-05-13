---
name: mastermind-routine-detail
description: Mastermind routine-detail — deep inspection and management of a single routine: trigger config (schedule/webhook), variables, concurrency/catchup policies, run history, webhook rotation, and revision tracking.
type: domain-skill
default_mode: auto
---

# Mastermind Routine Detail

This skill is invoked by `mastermind:routine-detail` or directly via `/mastermind:routine-detail`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the routine belongs to (required)
- `routine_id`: routine id/slug (required)
- `action`: show | runs | config | variables | rotate-webhook | revisions
- `days`: lookback window for run history (default 14)
- `var_key`: variable key (for variables --set)
- `var_value`: variable value
- `caller`: command | master

---

## Trigger Types

| Kind | Description |
|------|-------------|
| `schedule` | Cron expression — agent fires on schedule |
| `webhook` | HTTP POST to generated endpoint; signed via signing_mode |

## Signing Modes (webhook only)

| Mode | Description |
|------|-------------|
| `none` | No signature verification |
| `bearer` | Authorization: Bearer <token> header |
| `hmac_sha256` | X-Hub-Signature-256 header (HMAC-SHA256 of body) |
| `github_hmac` | GitHub-style HMAC — identical to hmac_sha256 + secret stored in mastermind:secrets |

## Concurrency Policies

| Policy | Behavior |
|--------|----------|
| `coalesce_if_active` | Skip trigger if a run is already active; record as coalesced |
| `always_enqueue` | Always create a new run regardless of active runs |
| `skip_if_active` | Silently discard trigger if a run is active |

## Catchup Policies (schedule only)

| Policy | Behavior |
|--------|----------|
| `skip_missed` | Missed scheduled runs are discarded |
| `enqueue_missed_with_cap` | Enqueue missed runs up to `catchup_cap` (default 3) |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Routine Data

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

routinesFile=".monomind/orgs/${org_name}-routines.json"
[ ! -f "$routinesFile" ] && { echo "ERROR: No routines file for org '$org_name'. Create routines first via /mastermind:runorg."; exit 1; }

routineDef=$(jq -r --arg id "$routine_id" '.routines[] | select(.id == $id)' "$routinesFile")
[ -z "$routineDef" ] && { echo "ERROR: Routine '$routine_id' not found in org '$org_name'."; exit 1; }

stateFile=".monomind/orgs/${org_name}-state.json"
days=${days:-14}
cutoff=$(date -u -v-${days}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "${days} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "ROUTINE DETAIL — $routine_id @ $org_name"
echo "────────────────────────────────────────────────────────"

echo "$routineDef" | jq -r '
  "  ID:              \(.id)",
  "  Name:            \(.name // "-")",
  "  Assigned agent:  \(.agent_id // "(any)")",
  "  Enabled:         \(.enabled // false)",
  "",
  "TRIGGER",
  "  Kind:            \(.trigger.kind // "schedule")",
  (if (.trigger.kind // "schedule") == "schedule" then
    "  Cron:            \(.trigger.cron // "-")",
    "  Catchup policy:  \(.catchup_policy // "skip_missed")",
    "  Catchup cap:     \(.catchup_cap // 3 | tostring)"
  else
    "  Endpoint:        \(.trigger.endpoint // "(not generated)")",
    "  Signing mode:    \(.trigger.signing_mode // "none")"
  end),
  "",
  "CONCURRENCY",
  "  Policy:          \(.concurrency_policy // "coalesce_if_active")",
  "",
  "VARIABLES",
  "  Count:           \((.variables // {}) | length | tostring)"
'

# Show last run summary from state
lastRun=$([ -f "$stateFile" ] && jq -r --arg id "$routine_id" '.routines[$id].last_run // "-"' "$stateFile" || echo "-")
runCount=$([ -f "$stateFile" ] && jq -r --arg id "$routine_id" '.routines[$id].run_count // 0' "$stateFile" || echo "0")
echo ""
echo "  Last run:   $lastRun"
echo "  Run count:  $runCount"
```

### runs

```bash
echo "RUN HISTORY — $routine_id (last ${days} days)"
echo "────────────────────────────────────────────────────────"
printf "%-26s %-12s %-8s %-14s %s\n" "TIMESTAMP" "STATUS" "TOKENS" "TRIGGER KIND" "COALESCED"
echo "────────────────────────────────────────────────────────"

runsFile=".monomind/orgs/${org_name}-routine-runs.jsonl"
found=0

if [ -f "$runsFile" ]; then
  while IFS= read -r line; do
    rid=$(echo "$line" | jq -r '.routine_id // ""')
    [ "$rid" != "$routine_id" ] && continue
    ts=$(echo "$line" | jq -r '.ts // ""')
    [ -n "$cutoff" ] && [ "$ts" \< "$cutoff" ] && continue
    st=$(echo "$line" | jq -r '.status // "-"')
    tok=$(echo "$line" | jq -r '.tokens // "-"')
    tkind=$(echo "$line" | jq -r '.trigger_kind // "schedule"')
    coal=$(echo "$line" | jq -r 'if .coalesced then "yes" else "-" end')
    printf "%-26s %-12s %-8s %-14s %s\n" "$ts" "$st" "$tok" "$tkind" "$coal"
    found=$((found + 1))
  done < "$runsFile"
fi

[ "$found" -eq 0 ] && echo "  No runs in the last $days days."
```

### config

```bash
echo "FULL CONFIG — $routine_id"
echo "────────────────────────────────────────────────────────"
echo "$routineDef" | jq 'del(.variables)'
echo ""
echo "TRIGGER DETAIL"
echo "$routineDef" | jq '.trigger'
```

### variables

```bash
echo "VARIABLES — $routine_id"
echo "────────────────────────────────────────────────────────"

vars=$(echo "$routineDef" | jq -r '.variables // {} | to_entries[] | "  \(.key) = \(.value)"')
[ -z "$vars" ] && echo "  No variables defined." || echo "$vars"

# Set a variable if var_key provided
if [ -n "$var_key" ]; then
  [ -z "$var_value" ] && { echo "ERROR: --var-value required when setting a variable."; exit 1; }
  tmp="${routinesFile}.tmp"
  jq --arg id "$routine_id" --arg k "$var_key" --arg v "$var_value" \
    '.routines = [.routines[] | if .id == $id then .variables[$k] = $v else . end]' \
    "$routinesFile" > "$tmp" && mv "$tmp" "$routinesFile"
  echo ""
  echo "Set variable: $var_key = $var_value"
fi
```

### rotate-webhook

```bash
triggerKind=$(echo "$routineDef" | jq -r '.trigger.kind // "schedule"')
[ "$triggerKind" != "webhook" ] && { echo "ERROR: Routine '$routine_id' is not a webhook-triggered routine."; exit 1; }

newToken=$(openssl rand -hex 24 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(24))")
newEndpoint="/api/webhook/${org_name}/${routine_id}/${newToken}"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${routinesFile}.tmp"
jq --arg id "$routine_id" --arg ep "$newEndpoint" --arg ts "$ts" \
  '.routines = [.routines[] | if .id == $id then
     .trigger.endpoint = $ep | .trigger.rotated_at = $ts
   else . end]' \
  "$routinesFile" > "$tmp" && mv "$tmp" "$routinesFile"

echo "Webhook rotated for '$routine_id'"
echo "  New endpoint: $newEndpoint"
echo "  Rotated at:   $ts"
echo ""
echo "Update your webhook source to use the new endpoint."
signingMode=$(echo "$routineDef" | jq -r '.trigger.signing_mode // "none"')
[ "$signingMode" != "none" ] && echo "  Signing mode '$signingMode' is unchanged — re-generate the signing secret if required."
```

### revisions

```bash
revisionsFile=".monomind/orgs/${org_name}-routine-revisions.jsonl"
echo "REVISIONS — $routine_id"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$revisionsFile" ]; then
  echo "  No revision history found."
else
  found=0
  while IFS= read -r line; do
    rid=$(echo "$line" | jq -r '.routine_id // ""')
    [ "$rid" != "$routine_id" ] && continue
    ts=$(echo "$line" | jq -r '.ts // ""')
    who=$(echo "$line" | jq -r '.changed_by // "system"')
    what=$(echo "$line" | jq -r '.change_summary // "-"')
    printf "  [%s] by %-16s  %s\n" "$ts" "$who" "$what"
    found=$((found + 1))
  done < "$revisionsFile"
  [ "$found" -eq 0 ] && echo "  No revisions found for '$routine_id'."
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
routine_id: <routine_id>
trigger_kind: <schedule|webhook>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

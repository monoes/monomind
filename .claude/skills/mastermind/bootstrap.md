---
name: mastermind-bootstrap
description: Mastermind bootstrap — one-time org initialization that primes the CEO/boss agent with org context, goal hierarchy, and a signed invite token. Run after createorg before first runorg.
type: domain-skill
default_mode: confirm
---

# Mastermind Bootstrap

This skill is invoked by `mastermind:bootstrap` or directly via `/mastermind:bootstrap`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to bootstrap (required)
- `action`: init | token | status | reset
- `boss_role_id`: role ID of the CEO/boss agent (default: auto-detect by `reports_to: null`)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Org

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found. Run /mastermind:createorg first."; exit 1; }

bootstrapFile=".monomind/orgs/${org_name}-bootstrap.json"
```

---

## Step 2 — Execute Action

### status (check bootstrap state)

```bash
if [ -f "$bootstrapFile" ]; then
  echo "BOOTSTRAP STATUS — ${org_name}"
  echo "──────────────────────────────────"
  jq -r '
    "  State:       \(.state // "unknown")",
    "  Boss Role:   \(.boss_role_id // "-")",
    "  Bootstrapped:\(.bootstrapped_at // "never")",
    "  Token:       \(if .invite_token then (.invite_token | .[0:8]) + "..." else "none" end)",
    "  Token used:  \(.token_used // false)"
  ' "$bootstrapFile"
else
  echo "Not bootstrapped. Run /mastermind:bootstrap --org ${org_name} --action init"
fi
```

### token (generate a fresh invite token)

Generate a signed one-time token the boss agent uses to authenticate its first session:

```bash
token=$(openssl rand -hex 24 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(24))")
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "INVITE TOKEN — ${org_name}"
echo "──────────────────────────────────"
echo "  Token: $token"
echo "  Valid until first use."
echo ""

# Store token in bootstrap file
[ ! -f "$bootstrapFile" ] && echo '{}' > "$bootstrapFile"
tmp="${bootstrapFile}.tmp"
jq --arg token "$token" --arg ts "$ts" \
  '.invite_token = $token | .token_generated_at = $ts | .token_used = false' \
  "$bootstrapFile" > "$tmp" && mv "$tmp" "$bootstrapFile"
echo "Token stored. Include in boss agent prompt as: INVITE_TOKEN=${token}"
```

### init (full bootstrap)

Initialize org bootstrap: detect boss, generate token, write primer context:

```bash
# Auto-detect boss (role with no reports_to or reports_to: null)
if [ -z "$boss_role_id" ]; then
  boss_role_id=$(jq -r '(.roles // [])[] | select(.reports_to == null or .reports_to == "") | .id' "$orgFile" | head -1)
fi
[ -z "$boss_role_id" ] && { echo "ERROR: Could not detect boss role. Pass --boss-role-id <id>."; exit 1; }

bossConfig=$(jq --arg id "$boss_role_id" '(.roles // [])[] | select(.id == $id)' "$orgFile")
bossTitle=$(echo "$bossConfig" | jq -r '.title // "CEO"')
orgGoal=$(jq -r '.goal // "No goal set"' "$orgFile")
orgTopology=$(jq -r '.topology // "hierarchical"' "$orgFile")
roleCount=$(jq '.roles | length' "$orgFile")
governance=$(jq -r '.governance.policy // "auto"' "$orgFile")

# Generate invite token
token=$(openssl rand -hex 24 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(24))")
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Write bootstrap record
cat > "$bootstrapFile" <<EOF
{
  "org": "${org_name}",
  "state": "initialized",
  "boss_role_id": "${boss_role_id}",
  "boss_title": "${bossTitle}",
  "org_goal": "${orgGoal}",
  "topology": "${orgTopology}",
  "role_count": ${roleCount},
  "governance": "${governance}",
  "invite_token": "${token}",
  "token_used": false,
  "token_generated_at": "${ts}",
  "bootstrapped_at": "${ts}"
}
EOF

echo "BOOTSTRAP COMPLETE — ${org_name}"
echo "──────────────────────────────────────────"
echo "  Boss:       ${bossTitle} (${boss_role_id})"
echo "  Goal:       ${orgGoal}"
echo "  Topology:   ${orgTopology}"
echo "  Agents:     ${roleCount}"
echo "  Governance: ${governance}"
echo "  Token:      ${token}"
echo ""
echo "CEO PRIMER (include in boss agent prompt):"
echo "──────────────────────────────────────────"
cat <<PRIMER
ORG: ${org_name}
ROLE: ${bossTitle}
GOAL: ${orgGoal}
GOVERNANCE: ${governance}
INVITE_TOKEN: ${token}

You are the autonomous CEO of org '${org_name}'. Your mission: ${orgGoal}.
You lead ${roleCount} agents in a ${orgTopology} topology.
Governance mode: ${governance}. In 'board' or 'strict' mode, pause before high-risk actions and emit approval requests.
Use your INVITE_TOKEN for your first heartbeat. Token is single-use.
PRIMER
```

Emit `org:bootstrap:complete` event:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg org "$org_name" --arg boss "$boss_role_id" \
    '{type:"org:bootstrap:complete",org:$org,boss:$boss,ts:(now*1000|floor)}')" || true
```

### reset

Clear bootstrap state (next init will regenerate token):

```bash
if [ -f "$bootstrapFile" ]; then
  rm "$bootstrapFile"
  echo "Bootstrap state cleared for '${org_name}'. Run --action init to re-bootstrap."
else
  echo "No bootstrap file found for '${org_name}'."
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
boss_role_id: <boss_role_id>
state: initialized | token | reset
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

---
name: mastermind-env
description: Mastermind env — audit and configure the runtime environment for an org. Shows LLM provider config, memory backend, agent JWT settings, logging, and storage — highlighting missing or misconfigured values.
type: domain-skill
default_mode: auto
---

# Mastermind Env

This skill is invoked by `mastermind:env` or directly via `/mastermind:env`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org to inspect env for
- `action`: show | set | validate
- `key`: env var key to set (for set action)
- `value`: value to set (for set action — use env var reference, not inline secrets)
- `section`: llm | memory | jwt | logging | storage | all (default: all)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org Config

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '$org_name' not found."; exit 1; }

memNs="org:${org_name}"
```

---

## Step 2 — Execute Action

### show (default)

Collect and display environment configuration for this org's agents:

```bash
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ENV AUDIT — org: ${org_name}"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# LLM / Adapter config
echo "LLM PROVIDER"
echo "────────────"
ceo_model=$(jq -r '.run_config.ceo_adapter // "claude-sonnet-4-6"' "$orgFile")
echo "  CEO adapter model:  $ceo_model"
jq -r '.roles[] | "  \(.id): \(.adapter_config.model // "inherited from CEO")"' "$orgFile" 2>/dev/null
echo ""

# API key availability (check env vars, never print values)
echo "API KEYS (present/missing)"
echo "──────────────────────────"
for key in ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY; do
  if [ -n "${!key}" ]; then
    echo "  $key: ✓ present (${!key:0:6}***)"
  elif [ -f ".monomind/orgs/.secrets/${org_name}/${key}" ]; then
    echo "  $key: ✓ in org secrets"
  else
    echo "  $key: ✗ MISSING"
  fi
done
echo ""

# Memory config
echo "MEMORY"
echo "──────"
echo "  namespace: org:${org_name}"
npx monomind@latest memory list --namespace "org:${org_name}" 2>/dev/null | wc -l | xargs echo "  stored entries:"
echo ""

# Board config
echo "TASK BOARD"
echo "──────────"
board_id=$(jq -r '.board_id // "NOT CONFIGURED"' "$orgFile")
echo "  board_id:    $board_id"
echo "  todo_col:    $(jq -r '.todo_col_id // "NOT CONFIGURED"' "$orgFile")"
echo "  doing_col:   $(jq -r '.doing_col_id // "NOT CONFIGURED"' "$orgFile")"
echo "  done_col:    $(jq -r '.done_col_id // "NOT CONFIGURED"' "$orgFile")"
echo ""

# Run config
echo "RUN CONFIG"
echo "──────────"
jq -r '.run_config | to_entries[] | "  \(.key): \(.value)"' "$orgFile" 2>/dev/null
echo ""

# Governance
echo "GOVERNANCE"
echo "──────────"
jq -r '"  policy: \(.governance.policy // "auto")"' "$orgFile" 2>/dev/null
echo ""

# Dashboard
echo "DASHBOARD"
echo "─────────"
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' ".monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
echo "  url:    $CTRL_URL"
curl -s "${CTRL_URL}/api/health" >/dev/null 2>&1 && echo "  status: ✓ reachable" || echo "  status: ✗ not reachable"
```

### validate

Run a preflight check before starting an org run:

```bash
echo "PREFLIGHT CHECK — org: $org_name"
errors=0

# Check all required env vars
for key in ANTHROPIC_API_KEY; do
  if [ -z "${!key}" ] && [ ! -f ".monomind/orgs/.secrets/${org_name}/${key}" ]; then
    echo "  ✗ MISSING: $key"
    errors=$((errors + 1))
  else
    echo "  ✓ $key"
  fi
done

# Check board IDs
board_id=$(jq -r '.board_id // empty' "$orgFile")
[ -z "$board_id" ] && { echo "  ✗ MISSING: board_id — run /mastermind:createorg to rebuild"; errors=$((errors + 1)); } || echo "  ✓ board_id"

# Check roles
role_count=$(jq '.roles | length' "$orgFile")
[ "$role_count" -eq 0 ] && { echo "  ✗ MISSING: no roles defined"; errors=$((errors + 1)); } || echo "  ✓ $role_count roles"

# Summary
echo ""
if [ "$errors" -eq 0 ]; then
  echo "✓ All checks passed — org is ready to run."
else
  echo "✗ $errors issue(s) found — resolve before running."
fi
```

### set

Update a run_config key or governance field in the org JSON:

```bash
# Only allow safe keys — never set arbitrary JSON to prevent injection
allowed_keys="checkpoint_interval_min max_concurrent_agents budget_tokens alert_threshold ceo_adapter"
echo "$allowed_keys" | grep -qw "$key" || { echo "ERROR: Key '$key' not settable via this command. Edit $orgFile directly."; exit 1; }

tmp="${orgFile}.tmp"
jq --arg key "$key" --arg value "$value" \
   '.run_config[$key] = ($value | if test("^[0-9]+$") then tonumber else . end)' \
   "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
echo "Set run_config.$key = $value"
```

---

## Agent Environment Template

When spawning agents, include this env block in their prompt:

```bash
# CEO/boss agent env block (prepend to all boss prompts):
echo "ENVIRONMENT:
  Memory namespace: org:${orgName}
  Dashboard: ${CTRL_URL}
  Budget: $(jq -r '.run_config.budget_tokens // "unlimited"' "$orgFile") tokens
  Governance: $(jq -r '.governance.policy // "auto"' "$orgFile")
  ANTHROPIC_API_KEY: $([ -n "$ANTHROPIC_API_KEY" ] && echo "present" || echo "missing — check org secrets")
"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
validation_errors: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

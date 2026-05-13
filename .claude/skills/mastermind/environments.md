---
name: mastermind-environments
description: Mastermind environments — manage execution environments (local, SSH, sandbox) for an org. Controls where agent workloads run, SSH connection details, and which environment is the default.
type: domain-skill
default_mode: confirm
---

# Mastermind Environments

This skill is invoked by `mastermind:environments` or directly via `/mastermind:environments`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage environments for (required)
- `action`: list | create | edit | delete | probe | set-default
- `env_id`: environment id (required for edit/delete/probe/set-default)
- `kind`: local | ssh | sandbox (required for create)
- `name`: display name (required for create)
- `host`: SSH hostname or IP (required for ssh kind)
- `port`: SSH port (default 22)
- `user`: SSH username (required for ssh kind)
- `secret_ref`: secret name holding the SSH private key (see mastermind:secrets — NEVER pass raw key values)
- `work_dir`: remote working directory (default: /tmp/monomind)
- `caller`: command | master

---

## Security Constraints

- NEVER print SSH private key values
- NEVER store key material in environment JSON files — store only the secret_ref name
- SSH keys must be stored via `mastermind:secrets` and referenced by name only
- Probe connection is read-only (runs `echo ok` over SSH)

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Environments File

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

envFile=".monomind/orgs/${org_name}-environments.json"
[ ! -f "$envFile" ] && cat > "$envFile" <<'EOF'
{"environments":[],"default_env":null}
EOF
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "ENVIRONMENTS — org: $org_name"
echo "────────────────────────────────────────────────────────"
printf "%-20s %-10s %-28s %-8s %s\n" "ID" "KIND" "HOST / PATH" "DEFAULT" "SECRET REF"
echo "────────────────────────────────────────────────────────"

defaultEnv=$(jq -r '.default_env // "none"' "$envFile")
count=$(jq '.environments | length' "$envFile")

if [ "$count" -eq 0 ]; then
  echo "  No environments. Use --action create to add one."
else
  jq -r --arg def "$defaultEnv" '.environments[] |
    [
      .id,
      (.kind // "local"),
      (if .kind == "ssh" then ((.user // "?") + "@" + (.host // "?") + ":" + ((.port // 22) | tostring)) else (.work_dir // "(local)") end),
      (if .id == $def then "yes" else "-" end),
      (.secret_ref // "-")
    ] | @tsv' "$envFile" | while IFS=$'\t' read -r id kind loc def sref; do
    printf "%-20s %-10s %-28s %-8s %s\n" "$id" "$kind" "$loc" "$def" "$sref"
  done
fi

echo ""
echo "Total: $count environment(s)  |  Default: $defaultEnv"
```

### create

```bash
[ -z "$kind" ] && { echo "ERROR: --kind required (local|ssh|sandbox)."; exit 1; }
[ -z "$name" ] && { echo "ERROR: --name required."; exit 1; }
case "$kind" in local|ssh|sandbox) : ;; *)
  echo "ERROR: --kind must be local, ssh, or sandbox"; exit 1 ;;
esac
if [ "$kind" = "ssh" ]; then
  [ -z "$host" ] && { echo "ERROR: --host required for ssh kind."; exit 1; }
  [ -z "$user" ] && { echo "ERROR: --user required for ssh kind."; exit 1; }
  [ -z "$secret_ref" ] && { echo "WARNING: No --secret-ref supplied. SSH key must be pre-configured on the agent."; }
fi

envId=$(echo "${name}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${envFile}.tmp"
jq --arg id "$envId" \
   --arg n "$name" \
   --arg kind "$kind" \
   --arg host "${host:-}" \
   --argjson port "${port:-22}" \
   --arg user "${user:-}" \
   --arg sref "${secret_ref:-}" \
   --arg wdir "${work_dir:-/tmp/monomind}" \
   --arg ts "$ts" \
  '.environments = [.environments[] | select(.id != $id)] +
   [{"id":$id,"name":$n,"kind":$kind,
     "host":(if $host != "" then $host else null end),
     "port":(if $host != "" then $port else null end),
     "user":(if $user != "" then $user else null end),
     "secret_ref":(if $sref != "" then $sref else null end),
     "work_dir":$wdir,
     "createdAt":$ts,"lastProbe":null,"probeStatus":null}]' \
  "$envFile" > "$tmp" && mv "$tmp" "$envFile"

echo "Created environment: $envId (kind: $kind)"
[ "$kind" = "ssh" ] && echo "  SSH: ${user}@${host}:${port:-22}  key ref: ${secret_ref:-(none)}"
echo "Run --action probe --env-id $envId to verify connectivity."
```

### edit

```bash
[ -z "$env_id" ] && { echo "ERROR: --env-id required."; exit 1; }
exists=$(jq --arg id "$env_id" '[.environments[] | select(.id == $id)] | length' "$envFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Environment '$env_id' not found."; exit 1; }

tmp="${envFile}.tmp"
jq --arg id "$env_id" \
   --arg host "${host:-}" \
   --argjson port "${port:-0}" \
   --arg user "${user:-}" \
   --arg sref "${secret_ref:-}" \
   --arg wdir "${work_dir:-}" \
  '.environments = [.environments[] | if .id == $id then
     . *
     (if $host != "" then {"host":$host} else {} end) *
     (if $port > 0 then {"port":$port} else {} end) *
     (if $user != "" then {"user":$user} else {} end) *
     (if $sref != "" then {"secret_ref":$sref} else {} end) *
     (if $wdir != "" then {"work_dir":$wdir} else {} end)
   else . end]' \
  "$envFile" > "$tmp" && mv "$tmp" "$envFile"

echo "Updated environment: $env_id"
```

### delete

```bash
[ -z "$env_id" ] && { echo "ERROR: --env-id required."; exit 1; }
tmp="${envFile}.tmp"
jq --arg id "$env_id" \
  '.environments = [.environments[] | select(.id != $id)] |
   if .default_env == $id then .default_env = null else . end' \
  "$envFile" > "$tmp" && mv "$tmp" "$envFile"
echo "Deleted environment: $env_id"
```

### probe

```bash
[ -z "$env_id" ] && { echo "ERROR: --env-id required."; exit 1; }
envData=$(jq -r --arg id "$env_id" '.environments[] | select(.id == $id)' "$envFile")
[ -z "$envData" ] && { echo "ERROR: Environment '$env_id' not found."; exit 1; }

kind=$(echo "$envData" | jq -r '.kind')
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

case "$kind" in
  local)
    if [ -d "$(echo "$envData" | jq -r '.work_dir // "/tmp/monomind"')" ]; then
      status="ok"
    else
      status="unreachable"
    fi
    ;;
  ssh)
    sshHost=$(echo "$envData" | jq -r '.host')
    sshUser=$(echo "$envData" | jq -r '.user')
    sshPort=$(echo "$envData" | jq -r '.port // 22')
    sref=$(echo "$envData" | jq -r '.secret_ref // ""')
    keyPath=""
    [ -n "$sref" ] && keyPath=$(cat ".monomind/orgs/.secrets/${org_name}/${sref}" 2>/dev/null | jq -r '.path // ""' 2>/dev/null || echo "")
    
    if [ -n "$keyPath" ] && [ -f "$keyPath" ]; then
      result=$(ssh -i "$keyPath" -p "$sshPort" -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
        "${sshUser}@${sshHost}" "echo ok" 2>&1)
    else
      result=$(ssh -p "$sshPort" -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
        "${sshUser}@${sshHost}" "echo ok" 2>&1)
    fi
    [ "$result" = "ok" ] && status="ok" || status="unreachable"
    ;;
  sandbox)
    status="unknown"
    ;;
esac

tmp="${envFile}.tmp"
jq --arg id "$env_id" --arg st "$status" --arg ts "$ts" \
  '.environments = [.environments[] | if .id == $id then .probeStatus = $st | .lastProbe = $ts else . end]' \
  "$envFile" > "$tmp" && mv "$tmp" "$envFile"

echo "Probe [$env_id]: $status  (checked at $ts)"
```

### set-default

```bash
[ -z "$env_id" ] && { echo "ERROR: --env-id required."; exit 1; }
exists=$(jq --arg id "$env_id" '[.environments[] | select(.id == $id)] | length' "$envFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Environment '$env_id' not found."; exit 1; }

tmp="${envFile}.tmp"
jq --arg id "$env_id" '.default_env = $id' "$envFile" > "$tmp" && mv "$tmp" "$envFile"
echo "Default environment → $env_id"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
environments_count: <N>
default_env: <id or null>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

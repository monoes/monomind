---
name: mastermind-secrets
description: Mastermind secrets — manage org-scoped API keys and secrets consumed by agents. Store, rotate, list, and audit secrets without exposing values in logs or state files.
type: domain-skill
default_mode: confirm
---

# Mastermind Secrets

This skill is invoked by `mastermind:secrets` or directly via `/mastermind:secrets`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org to manage secrets for
- `action`: list | set | rotate | revoke | audit
- `secret_name`: name/key of the secret (e.g. `OPENAI_API_KEY`, `SLACK_WEBHOOK`)
- `secret_value`: value to store (only ever passed as env var reference, NEVER hardcoded)
- `provider`: local | env | vault (default: local)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## SECURITY RULES (always enforced)

- NEVER print secret values to stdout
- NEVER store secret values in state files (store only masked references: `sk-ant-***...***`)
- NEVER commit secrets to git
- Secrets passed as `secret_value` MUST come from env vars (`$MY_KEY`), NOT inline strings

---

## Step 1 — Load Secrets Registry

The secrets registry stores **metadata only** (name, provider, masked hint, rotation date):

```bash
secretsFile=".monomind/orgs/${org_name}-secrets.json"
[ ! -f "$secretsFile" ] && echo '{"secrets":[]}' > "$secretsFile"
```

Actual secret values live in:
- `local`: `.monomind/orgs/.secrets/<org_name>/<name>` (chmod 600, gitignored)
- `env`: environment variable `ORG_<ORG_NAME_UPPER>_<SECRET_NAME_UPPER>`

---

## Step 2 — Execute Action

### list (default)

Show all registered secrets for this org (metadata only, masked values):

```bash
jq -r '
  .secrets[] |
  "[\(.name)]  provider=\(.provider)  hint=\(.masked_hint // "***")  set=\(.set_at // "unknown")  rotated=\(.rotated_at // "never")"
' "$secretsFile" 2>/dev/null || echo "No secrets registered."
```

Render as:
```
SECRETS — org: <org_name>
──────────────────────────────────────────────
NAME                  PROVIDER   VALUE HINT       SET               ROTATED
ANTHROPIC_API_KEY     local      sk-ant-***...    2 days ago        —
SLACK_WEBHOOK         env        https://hooks    1 week ago        —
GITHUB_TOKEN          local      ghp_***...       3 days ago        1 day ago
```

### set

Store a secret value. Always source from env var:

```bash
# Validate secret_name (alphanumeric + underscore only)
echo "$secret_name" | grep -qE '^[A-Z][A-Z0-9_]{0,63}$' || { echo "ERROR: secret_name must be uppercase letters, digits, underscores only."; exit 1; }

# Create secure storage dir
secretDir=".monomind/orgs/.secrets/${org_name}"
mkdir -p "$secretDir"
chmod 700 "$secretDir"

# Write value from env var reference — NEVER inline
if [ -z "${secret_value}" ]; then
  echo "ERROR: Pass the secret value as an env var: secret_value=\$MY_VAR /mastermind:secrets --action set"
  exit 1
fi

secretFile="${secretDir}/${secret_name}"
printf '%s' "$secret_value" > "$secretFile"
chmod 600 "$secretFile"

# Store masked hint (first 6 chars + ***)
hint="${secret_value:0:6}***...${secret_value: -3}"

# Register in secrets metadata
tmp="${secretsFile}.tmp"
jq --arg name "$secret_name" \
   --arg provider "${provider:-local}" \
   --arg hint "$hint" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.secrets = [.secrets[] | select(.name != $name)] +
    [{"name":$name,"provider":$provider,"masked_hint":$hint,"set_at":$ts}]' \
   "$secretsFile" > "$tmp" && mv "$tmp" "$secretsFile"

echo "Secret $secret_name stored (provider: ${provider:-local})"
```

Ensure `.monomind/orgs/.secrets/` is in `.gitignore`:
```bash
grep -q '.monomind/orgs/.secrets' .gitignore 2>/dev/null || echo '.monomind/orgs/.secrets/' >> .gitignore
```

### rotate

Generate a new value from env var and update:

```bash
# Same as set but also records rotated_at
tmp="${secretsFile}.tmp"
jq --arg name "$secret_name" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.secrets = [.secrets[] | if .name == $name then .rotated_at = $ts | .set_at = $ts else . end]' \
   "$secretsFile" > "$tmp" && mv "$tmp" "$secretsFile"
# Then re-run the set logic above with new value
```

### revoke

Remove secret value and registry entry:

```bash
rm -f ".monomind/orgs/.secrets/${org_name}/${secret_name}"
tmp="${secretsFile}.tmp"
jq --arg name "$secret_name" '.secrets = [.secrets[] | select(.name != $name)]' \
   "$secretsFile" > "$tmp" && mv "$tmp" "$secretsFile"
echo "Secret $secret_name revoked."
```

### audit

Show which agents reference each secret in their adapter_config or responsibilities:

```bash
orgFile=".monomind/orgs/${org_name}.json"
echo "=== SECRET USAGE AUDIT — org: $org_name ==="
jq -r '.roles[] | "\(.id): \(.responsibilities | join(", "))"' "$orgFile" | \
  while IFS=: read -r role resp; do
    refs=$(jq -r '.secrets[].name' "$secretsFile" | while read -r sname; do
      echo "$resp" | grep -q "$sname" && echo "    → $sname"
    done)
    [ -n "$refs" ] && echo "$role$refs"
  done
echo "(Audit checks responsibilities text only — review agent prompts manually for additional references)"
```

---

## How Agents Access Secrets

Agents spawned by the boss should read secrets via:

```bash
# Read from local storage (not env):
secret=$(cat ".monomind/orgs/.secrets/${orgName}/${SECRET_NAME}" 2>/dev/null)
[ -z "$secret" ] && secret="${!SECRET_NAME}"  # Fallback to env var

# Use in API calls:
curl -H "Authorization: Bearer $secret" ...
```

Never store secret values in memory namespace or state files.

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
secret_name: <name if applicable>
secrets_count: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

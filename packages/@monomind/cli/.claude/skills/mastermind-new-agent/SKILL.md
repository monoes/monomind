---
name: mastermind-new-agent
description: Mastermind new-agent — wizard to hire/create a new agent within an org. Configures runtime, model, role name, reports_to hierarchy, responsibilities, skill assignments (found with `monomind org skills search`), and budget. Writes a valid Org Runtime v2 role to the org config file and validates it.
type: domain-skill
default_mode: confirm
---

# Mastermind New Agent

This skill is invoked by `mastermind:new-agent` or directly via `/mastermind-new-agent`.

It writes one role in the Org Runtime v2 shape (`RoleSchema` in `packages/@monomind/cli/src/orgrt/types.ts`) — the same shape `mastermind-createorg` produces — and runs `monomind org validate` on the result. There is no `adapter` object, heartbeat or per-role system prompt in v2: the runtime reads `runtime`, `adapter_config.model`, `responsibilities`, `skills` and `skill_pool`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to add the agent to (required)
- `action`: create | preview | list-roles | list-runtimes
- `agent_id`: unique slug for the new agent (required for create; auto-generated if omitted)
- `title`: display title for the agent (required for create)
- `responsibilities`: what the role does, `;`-separated (3–6 specific duties — this is the role's briefing and what `assignee: "auto"` matches tasks against)
- `runtime`: claude | codex | antigravity | kimicode | opencode | vercel (default: claude — leave unset for the default Claude runtime)
- `model`: model identifier (default: the latest model for the runtime, see below)
- `max_tokens`: optional max output tokens per model call (omit to inherit)
- `reports_to`: parent role id in the hierarchy (required — an org has exactly one root role, and that is the boss)
- `skills`: comma-separated org-library skill names pinned into the prompt (1–3; found in Step 1.5)
- `skill_pool`: comma-separated skill names or `tag:<tag>` the role may load mid-run with `org_skill_load`
- `budget_tokens`: optional per-role token budget (positive integer; omitted when unset — the role then gets its even share of the org budget)
- `caller`: command | master

---

## Runtimes and their latest models

Every role gets an explicit `adapter_config.model` — never leave it to a runtime default, which moves when a release changes it. Unless the user asked for a specific model, use the latest one for the role's runtime (`resolveModel()` in `orgrt/session.ts` is the source of truth; if it disagrees with this table, it wins):

| `runtime` | Latest model |
|-----------|--------------|
| `claude` (default — omit the field) | `claude-sonnet-5` |
| `codex` | `gpt-5.6-terra` |
| `antigravity` | `gemini-3.6-flash-high` |
| `kimicode` | `kimi-code/k3` |
| `opencode` | `glm-5.2` |
| `vercel` | `gpt-5.5` |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }
```

---

## Step 1.5 — Find Skills (create / preview)

Skills are org-library skills, not slash commands: names like `mastermind:tasks` are not valid here and fail `org validate`. When `skills` / `skill_pool` were not given, search the library with the role's title and responsibilities and choose from the hits:

```bash
npx monomind org skills search "${title} ${responsibilities}" --limit 8 --format json \
  | jq -r '.skills[] | "\(.name)\t\(.description)"'
npx monomind org skills show <name>   # read one before choosing it
```

Pin 1–3 that define the role in `skills`; put the ones it needs only for some tasks in `skill_pool`. Leave both empty when nothing fits cleanly — `responsibilities` alone is a complete role.

---

## Step 2 — Execute Action

### list-runtimes

```bash
echo "ORG RUNTIME v2 RUNTIMES (latest model)"
echo "────────────────────────────────────────────────────────"
cat <<'RUNTIMES'
  claude        claude-sonnet-5          (default; also claude-opus-5, claude-fable-5-1, claude-haiku-4-5-20251001)
  codex         gpt-5.6-terra
  antigravity   gemini-3.6-flash-high
  kimicode      kimi-code/k3
  opencode      glm-5.2
  vercel        gpt-5.5                  (pair with provider.vendor)
RUNTIMES
```

### list-roles

```bash
echo "CURRENT ROLES IN ORG: $org_name"
echo "────────────────────────────────────────────────────────"
printf "%-22s %-24s %-12s %-24s %s\n" "ID" "TITLE" "RUNTIME" "MODEL" "REPORTS TO"
echo "────────────────────────────────────────────────────────"
jq -r '(.roles // [])[] |
  [.id, (.title // "-"), (.runtime // "claude"), (.adapter_config.model // "(unset)"), (.reports_to // "(root)")] | @tsv' \
  "$orgFile" | while IFS=$'\t' read -r id title rt model parent; do
  printf "%-22s %-24s %-12s %-24s %s\n" "$id" "$title" "$rt" "$model" "$parent"
done
```

### preview / create — shared setup

```bash
[ -z "$title" ] && { echo "ERROR: --title required."; exit 1; }
[ -z "$reports_to" ] && { echo "ERROR: --reports-to required (the org already has its root role)."; exit 1; }

runtimeVal="${runtime:-claude}"
modelId="${model}"
if [ -z "$modelId" ]; then
  case "$runtimeVal" in
    claude)       modelId="claude-sonnet-5" ;;
    codex)        modelId="gpt-5.6-terra" ;;
    antigravity)  modelId="gemini-3.6-flash-high" ;;
    kimicode)     modelId="kimi-code/k3" ;;
    opencode)     modelId="glm-5.2" ;;
    vercel)       modelId="gpt-5.5" ;;
    *) echo "ERROR: unknown runtime '$runtimeVal' (see --action list-runtimes)."; exit 1 ;;
  esac
fi

[ -z "$agent_id" ] && agent_id=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')

if [ -n "$budget_tokens" ] && ! [[ "$budget_tokens" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: --budget-tokens must be a positive integer (omit it for the even share)."; exit 1
fi
```

### preview

```bash
echo "PREVIEW — new role to be added to org '$org_name'"
echo "────────────────────────────────────────────────────────"
echo "  ID:               $agent_id"
echo "  Title:            $title"
echo "  Runtime / model:  $runtimeVal / $modelId"
echo "  Reports to:       $reports_to"
echo "  Responsibilities: ${responsibilities:-(none — add some: they are the role's briefing)}"
echo "  Skills:           ${skills:-(none)}"
echo "  Skill pool:       ${skill_pool:-(none)}"
echo "  Budget:           ${budget_tokens:-(even share of the org budget)}"
echo ""
echo "Run with --action create to add this role to the org."
```

### create

```bash
duplicate=$(jq -r --arg id "$agent_id" '[(.roles // [])[] | select(.id == $id)] | length' "$orgFile")
[ "$duplicate" -gt 0 ] && { echo "ERROR: Role id '$agent_id' already exists in org '$org_name'. Use --agent-id to specify a unique id."; exit 1; }

parentExists=$(jq -r --arg pid "$reports_to" '[(.roles // [])[] | select(.id == $pid)] | length' "$orgFile")
[ "$parentExists" -eq 0 ] && { echo "ERROR: Parent role '$reports_to' not found in org '${org_name}'. Check ids with --action list-roles."; exit 1; }

list() { [ -n "$1" ] && echo "$1" | tr "$2" '\n' | sed 's/^ *//;s/ *$//' | jq -Rsc 'split("\n") | map(select(. != ""))' || echo '[]'; }

tmp="${orgFile}.tmp"
jq --arg id "$agent_id" \
   --arg title "$title" \
   --arg rt "$reports_to" \
   --arg runtime "$runtimeVal" \
   --arg model "$modelId" \
   --arg maxTok "${max_tokens:-}" \
   --arg budget "${budget_tokens:-}" \
   --argjson resp "$(list "$responsibilities" ';')" \
   --argjson skills "$(list "$skills" ',')" \
   --argjson pool "$(list "$skill_pool" ',')" \
  '.roles += [
    {id: $id, title: $title, type: "specialist", reports_to: $rt, responsibilities: $resp,
     adapter_config: ({model: $model} + (if $maxTok != "" then {max_tokens: ($maxTok | tonumber)} else {} end))}
    + (if $runtime != "claude" then {runtime: $runtime} else {} end)
    + (if ($skills | length) > 0 then {skills: $skills} else {} end)
    + (if ($pool | length) > 0 then {skill_pool: $pool} else {} end)
    + (if $budget != "" then {budget_tokens: ($budget | tonumber)} else {} end)
  ]' \
  "$orgFile" > "$tmp" || { rm -f "$tmp"; echo "ERROR: could not build the role."; exit 1; }

# Validate BEFORE replacing the config: the same parse org run/serve use,
# plus unknown-skill checks. A refused role leaves the org file untouched.
cp "$orgFile" "${orgFile}.bak" && mv "$tmp" "$orgFile"
if ! npx -y monomind@latest org validate "$org_name"; then
  mv "${orgFile}.bak" "$orgFile"
  echo "ERROR: the new role did not validate (see above) — org config restored."; exit 1
fi
rm -f "${orgFile}.bak"

echo "Role created: $agent_id"
echo "  Title:    $title"
echo "  Runtime:  $runtimeVal / $modelId"
echo "  Reports:  $reports_to"
echo "  Skills:   ${skills:-(none)}  pool: ${skill_pool:-(none)}"
echo ""
echo "Org '${org_name}' now has $(jq '.roles | length' "$orgFile") role(s)."
echo "View: /mastermind-agent-detail --org $org_name --agent-id $agent_id"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
agent_id: <agent_id>
runtime: <runtime>
model: <model>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.

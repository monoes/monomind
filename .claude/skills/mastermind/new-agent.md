---
name: mastermind-new-agent
description: Mastermind new-agent — wizard to hire/create a new agent within an org. Configures adapter type, model, role name, reports_to hierarchy, governance policy, skill assignments, and budget. Writes the new role to the org config file.
type: domain-skill
default_mode: confirm
---

# Mastermind New Agent

This skill is invoked by `mastermind:new-agent` or directly via `/mastermind:new-agent`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to add the agent to (required)
- `action`: create | preview | list-roles | list-adapters
- `agent_id`: unique slug for the new agent (required for create; auto-generated if omitted)
- `title`: display title for the agent (required for create)
- `adapter_type`: claude-local | gemini-local | codex-local | cursor | opencode | hermes | http | acpx (default: claude-local)
- `model`: model identifier (e.g. claude-sonnet-4-6, claude-opus-4-7, gemini-2.0-flash)
- `max_tokens`: max tokens per run (default: 8192)
- `reports_to`: parent agent id in the hierarchy (null = top-level)
- `governance`: auto | board | strict (default: inherit from org)
- `skills`: comma-separated skill names to assign (e.g. mastermind:tasks,mastermind:goals)
- `budget_tokens`: per-run token budget cap (optional)
- `heartbeat_enabled`: true | false (default: false)
- `heartbeat_interval`: heartbeat interval in seconds (default: 900)
- `system_prompt`: brief system prompt override (optional)
- `caller`: command | master

---

## Adapter Types

| Type | Description | Default Model |
|------|-------------|---------------|
| `claude-local` | Claude via Anthropic API | claude-sonnet-4-6 |
| `gemini-local` | Gemini via Google API | gemini-2.0-flash |
| `codex-local` | OpenAI Codex | gpt-4o |
| `cursor` | Cursor IDE agent | cursor-default |
| `opencode` | OpenCode agent | opencode-default |
| `hermes` | Hermes local model | hermes-3 |
| `http` | Custom HTTP adapter | (custom) |
| `acpx` | ACPX protocol | (custom) |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }
```

---

## Step 2 — Execute Action

### list-adapters

```bash
echo "AVAILABLE ADAPTERS"
echo "────────────────────────────────────────────────────────"
cat <<'ADAPTERS'
  claude-local    Claude via Anthropic API   (recommended)
    Models: claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5
  gemini-local    Gemini via Google AI
    Models: gemini-2.0-flash, gemini-1.5-pro
  codex-local     OpenAI Codex
    Models: gpt-4o, gpt-4o-mini, o3-mini
  cursor          Cursor IDE agent
  opencode        OpenCode agent
  hermes          Hermes local LLM (Ollama)
  http            Custom HTTP adapter endpoint
  acpx            ACPX protocol adapter
ADAPTERS
```

### list-roles

```bash
echo "CURRENT ROLES IN ORG: $org_name"
echo "────────────────────────────────────────────────────────"
printf "%-22s %-20s %-14s %s\n" "ID" "TITLE" "ADAPTER" "REPORTS TO"
echo "────────────────────────────────────────────────────────"
jq -r '.roles[] |
  [.id, (.title // "-"), (.adapter.type // "claude-local"), (.reports_to // "(root)")] | @tsv' \
  "$orgFile" | while IFS=$'\t' read -r id title adapter rt; do
  printf "%-22s %-20s %-14s %s\n" "$id" "$title" "$adapter" "$rt"
done
```

### preview

```bash
[ -z "$title" ] && { echo "ERROR: --title required for preview."; exit 1; }

adapterType="${adapter_type:-claude-local}"
modelId="${model}"
# Default model per adapter
if [ -z "$modelId" ]; then
  case "$adapterType" in
    claude-local)  modelId="claude-sonnet-4-6" ;;
    gemini-local)  modelId="gemini-2.0-flash" ;;
    codex-local)   modelId="gpt-4o" ;;
    cursor)        modelId="cursor-default" ;;
    opencode)      modelId="opencode-default" ;;
    hermes)        modelId="hermes-3" ;;
    *)             modelId="(custom)" ;;
  esac
fi

# Generate slug if not set
agentIdPreview="${agent_id}"
if [ -z "$agentIdPreview" ]; then
  agentIdPreview=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
fi

echo "PREVIEW — new agent to be added to org '$org_name'"
echo "────────────────────────────────────────────────────────"
echo "  ID:          $agentIdPreview"
echo "  Title:       $title"
echo "  Adapter:     $adapterType / $modelId"
echo "  Max tokens:  ${max_tokens:-8192}"
echo "  Reports to:  ${reports_to:-(root/top-level)}"
echo "  Governance:  ${governance:-inherit}"
echo "  Skills:      ${skills:-(none)}"
echo "  Budget:      ${budget_tokens:-(unlimited)}"
echo "  Heartbeat:   ${heartbeat_enabled:-false} (${heartbeat_interval:-900}s)"
[ -n "$system_prompt" ] && echo "  Prompt:      $system_prompt"
echo ""
echo "Run with --action create to add this agent to the org."
```

### create

```bash
[ -z "$title" ] && { echo "ERROR: --title required."; exit 1; }

adapterType="${adapter_type:-claude-local}"
modelId="${model}"
if [ -z "$modelId" ]; then
  case "$adapterType" in
    claude-local)  modelId="claude-sonnet-4-6" ;;
    gemini-local)  modelId="gemini-2.0-flash" ;;
    codex-local)   modelId="gpt-4o" ;;
    cursor)        modelId="cursor-default" ;;
    opencode)      modelId="opencode-default" ;;
    hermes)        modelId="hermes-3" ;;
    *)             modelId="(custom)" ;;
  esac
fi

# Generate id from title if not provided
if [ -z "$agent_id" ]; then
  agent_id=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
fi

# Check for duplicate id
duplicate=$(jq -r --arg id "$agent_id" '[.roles[] | select(.id == $id)] | length' "$orgFile")
[ "$duplicate" -gt 0 ] && { echo "ERROR: Agent id '$agent_id' already exists in org '$org_name'. Use --agent-id to specify a unique id."; exit 1; }

# Validate reports_to if set
if [ -n "$reports_to" ]; then
  parentExists=$(jq -r --arg pid "$reports_to" '[.roles[] | select(.id == $pid)] | length' "$orgFile")
  [ "$parentExists" -eq 0 ] && echo "WARNING: Parent agent '$reports_to' not found in org. Setting anyway."
fi

# Build skills array
skillsArray="[]"
if [ -n "$skills" ]; then
  skillsArray=$(echo "$skills" | tr ',' '\n' | jq -Rsc 'split("\n") | map(select(. != ""))')
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${orgFile}.tmp"
jq --arg id "$agent_id" \
   --arg title "$title" \
   --arg adapter "$adapterType" \
   --arg model "$modelId" \
   --argjson maxTok "${max_tokens:-8192}" \
   --arg rt "${reports_to:-}" \
   --arg gov "${governance:-}" \
   --argjson skills "$skillsArray" \
   --argjson budget "${budget_tokens:-null}" \
   --argjson hbEnabled "${heartbeat_enabled:-false}" \
   --argjson hbInterval "${heartbeat_interval:-900}" \
   --arg prompt "${system_prompt:-}" \
   --arg ts "$ts" \
  '.roles += [{
    "id": $id,
    "title": $title,
    "adapter": {"type": $adapter, "model": $model, "max_tokens": $maxTok},
    "reports_to": (if $rt != "" then $rt else null end),
    "governance": (if $gov != "" then $gov else null end),
    "skills": $skills,
    "budget_tokens": $budget,
    "heartbeat": {"enabled": $hbEnabled, "interval": $hbInterval},
    "system_prompt": (if $prompt != "" then $prompt else null end),
    "created_at": $ts
  }]' \
  "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"

echo "Agent created: $agent_id"
echo "  Title:    $title"
echo "  Adapter:  $adapterType / $modelId"
echo "  Reports:  ${reports_to:-(root)}"
echo "  Skills:   ${skills:-(none)}"
echo ""
echo "Org '${org_name}' now has $(jq '.roles | length' "$orgFile") agent(s)."
echo "View: /mastermind:agent-detail --org $org_name --agent-id $agent_id"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
agent_id: <agent_id>
adapter_type: <type>
model: <model>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

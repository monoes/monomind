---
name: mastermind-skills
description: Mastermind skills — list, sync, and map skills available to org agents. Scans .claude/skills/ directory and shows which roles have access to which skill domains.
type: domain-skill
default_mode: auto
---

# Mastermind Skills

This skill is invoked by `mastermind:skills` or directly via `/mastermind:skills`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to inspect skills for (optional — shows all skills if omitted)
- `action`: list | sync | map | enable | disable
- `skill_name`: skill slug (required for enable/disable)
- `role_id`: role to map skill to (optional)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Scan Skills Directory

```bash
skillsDir=".claude/skills"
[ ! -d "$skillsDir" ] && { echo "ERROR: No .claude/skills/ directory found."; exit 1; }

# List all skill files recursively
allSkills=$(find "$skillsDir" -name "*.md" ! -name "_*" | sort)
```

---

## Step 2 — Execute Action

### list (default)

Display all available skills with metadata:

```bash
echo "AVAILABLE SKILLS"
echo "────────────────────────────────────────────────────────"
printf "%-30s %-15s %-10s %s\n" "NAME" "TYPE" "MODE" "DESCRIPTION"
echo "────────────────────────────────────────────────────────"

for f in $allSkills; do
  skillSlug=$(basename "$f" .md)
  domain=$(dirname "$f" | sed "s|$skillsDir/||")
  skillType=$(grep -m1 "^type:" "$f" 2>/dev/null | awk '{print $2}')
  skillMode=$(grep -m1 "^default_mode:" "$f" 2>/dev/null | awk '{print $2}')
  skillDesc=$(grep -m1 "^description:" "$f" 2>/dev/null | sed 's/^description: //' | cut -c1-60)
  printf "%-30s %-15s %-10s %s\n" "${domain}:${skillSlug}" "${skillType:-skill}" "${skillMode:-auto}" "$skillDesc"
done

echo ""
echo "Total: $(echo "$allSkills" | wc -l | tr -d ' ') skills"
```

### map

Show which skills are mapped to each role in the org:

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '$org_name' not found."; exit 1; }

echo "SKILL MAP — org: $org_name"
echo "────────────────────────────────────────────────────────"

jq -r '.roles[] | "[\(.id)] \(.title)  agent_type=\(.agent_type)"' "$orgFile" | while IFS= read -r line; do
  echo "$line"
  roleId=$(echo "$line" | grep -o '^\[[^]]*\]' | tr -d '[]')
  # Show skills configured for this role
  mappedSkills=$(jq -r --arg id "$roleId" \
    '.roles[] | select(.id == $id) | .skills // [] | join(", ")' \
    "$orgFile" 2>/dev/null)
  if [ -n "$mappedSkills" ] && [ "$mappedSkills" != "null" ]; then
    echo "  Skills: $mappedSkills"
  else
    echo "  Skills: (inherited from agent_type)"
  fi
  echo ""
done
```

### sync

Refresh the skill registry by re-scanning `.claude/skills/` and updating org config with available skill slugs:

```bash
skillsDir=".claude/skills"
skillList=$(find "$skillsDir" -name "*.md" ! -name "_*" -exec basename {} .md \; | sort | jq -Rsc 'split("\n") | map(select(. != ""))')

if [ -n "$org_name" ]; then
  orgFile=".monomind/orgs/${org_name}.json"
  tmp="${orgFile}.tmp"
  jq --argjson skills "$skillList" '.available_skills = $skills' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
  echo "Synced $(echo "$skillList" | jq 'length') skills → org: $org_name"
else
  echo "Available skills:"
  echo "$skillList" | jq -r '.[]'
  echo ""
  echo "Pass --org <name> to sync skills into a specific org config."
fi
```

### enable / disable

Add or remove a skill from a role's allowed list:

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '$org_name' not found."; exit 1; }
[ -z "$skill_name" ] && { echo "ERROR: --skill-name required."; exit 1; }
[ -z "$role_id" ] && { echo "ERROR: --role-id required for enable/disable."; exit 1; }

tmp="${orgFile}.tmp"
if [ "$action" = "enable" ]; then
  jq --arg id "$role_id" --arg skill "$skill_name" \
    '.roles = [.roles[] | if .id == $id then .skills = ((.skills // []) + [$skill] | unique) else . end]' \
    "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
  echo "Enabled skill '$skill_name' for role '$role_id'"
else
  jq --arg id "$role_id" --arg skill "$skill_name" \
    '.roles = [.roles[] | if .id == $id then .skills = ((.skills // []) | map(select(. != $skill))) else . end]' \
    "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
  echo "Disabled skill '$skill_name' for role '$role_id'"
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name if provided>
skills_found: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

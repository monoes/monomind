---
name: mastermind-agent-select
description: Shared utility — registry-aware agent selection for mastermind domain skills. Reads .monomind/registry.json and returns ranked agent slugs/names for a given task, prompt, and category filter. Include this logic wherever a domain skill needs to pick the best agent(s) instead of hardcoding types.
type: helper
---

# Agent Selection from Registry

Use this pattern whenever a mastermind skill needs to select specialist agents. The shared index is `monomind pick`: it ranks the agent registry (`.monomind/registry.json`, built from `.claude/agents/`) and every skill — Claude skills plus the Org skill library — in one call. The registry keyword scorer below is only the fallback when the CLI is unavailable.

---

## Standard Selection Block

```bash
# AGENT SELECTION — pick best agents for the current task
# Set these before the block:
#   REGISTRY=".monomind/registry.json"
#   PROMPT="<the user's prompt or idea description>"
#   CATEGORIES="marketing strategy product"   # space-separated; adjust per domain
#   TOP_N=6                                   # how many agents to return

REGISTRY="${REGISTRY:-.monomind/registry.json}"

# 0. Decision model first. `monomind pick` asks Jev/OpenJev when configured
#    (MONOMIND_JEV_URL, or TYPESAFE_API_KEY + MONOMIND_JEV_HOSTED=1) and
#    otherwise ranks by keywords.
# Local only — never npx (no registry egress). A globally installed monomind may
# predate `pick`, so each candidate must prove it supports the command.
mm() { for c in monomind ./node_modules/.bin/monomind; do
         command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || continue
         "$c" pick --help >/dev/null 2>&1 && { "$c" "$@"; return $?; }
       done; return 127; }
selected_agents=$(mm pick -t "$PROMPT" --agents --categories "$CATEGORIES" \
  --top "$TOP_N" --json 2>/dev/null \
  | jq -c '[.agents.ranked[] | {name: (.name // .id), slug: .id, category}]' 2>/dev/null)

# Fallback when the CLI is unavailable: the registry keyword scorer below.
if [ -z "$selected_agents" ] || [ "$selected_agents" = "[]" ]; then

# 1. Extract candidates from the registry filtered by category
candidates=$(jq -r \
  --arg cats "$CATEGORIES" \
  '[ (.agents // [])[]
     | select(.deprecated != true)
     | select(
         .category as $c |
         ($cats | split(" ") | any(. == $c))
       )
     | {name: .name, slug: .slug, category: .category}
   ] | unique_by(.slug) | .[]' \
  "$REGISTRY")

# 2. Score each candidate by keyword overlap with the prompt
# Extract keywords from prompt (words ≥5 chars, lowercase)
keywords=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{5,}' | sort -u | tr '\n' ' ')

selected_agents=$(echo "$candidates" | jq -Rs \
  --arg kw "$keywords" \
  --argjson n "$TOP_N" \
  '
  [ split("\n")[] | select(length > 0) | fromjson ] |
  map(
    . as $agent |
    ($kw | split(" ")) as $keywords |
    ($agent.name | ascii_downcase) as $name |
    ($agent.category | ascii_downcase) as $cat |
    {
      agent: $agent,
      score: ([$keywords[] | if (($name | contains(.)) or ($cat | contains(.))) then 1 else 0 end] | add // 0)
    }
  ) |
  sort_by(-.score) |
  .[0:$n] |
  map(.agent)
  ')
fi

echo "$selected_agents"
```

The output is a JSON array of `{name, slug, category}` objects. Use `.name` as the `subagent_type` in Task calls, `.slug` for display.

---

## Category Map — which categories to filter per domain

| Domain / purpose | Categories to include |
|---|---|
| **Idea — user/market angles** | `marketing specialized testing` |
| **Idea — technical angles** | `engineering architecture core` |
| **Build** | `core engineering architecture testing` |
| **Marketing / Content** | `marketing specialized` |
| **Research** | `core specialized` |
| **Release** | `github engineering` |
| **Review** | `engineering testing core` |
| **Coordination** | `core monoswarm consensus` |

Registry categories are the `.claude/agents/` folder names: `architecture consensus core design engineering github goal marketing monoswarm optimization specialists specialized templates testing`.
---

## Quick Pattern: pick ONE best agent for a specific task

```bash
# Pick the single best agent for a task description
TASK_DESC="<one-line description of what this agent must do>"
CATS="engineering development"

# Local only — never npx (no registry egress). A globally installed monomind may
# predate `pick`, so each candidate must prove it supports the command.
mm() { for c in monomind ./node_modules/.bin/monomind; do
         command -v "$c" >/dev/null 2>&1 || [ -x "$c" ] || continue
         "$c" pick --help >/dev/null 2>&1 && { "$c" "$@"; return $?; }
       done; return 127; }
best_agent=$(mm pick -t "$TASK_DESC" --agents --categories "$CATS" --top 1 --json 2>/dev/null \
  | jq -r '.agents.ranked[0].name // .agents.ranked[0].id // empty' 2>/dev/null)

if [ -z "$best_agent" ]; then
best_agent=$(jq -r \
  --arg cats "$CATS" \
  --arg task "$(echo "$TASK_DESC" | tr '[:upper:]' '[:lower:]')" \
  '[ (.agents // [])[]
     | select(.deprecated != true)
     | select(.category as $c | ($cats | split(" ") | any(. == $c)))
     | {name: .name, slug: .slug,
        score: (.name | ascii_downcase | if contains($task) then 2 else 0 end)}
   ]
   | sort_by(-.score)
   | .[0].name // "coder"' \
  "$REGISTRY")
fi
```

---

## Fallback

If the registry is missing or empty, fall back to these safe defaults per domain:

| Domain | Fallback agents |
|---|---|
| idea specialists | `researcher`, `Launch Strategist`, `CRO Specialist` |
| dev decomp | `Software Architect` |
| ops decomp | `Launch Strategist` |
| build | `coder`, `tester`, `reviewer` |
| marketing | `Competitive Content Strategist`, `Email Marketing Specialist` |
| review | `Code Reviewer`, `Security Engineer`, `reviewer` |
---

## Skills from the same index

```bash
# Best skills for a task: Claude skills (source "platform") and Org-library
# skills (source "org") ranked together. `invoke` says how to load each one.
mm pick -t "$PROMPT" --skills --top 3 --json 2>/dev/null \
  | jq -c '[.skills.ranked[] | {id, source, invoke}]'
```

A `platform` skill loads with its `invoke` (`Skill("name")`); an `org` skill is
read with `monomind org skills show <name>`, or named in an org role's `skills`
/ `skill_pool`.

---

## Usage in a domain skill

1. Set `REGISTRY`, `PROMPT`, `CATEGORIES`, `TOP_N`
2. Run the Standard Selection Block
3. Parse `selected_agents` JSON array
4. Spawn Task agents using `.name` as `subagent_type`, one per entry
5. If `selected_agents` is empty or registry missing: use the fallback list above

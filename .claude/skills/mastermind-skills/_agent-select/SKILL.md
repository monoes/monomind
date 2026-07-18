---
name: mastermind-agent-select
description: Shared utility — registry-aware agent selection for mastermind domain skills. Reads .monomind/registry.json and returns ranked agent slugs/names for a given task, prompt, and category filter. Include this logic wherever a domain skill needs to pick the best agent(s) instead of hardcoding types.
type: helper
---

# Agent Selection from Registry

Use this pattern whenever a mastermind skill needs to select specialist agents. The registry lives at `.monomind/registry.json` and contains all 257+ available agent types with their category labels.

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

echo "$selected_agents"
```

The output is a JSON array of `{name, slug, category}` objects. Use `.name` as the `subagent_type` in Task calls, `.slug` for display.

---

## Category Map — which categories to filter per domain

| Domain / purpose | Categories to include |
|---|---|
| **Idea — user/market angles** | `marketing strategy product academic` |
| **Idea — technical angles** | `engineering development architecture` |
| **Idea — ops/business angles** | `sales strategy product project-management` |
| **Build** | `engineering development architecture devops testing` |
| **Marketing** | `marketing paid-media strategy` |
| **Sales** | `sales strategy product` |
| **Research** | `academic specialized strategy` |
| **Content** | `marketing specialized` |
| **Ops** | `project-management strategy support` |
| **Release** | `devops github engineering` |
| **Review** | `engineering testing analysis` |
| **Finance** | `strategy specialized` |

---

## Quick Pattern: pick ONE best agent for a specific task

```bash
# Pick the single best agent for a task description
TASK_DESC="<one-line description of what this agent must do>"
CATS="engineering development"

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
```

---

## Fallback

If the registry is missing or empty, fall back to these safe defaults per domain:

| Domain | Fallback agents |
|---|---|
| idea specialists | `researcher`, `Trend Researcher`, `Growth Hacker` |
| dev decomp | `Software Architect` |
| ops decomp | `Product Manager` |
| build | `coder`, `tester`, `reviewer` |
| marketing | `Content Creator`, `SEO Specialist` |
| sales | `Outbound Strategist`, `Deal Strategist` |

---

## Usage in a domain skill

1. Set `REGISTRY`, `PROMPT`, `CATEGORIES`, `TOP_N`
2. Run the Standard Selection Block
3. Parse `selected_agents` JSON array
4. Spawn Task agents using `.name` as `subagent_type`, one per entry
5. If `selected_agents` is empty or registry missing: use the fallback list above

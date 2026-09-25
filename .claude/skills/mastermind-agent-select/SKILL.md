---
name: mastermind-agent-select
description: Shared utility — registry-aware agent selection for mastermind domain skills. Reads .monomind/registry.json and returns ranked agent slugs/names for a given task, prompt, and category filter. Include this logic wherever a domain skill needs to pick the best agent(s) instead of hardcoding types.
type: helper
---

# Agent Selection from Registry

Use this pattern whenever a mastermind skill or command needs to select specialist agents. Never hardcode a roster: the agent set differs per install, and a `subagent_type` that is not installed fails at spawn time.

## The pick order (always in this order)

1. **`[PICK]` line.** When the user prompt carries a hook-injected line `[PICK] agent: <name> · skill: <invoke>`, use that agent/skill unless it is clearly wrong for the task.
2. **MCP tool `mcp__monomind__pick`** (when the monomind MCP server is connected):
   `mcp__monomind__pick({ task: "<task>", kind: "agents", categories: ["engineering"], top: 3 })`
   → same JSON as `monomind pick --json`; each `agents.ranked[].name` is a spawnable `subagent_type`, and `summary` is a one-line recap. Use `kind: "skills"` or `"both"` for skills.
3. **Local CLI `monomind pick`** — the Standard Selection Block below (local binary only, never npx).
4. **Registry keyword scorer** — the fallback inside the same block, when no usable CLI is installed.
5. **Fixed fallback defaults** (bottom of this file) — real agent names only.

The shared index behind 2 and 3 ranks the agent registry (`.monomind/registry.json`, built from `.claude/agents/`) and every skill — Claude skills plus the Org skill library — in one call.

---

## Standard Selection Block

```bash
# AGENT SELECTION — pick best agents for the current task
# Set these before the block:
#   REGISTRY=".monomind/registry.json"
#   PROMPT="<the user's prompt or idea description>"
#   CATEGORIES="marketing specialized"        # space-separated; see Category Map
#   TOP_N=6                                   # how many agents to return

REGISTRY="${REGISTRY:-.monomind/registry.json}"

# Local only — never npx (no registry egress). A candidate binary is accepted
# only when its output is the unified index: every skill entry carries a
# `source` field. Installs without `pick`, and pick builds that predate the
# unified index, never emit it — so the call deliberately ranks skills too
# (no --agents), and that output doubles as the version check.
mmpick() { for c in monomind ./node_modules/.bin/monomind; do
    command -v "$c" >/dev/null 2>&1 || continue
    out=$("$c" pick "$@" --json 2>/dev/null) || continue
    printf '%s' "$out" | jq -e '[.skills.ranked[]? | has("source")] | (length > 0 and all)' \
      >/dev/null 2>&1 && { printf '%s\n' "$out"; return 0; }
  done; return 127; }

selected_agents=$(mmpick -t "$PROMPT" --categories "$CATEGORIES" --top "$TOP_N" \
  | jq -c '[.agents.ranked[] | {name: (.name // .id), slug: .id, category}]' 2>/dev/null)

# Fallback when no usable CLI: score the registry against name + description +
# capabilities + tags + whenToUse (keywords of 4+ letters from the prompt).
if { [ -z "$selected_agents" ] || [ "$selected_agents" = "[]" ]; } && [ -f "$REGISTRY" ]; then
  keywords=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{4,}' | sort -u | tr '\n' ' ')
  selected_agents=$(jq -c \
    --arg cats "$CATEGORIES" \
    --arg kw "$keywords" \
    --argjson n "$TOP_N" \
    '($kw | split(" ") | map(select(length > 0))) as $keywords
     | [ (.agents // [])[]
         | select(.deprecated != true)
         | select(($cats | length) == 0 or (.category as $c | $cats | split(" ") | any(. == $c)))
         | . as $a
         | ([ $a.name, $a.description, ($a.capabilities // [] | join(" ")),
              ($a.tags // [] | join(" ")), ($a.whenToUse // "") ]
            | map(. // "") | join(" ") | ascii_downcase) as $text
         | {name: $a.name, slug: $a.slug, category: $a.category,
            score: ([ $keywords[] | select(. as $k | $text | contains($k)) ] | length)}
       ]
     | unique_by(.slug)
     | map(select(.score > 0))
     | sort_by(-.score)
     | .[0:$n]
     | map({name, slug, category})' \
    "$REGISTRY" 2>/dev/null)
fi

echo "${selected_agents:-[]}"
```

The output is a JSON array of `{name, slug, category}` objects. Use `.name` as the `subagent_type` in Task calls and `.slug` for display. An empty array means: use the fixed fallback defaults below.

---

## Category Map — which categories to filter per domain

| Domain / purpose | Categories to include |
|---|---|
| **Idea — user/market angles** | `marketing specialized design testing` |
| **Idea — technical angles** | `engineering architecture core specialized` |
| **Build** | `core engineering architecture design specialized testing` |
| **Marketing / Content / Sales** | `marketing specialized` |
| **Research** | `core specialized specialists` |
| **Release** | `github engineering` |
| **Review** | `engineering testing core design specialized` |
| **Ops / Finance** | `specialized engineering core` |
| **Coordination** | `core monoswarm consensus` |

Registry categories are the `.claude/agents/` folder names: `architecture consensus core design engineering github goal marketing monoswarm optimization specialists specialized templates testing`. Pass an empty `CATEGORIES` to rank every agent.

---

## Quick Pattern: pick ONE best agent for a specific task

Prefer `mcp__monomind__pick({ task: "<task>", kind: "agents", top: 1 })` and use `agents.ranked[0].name`. Without MCP:

```bash
TASK_DESC="<one-line description of what this agent must do>"
CATS="engineering core"
# mmpick() as defined in the Standard Selection Block
best_agent=$(mmpick -t "$TASK_DESC" --categories "$CATS" --top 1 \
  | jq -r '.agents.ranked[0].name // .agents.ranked[0].id // empty' 2>/dev/null)
best_agent="${best_agent:-coder}"   # fixed fallback: a real core agent
```

---

## Fallback

If the pick tool, the CLI and the registry all come up empty, use these safe defaults per domain (all real agent names):

| Domain | Fallback agents |
|---|---|
| idea specialists | `researcher`, `Launch Strategist`, `CRO Specialist` |
| dev decomp | `Software Architect` |
| ops decomp | `Launch Strategist` |
| build | `coder`, `tester`, `reviewer` |
| marketing / content / sales | `Competitive Content Strategist`, `Email Marketing Specialist`, `Launch Strategist` |
| review | `reviewer`, `Security Engineer` |
| research | `researcher` |
| release | `release-manager` |
| anything else | `general-purpose` |
---

## Skills from the same index

Prefer `mcp__monomind__pick({ task: "<task>", kind: "skills", top: 3 })`. Without MCP:

```bash
# Best skills for a task: Claude skills (source "platform") and Org-library
# skills (source "org") ranked together. `invoke` says how to load each one.
mmpick -t "$PROMPT" --skills --top 3 | jq -c '[.skills.ranked[] | {id, source, invoke}]'
```

A `platform` skill loads with its `invoke` through the Skill tool (a `Skill(...)` call or a
`/command`). An `org` skill's `invoke` is `mcp__monomind__org_skill_show {"name":"<name>"}`: call
that MCP tool with that input to read it, or run `npx -y monomind org skills show <name>` when the
tool is unavailable. An org skill can also be named in an org role's `skills` / `skill_pool`.

---

## Usage in a domain skill

1. If the prompt has a `[PICK]` line, start from it
2. Else call `mcp__monomind__pick` with the task and the domain's categories
3. Else set `REGISTRY`, `PROMPT`, `CATEGORIES`, `TOP_N` and run the Standard Selection Block
4. Spawn Task agents using `.name` as `subagent_type`, one per entry
5. If every step came back empty: use the fallback list above

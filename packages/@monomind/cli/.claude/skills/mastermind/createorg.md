---
name: mastermind-createorg
description: Mastermind createorg — design, configure, and persist an autonomous agent organization with named roles, hierarchy, and communication topology. Supports optional --schedule flag for self-scheduling loop orgs.
type: domain-skill
default_mode: confirm
---

# Mastermind Create Org

This skill is invoked by `mastermind:createorg` or directly via `/mastermind:createorg`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `prompt`: goal and/or role description for this org
- `org_name`: desired name for the org (slug, e.g. `content-team`); constrained to `[a-z0-9-]`
- `roles_desc`: optional explicit role list from user (e.g. "boss, content writer, reviewer, marketer, designer, middle manager")
- `schedule`: optional schedule string, e.g. `"every 30 minutes"`, `"every hour"`, `"every 2 hours"`, `"daily"`. When provided, generates a self-scheduling loop org.
- `mode`: auto | confirm
- `session_id`: session ID passed by command wrapper (snake_case input)
- `caller`: command | master

### Schedule parsing (when `--schedule` is present)

Convert the schedule string to `poll_interval_minutes`:

| Schedule string | Minutes |
|---|---|
| `every N minutes` | N |
| `every minute` | 1 |
| `every hour` | 60 |
| `every N hours` | N × 60 |
| `daily` / `every day` | 1440 |
| `every N days` | N × 1440 |

```bash
# Example: "every 30 minutes" → poll_interval_minutes=30
# "every 2 hours" → poll_interval_minutes=120
# "daily" → poll_interval_minutes=1440
```

Store the parsed value as `poll_interval_minutes` for use in Steps 4 and 6.7.

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command" (i.e. invoked directly, not by the command wrapper), load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

If `caller` is "command", use the `brain_context` already provided.

Run intake from `_intake.md` if `prompt` is vague (stop at Q3, domain is `ops`). Skip intake if `prompt` is a rich prompt per _intake.md criteria.

---

## Step 0.5 — Template Discovery (runs immediately after Step 0, before Step 1)

**Before designing roles from scratch, score the user's prompt against pre-built templates. A strong match gives the user a battle-tested scaffold — proven roles, wiring, and topology — that they can adopt or extend. Templates are scaffolds only: every role still flows through Steps 2.4 → 2.6 → 3.5 for registry-matching, generation, and validation.**

### Template Library

| ID | Name | Suggested roles | Topology | Best for |
|---|---|---|---|---|
| `content-team` | Content Production Team | boss, writer, editor, designer, social-manager | star | Blogs, newsletters, social content |
| `devbot` | Code Quality Pipeline | orchestrator, churn-analyst, complexity-scanner, coder, tester | hierarchical | Automated code quality / CI pipeline |
| `research-pod` | Research Pod | research-director, researcher, analyst, report-writer | star | Deep research, synthesis, reports |
| `legal-panel` | Legal Panel | judge, prosecutor, defender, court-clerk | mesh | Mock trial, legal sim, argument stress-test |
| `marketing-team` | Full Marketing Team | cmo, content-strategist, seo-specialist, social-media-manager, email-specialist | hierarchical | Full marketing function |
| `growth-squad` | Developer Growth Squad | growth-lead, developer-advocate, content-creator, community-manager | star | Developer product growth, community, DX |
| `code-review-squad` | Code Review Squad | lead-reviewer, security-auditor, perf-analyzer, tester | star | Automated PR review across security/perf/correctness |
| `data-team` | Data & Analytics Team | data-lead, data-engineer, ml-engineer, analyst | hierarchical | Pipelines, ML models, BI reporting |

### Matching

Count how many of each template's defining keywords appear in the user's `prompt` + `roles_desc` (template keywords = name words + role title words + "best for" domain words, all lowercased). Take the template with the highest count.

**If best score ≥ 3 keyword matches:**

**In `confirm` mode** — use `AskUserQuestion` to present the match and ask how to proceed:

```
Template found: "<Template Name>" (<N> keyword matches)
  Roles: <list>
  Topology: <topology>
  Best for: <description>

How would you like to proceed?
```

Options to offer:
- **Use this template** — pre-populate roles and topology from the template data below; proceed from Step 1 (naming) with role design pre-answered. Steps 2.4 → 2.6 → 3.5 still run as validation gates.
- **Customize this template** — pre-populate roles as a starting list, user can add/remove/rename before Step 2 processes them. Topology re-derived in Step 3.
- **Build from scratch** — ignore the template, proceed normally.

**In `auto` mode** — use the template if score ≥ 5 (high confidence); otherwise build from scratch with no prompt.

### Template Scaffold Data

Pre-populate the roles list from the chosen template. `agent_type` values are suggestions — Step 2.4 registry matching may find a better fit.

**content-team**
Roles: `boss` (coordinator, "Strategic oversight, final approval"), `writer` (Content Creator, "Write posts, articles, newsletters"), `editor` (reviewer, "Edit drafts for quality and tone"), `designer` (Monodesign, "Create visuals and brand assets"), `social-manager` (Social Media Strategist, "Distribute content across channels")
Edges: boss→writer (command), boss→designer (command), boss→social-manager (command), writer→editor (handoff), editor→boss (report), designer→boss (report), social-manager→boss (report)

**devbot**
Roles: `orchestrator` (devbot-orchestrator, "Run the 4-phase pipeline, coordinate all agents"), `churn-analyst` (churn-analyst, "Identify high-churn files from git log"), `complexity-scanner` (complexity-scanner, "Flag functions exceeding complexity thresholds"), `coder` (coder, "Implement refactors and fixes"), `tester` (tester, "Verify each fix passes tests")
Edges: orchestrator→churn-analyst (command), orchestrator→complexity-scanner (command), churn-analyst→orchestrator (report), complexity-scanner→orchestrator (report), orchestrator→coder (command), coder→tester (handoff), tester→orchestrator (report)

**research-pod**
Roles: `research-director` (coordinator, "Set research agenda, synthesize final report"), `researcher` (researcher, "Gather primary sources and data"), `analyst` (researcher, "Analyze findings, extract patterns"), `report-writer` (Content Creator, "Write and edit the deliverable report")
Edges: research-director→researcher (command), research-director→analyst (command), researcher→analyst (handoff), analyst→report-writer (handoff), report-writer→research-director (report)

**legal-panel**
Roles: `judge` (judge, "Run procedure, rule on objections, deliver verdict"), `prosecutor` (prosecutor, "Build and argue the case for conviction"), `defender` (defender, "Advocate for defendant, test prosecution's case"), `court-clerk` (court-reporter, "Record proceedings, maintain transcript")
Edges: judge→prosecutor (command), judge→defender (command), prosecutor→defender (handoff), defender→prosecutor (feedback), prosecutor→judge (report), defender→judge (report), court-clerk→judge (report)
Note: uses `mesh` topology despite 4 roles — a courtroom requires direct peer communication (prosecutor↔defender cross-examination, judge with all parties). The topology guide is a default; mesh is architecturally correct here. Step 3.5 will accept it as long as all roles are wired.

**marketing-team**
Roles: `cmo` (coordinator, "Set strategy, approve all campaigns"), `content-strategist` (Content Creator, "Plan and produce written content"), `seo-specialist` (SEO Specialist, "Keyword strategy, on-page optimization"), `social-media-manager` (Social Media Strategist, "Run social channels"), `email-specialist` (Email Marketing Specialist, "Own email sequences and drip campaigns")
Edges: cmo→content-strategist (command), cmo→seo-specialist (command), cmo→email-specialist (command), content-strategist→social-media-manager (handoff), seo-specialist→content-strategist (feedback), social-media-manager→cmo (report), email-specialist→cmo (report), content-strategist→cmo (report)

**growth-squad**
Roles: `growth-lead` (coordinator, "Own growth strategy and channel mix"), `developer-advocate` (Developer Advocate, "Demos, talks, technical content"), `content-creator` (Content Creator, "Blog, tutorials, case studies"), `community-manager` (developer-community-strategist, "GitHub, Discord, Reddit presence")
Edges: growth-lead→developer-advocate (command), growth-lead→content-creator (command), growth-lead→community-manager (command), developer-advocate→content-creator (feedback), content-creator→community-manager (handoff), community-manager→growth-lead (report), developer-advocate→growth-lead (report), content-creator→growth-lead (report)

**code-review-squad**
Roles: `lead-reviewer` (Code Reviewer, "Coordinate review, synthesize findings, approve/block PR"), `security-auditor` (Security Engineer, "Find security vulnerabilities"), `perf-analyzer` (Performance Benchmarker, "Flag performance regressions"), `tester` (tester, "Verify tests pass, check coverage")
Edges: lead-reviewer→security-auditor (command), lead-reviewer→perf-analyzer (command), lead-reviewer→tester (command), security-auditor→lead-reviewer (report), perf-analyzer→lead-reviewer (report), tester→lead-reviewer (report)

**data-team**
Roles: `data-lead` (coordinator, "Set data priorities, own data roadmap"), `data-engineer` (Data Engineer, "Build and maintain pipelines"), `ml-engineer` (AI Engineer, "Train and deploy models"), `analyst` (researcher, "Analyze data, produce business insights")
Edges: data-lead→data-engineer (command), data-lead→ml-engineer (command), data-engineer→ml-engineer (handoff), ml-engineer→analyst (handoff), analyst→data-lead (report), data-engineer→data-lead (report)

> **Template scaffolds are inputs to Step 2, not finished role specs.** Steps 2.4 (registry match), 2.5 (generate missing defs), 2.6 (completeness gate), and 3.5 (topology gate) run in full regardless of whether a template was used.

---

## Step 1 — Resolve Org Name

If `org_name` is not provided, extract the most prominent product/team noun from `prompt`, slugify it (lowercase, spaces → hyphens, strip non-`[a-z0-9-]` chars), and confirm with the user. Fallback: `org-<YYYYMMDD>`.

Reject any `org_name` that does not match `^[a-z0-9][a-z0-9-]{0,63}$`.

---

## Step 2 — Ingest Roles

Parse `roles_desc` (if provided) into a list of role titles. If not provided, derive a set of roles from `prompt` by identifying the human functions needed to achieve the goal.

**Required roles to always include** (if the prompt implies a team — **skip this rule for persona-based orgs** where the characters themselves define the structure; do not inject a generic coordinator into a celebrity panel):
- A coordinator/boss role that owns the goal and makes final decisions
- At least one executor role that does the primary work
- A reviewer or QA role if quality output is implied
- A communication layer (middle manager) if team size ≥ 4

> ⚠ **Check Step 2.3 (Persona / Character Detection) BEFORE applying this table.** If the org is persona-based (roles are named real people, celebrities, or fictional characters), skip this table for those roles and follow Step 2.3 instead.

**Role → Agent Type mapping table** (use exact `subagent_type` slug for Task tool):

| User role keyword | Agent type slug | Specialty |
|---|---|---|
| boss / ceo / director / lead / chief | `coordinator` | Strategic oversight, final decisions |
| content writer / writer / copywriter | `Content Creator` | Blog posts, copy, articles |
| content reviewer / editor | `reviewer` | Review quality, accuracy, tone (use `reviewer`, not `Code Reviewer`) |
| marketer / marketing / growth | `Growth Hacker` | Campaigns, acquisition, channels |
| designer / ui / ux / visual | `Monodesign` | Visuals, UI, brand |
| middle manager / manager | `Project Shepherd` | Sprint planning, cross-team coordination |
| engineer / developer / coder / dev | `coder` | Code implementation |
| researcher / analyst | `researcher` | Research, data, insights |
| seo / search | `SEO Specialist` | SEO, search strategy |
| social media / social | `Social Media Strategist` | Social content and engagement |
| product / product manager | `Product Manager` | Roadmap, prioritization |
| qa / tester | `tester` | Quality assurance, testing |

If a role doesn't match any keyword **and the org's domain is far from software** (legal, medical, finance, creative, etc.), do NOT force a mismatched generic type whose instructions are about the wrong domain (e.g. a court reporter mapped to the code `reviewer`). Instead coin a role-specific `agent_type` slug from the role title (slugify: `Court Reporter` → `court-reporter`, `Prosecutor` → `prosecutor`) and generate a fitting definition for it in Step 2.5. Only fall back to `general-purpose` when no sensible slug applies.

**For technical/engineering orgs** (DevBot, code quality, CI/CD, data pipelines, etc.), coin a precise domain slug for every specialized role rather than forcing it into a generic category:
- `Churn Analyst` → `churn-analyst` (git churn analysis, not a financial analyst)
- `Complexity Scanner` → `complexity-scanner` (static analysis, cyclomatic complexity)
- `Impact Assessor` → `impact-assessor` (code change blast-radius scoring)
- `Validator` → `code-validator` (applies patches, runs tests, enforces kill switch)
- `Orchestrator` (in a devbot) → `devbot-orchestrator` (4-phase pipeline boss, not generic coordinator)

The coined slug + a generated definition at `.claude/agents/generated/<slug>.md` is always better than a generic type whose system prompt talks about a completely different job.

---

## Step 2.3 — Persona / Character Detection (run BEFORE the mapping table above)

**Before applying the mapping table above, detect whether this org is persona-based:**

A role is **persona-based** if its title is:
- A named real person (e.g. "Donald Trump", "Elon Musk", "Steve Jobs")
- A well-known fictional character (e.g. "Sherlock Holmes", "Tony Stark")
- A celebrity, historical figure, or public persona referred to by name

An org is **persona-based** if ≥ 50% of its roles are character names, OR the goal/prompt contains keywords like: `panel`, `debate`, `simulation`, `roleplay`, `celebrity`, `character`, `virtual [name]`, `impersonate`, `as [name]`.

**If persona-based:**

1. **Ignore the mapping table entirely for these roles.** Do NOT map "Donald Trump" → `coder`, "Elon Musk" → `researcher`, etc.

2. **Coin a character-specific `agent_type` slug** from the character's name:
   - `Donald Trump` → `donald-trump`
   - `Sherlock Holmes` → `sherlock-holmes`
   - `Steve Jobs` → `steve-jobs`

3. **Derive skills and expertise from what is publicly known about that person**, not from generic software roles. Use your knowledge of the person's career, public persona, communication style, known positions, and characteristic behaviors. For example:
   - Donald Trump: negotiation, real-estate dealmaking, brand promotion, confrontational rhetoric, media manipulation, self-promotion, political populism
   - Elon Musk: first-principles engineering, disruptive product vision, risk-taking, rapid iteration, social media provocation, space/EV technology
   - A fictional detective: deductive reasoning, observation, criminal psychology, pattern recognition

4. **The generated agent definition** (written in Step 2.5) must read as that character — their voice, stance, known views, communication style. It is a character simulation, not a generic role.

5. **Non-character roles in the same org** (e.g. "Moderator", "Audience") should use the standard mapping table or a role-coined slug as appropriate.

**If NOT persona-based:** proceed normally with the mapping table.

---

## Step 2.4 — Registry Discovery & Matching

**Before generating anything, check whether the monomind agent registry already has a suitable base for each role.** This step runs for every non-persona role (persona roles skip to Step 2.5 directly). A registry match means the agent gets a battle-tested definition instead of a blank-slate generated one — it still gets org-specific customization, but the core expertise and instructions come from a curated source.

### 2.4.1 — Build the registry index

```bash
# Index all curated agent definitions (exclude generated/, templates/, schemas/)
AGENT_INDEX_FILE="/tmp/org-agent-registry-$$.tsv"
find .claude/agents -name "*.md" \
  -not -path "*/generated/*" \
  -not -path "*/templates/*" \
  -not -path "*/schemas/*" 2>/dev/null | while IFS= read -r file; do
  name=$(grep -m1 "^name:" "$file" 2>/dev/null | sed 's/^name:[[:space:]]*//' | tr '[:upper:]' '[:lower:]')
  desc=$(grep -m1 "^description:" "$file" 2>/dev/null | sed 's/^description:[[:space:]]*//' | cut -c1-200 | tr '[:upper:]' '[:lower:]')
  category=$(echo "$file" | awk -F'/' '{for(i=1;i<=NF;i++) if($i=="agents"){print $(i+1); exit}}' | tr '[:upper:]' '[:lower:]')
  expertise=$(awk '/^  expertise:/,/^  [a-z_-]+:/' "$file" 2>/dev/null | grep -E "^\s+- " | sed 's/.*- //' | tr '\n' ',' | tr '[:upper:]' '[:lower:]')
  printf '%s\t%s\t%s\t%s\t%s\n' "$file" "$name" "$category" "$desc" "$expertise"
done > "$AGENT_INDEX_FILE"
echo "Registry index built: $(wc -l < "$AGENT_INDEX_FILE") agents"
```

### 2.4.2 — Score each role against the registry

For **each non-persona role**, extract match keywords and score every registry entry:

```bash
# Keywords: role title words + org domain words + key responsibilities words
# Example for a "Content Writer" role in a "B2B SaaS marketing" org:
#   keywords = (content, writer, copywriter, marketing, saas, blog, copy, article)

role_keywords="<space-separated keywords derived from: role title, org goal, role responsibilities>"

best_file=""
best_name=""
best_score=0

while IFS=$'\t' read -r file name category desc expertise; do
  score=0
  for kw in $role_keywords; do
    # Title match: highest weight
    echo "$name" | grep -qi "$kw" && score=$((score + 60))
    # Category match: medium weight
    echo "$category" | grep -qi "$kw" && score=$((score + 25))
    # Description match: medium weight
    echo "$desc" | grep -qi "$kw" && score=$((score + 20))
    # Expertise match: lower weight (broader)
    echo "$expertise" | grep -qi "$kw" && score=$((score + 15))
  done
  if [ "$score" -gt "$best_score" ]; then
    best_score=$score; best_file="$file"; best_name="$name"
  fi
done < "$AGENT_INDEX_FILE"

echo "Best match for <role_id>: '${best_name}' (score ${best_score}) at ${best_file}"
```

### 2.4.3 — Interpret the score and assign result

| Score | Result | Action |
|---|---|---|
| ≥ 80 | **Strong match** — use as-is | `agent_source: "registry"`, point `agent_type` at matched `name:` |
| 50–79 | **Good match** — use with context | `agent_source: "registry"`, add `agent_context` with org-specific overrides |
| 20–49 | **Weak match** — generate but reference | `agent_source: "generated"`, mention the near-miss in generated def's `## Notes` |
| < 20 | **No match** | `agent_source: "generated"`, generate from scratch in Step 2.5 |

**When score ≥ 50 (registry match):**

1. Set `agent_type` to the matched agent's `name:` value (e.g. `"Email Marketing Specialist"`) — this is the exact slug `runorg` uses to resolve the definition at spawn time.
2. Extract the matched agent's `expertise:` block — use it directly as the role's `skills` array.
3. Set `agent_source: "registry"` and `agent_file: "<matched file path>"` on the role.
4. Write `agent_context`: a 1–3 sentence org-specific customization that the agent will receive before its core instructions. Derive it from the org's goal, the role's specific responsibilities, and any domain constraints. Example:
   - `"For this org, you are the Email Campaign Manager for AcmeCo, a B2B developer tools startup. Focus exclusively on email sequences for developer audiences. All copy must be technically accurate and jargon-appropriate."`
5. **Skip Step 2.5 for this role.** The registry definition is the instruction document.

**When score < 50 (no registry match):**

Continue to Step 2.5 to generate a definition from scratch.

> **Persona roles**: skip Step 2.4 entirely. Their definitions are always generated in Step 2.5.

**Clean up the temp index file when done:**
```bash
rm -f "$AGENT_INDEX_FILE"
```

---

## Step 2.5 — Complete Every Agent's Specification (generate what's missing)

**This step runs ONLY for roles that did NOT get a registry match in Step 2.4 (score < 50), plus all persona roles.** Registry-matched roles are already resolved — do not regenerate them.

**This is the step that makes each created agent actually work.** A role is only usable if it has: skills, an instruction document (system prompt), an input contract, and an output contract. Most of these are missing from a bare role description — **generate them, tailored to the specific agent, rather than leaving them blank.**

**For persona/character roles** (identified in Step 2.3): the generated definition must embody the character. The system prompt should open with "You are [Character Name]" and describe their personality, known views, communication style, and behavioral quirks drawn from public knowledge. Skills must reflect their real-world expertise and traits, not generic software capabilities. If the character is a living public figure, base the portrayal on documented public behavior and statements — do not invent positions they haven't taken.

For **each** role needing generation, do the following:

**1. Check whether a usable agent definition already exists.**
```bash
# Match by frontmatter `name:` first, then by filename slug, anywhere under .claude/agents
at="<agent_type>"
existing=$(grep -rils "^name:[[:space:]]*${at}\$" .claude/agents 2>/dev/null | head -1)
[ -z "$existing" ] && existing=$(find .claude/agents -iname "${at}.md" 2>/dev/null | head -1)
```
A definition is **usable** only if it exists AND its domain fits this role. A curated def whose instructions are about a different domain (e.g. `reviewer.md` = code review, applied to a "Court Reporter") does **not** count as usable — treat it as missing and coin a role-specific `agent_type` (see Step 2 note).

**2. If no usable definition exists, generate one** at `.claude/agents/generated/<agent_type>.md`. Author it specifically for this role and this org's goal — never a generic stub. Use this shape:

```markdown
---
name: <agent_type>
description: <one line — who this agent is and what it does>
capability:
  role: <agent_type>
  goal: <one sentence: the agent's standing objective in this org>
  version: "1.0.0"
  expertise:            # 4–6 concrete SKILLS this role needs to do its job well
    - <skill>
    - <skill>
  task_types:           # 3–5 kinds of work it performs
    - <task-type>
  input_type: <what this agent consumes — who/what it receives, derived from its inbound communication edges + responsibilities>
  output_type: <what this agent produces — the artifact it hands off or reports, derived from its outbound edges + responsibilities>
  model_preference: sonnet
  termination: <the condition under which this agent's job is done>
---

# <Role Title>

<1–2 sentences: the agent's identity and stance.>

## Core Responsibilities
<the role's responsibilities, expanded into numbered, actionable duties>

## Operating Guidelines
<3–6 concrete rules that keep this agent doing the right thing for its domain — what to always do, what never to do, how to handle missing inputs>

## Communication
- **Receives (input)**: <sources + what, from the inbound edges in Step 3>
- **Sends (output)**: <targets + what, from the outbound edges in Step 3>
- **Protocol**: <direct / via manager; who it reports to>

## Quality Bar
<one sentence defining "good output" for this role, so the agent can self-check>
```

Generate this content with real domain reasoning — the `expertise`, `input_type`, `output_type`, and instruction body must be specific to *this* agent (a prosecutor's skills are not a judge's). Reuse a generated def across roles of the same `agent_type` (don't regenerate if you just created it this run).

**3. Populate the org role.** Set the role's `skills` array to the def's `expertise` list (so the org config is self-describing), and keep `agent_type` pointing at the (possibly newly coined) type. Never leave `skills: []` when expertise was generated.

**4. Note generated files** for the Step 8 artifacts list.

The dashboard agent drawer and `runorg` both read these definitions (matched by `agent_type`), so generating them here is what makes the Roles/Skills/instructions show up *and* what gives each spawned agent its real instructions at run time.

---

## Step 2.6 — COMPLETENESS GATE (BLOCKING — do not proceed to Step 3 until all checks pass)

This gate prevents saving an org where the dashboard will show "No instruction document" or blank skills. **Run these checks now — one Bash call per role:**

For each role in the org:

```bash
# Check 1 — agent_type is set
role_id="<role_id>"
agent_type="<agent_type>"
[ -z "$agent_type" ] && echo "FAIL: role '$role_id' has no agent_type" && exit 1

# Check 2 — definition file exists on disk
def_file=".claude/agents/generated/${agent_type}.md"
# Also check non-generated paths
fallback=$(find .claude/agents -iname "${agent_type}.md" 2>/dev/null | head -1)
if [ ! -f "$def_file" ] && [ -z "$fallback" ]; then
  echo "FAIL: no agent definition file for '$agent_type' — generate it now before continuing"
  exit 1
fi
echo "OK: $role_id → $agent_type ✓"
```

If any check fails: go back to Step 2.5 and generate the missing file before proceeding. Do not skip this check.

**Also verify the `skills` array for each role is non-empty (≥3 items).** If `skills: []` for any role, pull the expertise from the generated definition file and populate it now.

---

## Step 2.7 — Role Overlap Detection (BLOCKING for confirm mode — run before Step 3)

**Catch duplicate roles before they burn two agent slots doing the same work. Two roles with 75% overlapping responsibilities will confuse handoffs, duplicate output, and waste tokens.**

### Algorithm

For each pair of roles, extract significant keywords from their `responsibilities` arrays (nouns and verbs, lowercased, strip articles and prepositions). Compute Jaccard similarity:

```
overlap_score = |shared_keywords| / |union_keywords|
```

**Thresholds:**

| Score | Classification | Action |
|---|---|---|
| ≥ 0.70 | High overlap — likely duplicate | Block (confirm) / auto-merge (auto) |
| 0.40–0.69 | Moderate overlap — scope unclear | Warn and suggest `feedback` edge |
| < 0.40 | OK | No action |

### In confirm mode (blocking on ≥ 0.70)

For any pair with score ≥ 0.70, use `AskUserQuestion` to present the conflict:

```
⚠ Role Overlap: "[Role A title]" and "[Role B title]" share ~<N>% of responsibilities.
  Shared: <top shared keywords>
  Unique to A: <unique keywords>
  Unique to B: <unique keywords>
```

Options:
- **Merge** — keep the higher-value role (prefer boss; prefer registry-matched over generated), absorb unique responsibilities into it, remove the other
- **Clarify** — edit responsibilities now to differentiate the two roles before continuing
- **Keep both** — add a `feedback` edge between them (they'll coordinate explicitly)

Apply the user's choice before Step 3.

For pairs with score 0.40–0.69: note the overlap in the Step 5 plan display as a WARNING. Do not block.

### In auto mode

- ≥ 0.70: Merge the lower-value role into the higher-value one. Log: `[AUTO] Merged '[B]' into '[A]' — ~<N>% overlap.`
- 0.40–0.69: Add a `feedback` edge between the pair. Log: `[AUTO] Added feedback edge [A]↔[B] — moderate overlap.`

---

## Step 3 — Suggest Communication Topology

Determine topology from team size:
- 1–3 roles → `mesh` (all communicate directly)
- 4–6 roles → `star` (boss at center, all report to boss)
- 7+ roles → `hierarchical` (boss → middle manager(s) → executors)

Build directed communication edges:

**Communication edge types:**
- `command`: top-down direction of work
- `report`: bottom-up status / output delivery
- `feedback`: peer review or critique
- `handoff`: one role passes output directly to next role in sequence

**Default edges for a 6-role org (boss, content writer, content reviewer, marketer, designer, middle manager):**
```
boss → middle_manager (command)
middle_manager → content_writer (command)
middle_manager → designer (command)
middle_manager → marketer (command)
content_writer → content_reviewer (handoff)
content_reviewer → middle_manager (report)
designer → middle_manager (report)
marketer → middle_manager (report)
middle_manager → boss (report)
boss → middle_manager (feedback)
```

Adjust for the actual roles in this run. Assign `reports_to` on each role using the derived topology.

**Deduplication:** Before adding any edge, check whether an identical `(from, to, type)` triplet already exists (e.g. a `feedback` edge added by Step 2.7 overlap detection). Skip duplicates — two identical edges produce redundant chart arrows.

**Completeness rules (every role must be properly wired — no orphans):**
- Every executor role has **≥1 inbound edge** (how work reaches it — usually a `command`) and **≥1 outbound edge** (how its output leaves — usually a `report` or `handoff`).
- Where one role's output is another's input, connect them with a `handoff` in that direction (e.g. clerk → counsel; writer → editor). Make sequential producer→consumer chains explicit.
- The coordinator/boss has an inbound `report` from each role it commands, so results flow back up.
- Peer roles that critique each other get `feedback` edges; adversarial pairs (e.g. prosecutor ↔ defender) get reciprocal `handoff` edges.
- After building edges, **derive each role's input/output contract from them**: a role's `input_type` summarizes who/what its inbound edges deliver; its `output_type` summarizes what its outbound edges carry. Feed these into the generated definition from Step 2.5 so the spec and the topology agree.

A role that ends up with no inbound or no outbound edge is a bug — re-examine the topology before saving.

---

## Step 3.5 — TOPOLOGY VALIDATION GATE (BLOCKING — do not proceed to Step 4 until all checks pass)

Build the communication array now, then validate it with these checks:

```bash
# Check 1 — at least one edge exists
edges='<communication_json_array>'
edge_count=$(echo "$edges" | jq 'length')
[ "$edge_count" -eq 0 ] && echo "FAIL: communication array is empty — define edges now" && exit 1

# Check 2 — every role has at least one inbound OR outbound edge
role_ids=("<id1>" "<id2>" ... )  # all role IDs
for rid in "${role_ids[@]}"; do
  has_edge=$(echo "$edges" | jq --arg r "$rid" '[.[] | select(.from==$r or .to==$r)] | length')
  [ "$has_edge" -eq 0 ] && echo "FAIL: role '$rid' has no communication edges — it is an orphan" && exit 1
done

# Check 3 — every non-boss executor role has at least one inbound edge (receives work)
# and at least one outbound edge (delivers output)
echo "OK: topology validated — $edge_count edges, all roles wired"
```

If any check fails: go back to Step 3 and add the missing edges. **The `communication` array must be non-empty in the saved JSON** — the dashboard Chart tab draws its arrows from this array; an empty array means a blank chart with isolated nodes and no connection lines.

---

## Step 4 — Build Org Config

Produce an org config object using the resolved topology (not hardcoded to `hierarchical`).

Ask the user (or infer from prompt) for the optional Paperclip-style fields:
- **Budget**: max token budget for this org run (e.g. 500000 tokens). Use `unlimited` if not specified.
- **Governance**: approval policy — `auto` (agents act freely) | `board` (sensitive actions require `/mastermind:approve`) | `strict` (all external actions need approval)
- **Adapter**: which AI model/adapter the CEO agent should use (e.g. `claude-sonnet-4-6`, `claude-opus-4-7`). Default: `claude-sonnet-4-6`.

```json
{
  "name": "<org_name>",
  "goal": "<the goal the org exists to achieve>",
  "created_at": "<ISO8601>",
  "mode": "daemon",
  "topology": "<mesh | star | hierarchical — from Step 3>",
  "status": "<'stopped' if --schedule provided; 'active' otherwise>",
  "roles": [
    {
      "id": "<slug>",
      "title": "<display title>",
      "agent_type": "<subagent_type slug — from Step 2.3 character slug for persona roles, Step 2.4 registry name, or Step 2.5 mapping table>",
      "agent_source": "<'registry' if matched in Step 2.4 | 'generated' if created in Step 2.5 | 'coined' if a new domain-specific slug was invented>",
      "agent_file": "<path to matched agent definition — set only when agent_source='registry', e.g. '.claude/agents/marketing/marketing-launch-strategist.md'; omit otherwise>",
      "agent_context": "<org-specific customization note for this role — 1-3 sentences; set for all registry roles and optionally for generated roles; null if none needed>",
      "responsibilities": ["<1-3 bullet responsibilities>"],
      "reports_to": "<role id or null>",
      "skills": ["<populated from the matched or generated def's expertise — never left empty>"],
      "adapter_config": {
        "model": "<claude model id>",
        "max_tokens": 8192
      }
    }
  ],
  "communication": [
    {
      "from": "<role_id>",
      "to": "<role_id>",
      "type": "command | report | feedback | handoff",
      "protocol": "direct"
    }
  ],
  "governance": {
    "policy": "auto | board | strict",
    "approvals_file": ".monomind/orgs/<org_name>-approvals.json"
  },
  "board_id": "<uuid — filled in Step 6 after board creation>",
  "todo_col_id": "<uuid — filled in Step 6>",
  "doing_col_id": "<uuid — filled in Step 6>",
  "done_col_id": "<uuid — filled in Step 6>",
  "board_space": "<org_name>",
  "board_name": "org-tasks",
  "run_config": {
    "checkpoint_interval_min": 30,
    "max_concurrent_agents": 6,
    "memory_namespace": "org:<org_name>",
    "budget_tokens": "<number or 0 for unlimited>",
    "alert_threshold": 0.8,
    "ceo_adapter": "<model id>"
  },
  "loop": "<only included when --schedule was provided; see below>",
  "milestones": "<only included for scheduled orgs with discrete outcomes; see below>"
}
```

**If the org has a defined finish line** (discrete outcomes, not a forever-running monitor), include a `milestones` array. In confirm mode, ask: "Does this org have a defined finish line? If so, describe up to 5 milestones." Derive milestones from the goal if the user describes discrete outcomes. Omit this field entirely for continuous-monitor orgs (e.g. "watch PRs forever", "keep docs in sync").

> **Milestones are only auto-checked for scheduled orgs** (`--schedule` flag). The Milestone Check runs inside the loop prompt (Step 6.7) — it requires a loop to execute. For non-scheduled orgs, milestones are recorded in the JSON as documentation but are never automatically evaluated or transitioned to `"complete"`. If you add milestones to a non-scheduled org, plan to check them manually via `/mastermind:org-status --org <name>`.

```json
{
  "milestones": [
    {
      "id": "<milestone-slug>",
      "description": "<what this milestone represents>",
      "done_when": "<observable condition — e.g. '5 blog posts published and indexed', 'all CVEs in the audit report patched', 'first paying customer acquired'>",
      "status": "pending"
    }
  ]
}
```

**If `--schedule` was provided**, include these two additional top-level fields in the org config:

```json
{
  "status": "stopped",
  "loop": {
    "poll_interval_minutes": "<parsed from schedule string>",
    "last_run": null,
    "next_run": null,
    "run_prompt_file": ".monomind/loops/<org_name>.md"
  }
}
```

`status` starts as `"stopped"`. The org does not run until `/mastermind:runorg --org <org_name>` is called (which transitions it to `"active"`).

---

## Step 5 — Show Plan and Confirm (confirm mode)

Render the org plan in a clear human-readable format:

```
╔══════════════════════════════════════════════════╗
║  ORG: <org_name>                                 ║
║  GOAL: <goal>                                    ║
╚══════════════════════════════════════════════════╝

ROLES  (N roles — all must have agent_type + skills before "go")
─────
• [boss] CEO / Boss
    Agent type:      coordinator
    Source:          registry (.claude/agents/core/coordinator.md) ✓
    Skills:          strategic oversight, decision-making, org management
    Reports to:      (none — top of hierarchy)
    Responsibilities: Strategic oversight, final approval
    Context:         "For this org, you lead the B2B content team. Prioritize pipeline-focused content."

• [email_manager] Email Campaign Manager
    Agent type:      Email Marketing Specialist
    Source:          registry (.claude/agents/marketing/marketing-email-specialist.md) ✓  [score: 85]
    Skills:          email sequence design, drip campaigns, A/B testing, lifecycle email
    Reports to:      boss
    Responsibilities: Write and optimize email sequences
    Context:         "Focus on developer-audience cold outreach. Tone: direct, technical, no fluff."

• [middle_manager] Middle Manager
    Agent type:      project-shepherd
    Source:          generated (.claude/agents/generated/project-shepherd.md) ✓
    Skills:          sprint planning, cross-team coordination, status tracking
    Reports to:      boss
    Responsibilities: Sprint planning, cross-team coordination
    Context:         (none)

  ... (all roles — each showing agent_type, source [registry/generated + file], skills, and context)

COMMUNICATION TOPOLOGY  (N edges — must be non-zero)
──────────────────────
boss → middle_manager           (command)
middle_manager → content_writer (command)
content_writer → content_reviewer (handoff)
content_reviewer → middle_manager (report)
middle_manager → boss           (report)
  ... (all edges — every role must appear here at least once)

SETTINGS
────────
Topology: <derived>  |  Mode: persistent daemon
Memory: org:<org_name>  |  Board: <org_name>/org-tasks
Checkpoint every: 30 min  |  Max agents: 6
Schedule: <"every <poll_interval_minutes> minutes" if --schedule; otherwise "manual (no auto-schedule)">
Status: <"stopped (run /mastermind:runorg --org <org_name> to activate)" if --schedule; otherwise "—">

Type "go" to save this org, or describe changes.
```

In **auto** mode, skip the confirmation prompt.

If the user requests changes, apply them and re-render. Repeat until confirmed.

---

## Step 6 — Save Org Config

Set shell variables from the resolved inputs (use the actual `org_name` value from Step 1 and `session_id` input):

```bash
org_name="<resolved org name from Step 1>"   # e.g. "content-team"
session_id="<session_id input>"               # passed by command wrapper
orgJson=".monomind/orgs/${org_name}.json"
mkdir -p .monomind/orgs
```

Write the confirmed org config as JSON using `jq` to guarantee valid encoding:

```bash
# Build the config JSON from the confirmed org plan and write atomically.
# Set shell variables from the confirmed plan before running this block:
#   governance_policy     — "auto" | "board" | "strict"  (from Step 4)
#   budget_tokens_val     — integer or 0 for unlimited     (from Step 4)
#   ceo_adapter           — model id string                (from Step 4)
#   poll_interval_minutes — integer (from --schedule), or "" if no schedule
jq -n \
  --arg name "$org_name" \
  --arg goal "$goal" \
  --arg topology "$topology" \
  --argjson roles "$roles_json" \
  --argjson communication "$communication_json" \
  --arg gov_policy "${governance_policy:-auto}" \
  --argjson budget_tokens "${budget_tokens_val:-0}" \
  --arg ceo_adapter "${ceo_adapter:-claude-sonnet-4-6}" \
  '{name:$name,goal:$goal,mode:"daemon",topology:$topology,status:"active",
    created_at:(now|todate),roles:$roles,communication:$communication,
    governance:{policy:$gov_policy,approvals_file:(".monomind/orgs/"+$name+"-approvals.json")},
    board_space:$name,board_name:"org-tasks",
    run_config:{
      checkpoint_interval_min:30,
      max_concurrent_agents:6,
      memory_namespace:("org:"+$name),
      budget_tokens:$budget_tokens,
      alert_threshold:0.8,
      ceo_adapter:$ceo_adapter
    }}' \
  > "${orgJson}.tmp" && mv "${orgJson}.tmp" "$orgJson"
```

**If `--schedule` was provided**, patch the saved config with `status` and `loop`:

```bash
# Only run this block when poll_interval_minutes is set (i.e. --schedule was used)
tmp="${orgJson}.tmp"
jq \
  --argjson interval "$poll_interval_minutes" \
  --arg run_prompt_file ".monomind/loops/${org_name}.md" \
  '. + {
    status: "stopped",
    loop: {
      poll_interval_minutes: $interval,
      last_run: null,
      next_run: null,
      run_prompt_file: $run_prompt_file
    }
  }' \
  "$orgJson" > "$tmp" && mv "$tmp" "$orgJson"
```

Create the monotask space, board, and default columns (space is required — abort before creating board if space fails):
```bash
# Step 1 — Space (required first)
space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$org_name" '$2==n{print $1}' | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$org_name" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$org_name' — verify monotask is installed (run: monotask --version)"; exit 1; }

# Step 2 — Board (created only after space is confirmed)
board_id=$(monotask board create "org-tasks" --json | jq -r '.id // empty')
[ -z "$board_id" ] && { echo "ERROR: Failed to create monotask board"; exit 1; }

# Step 3 — Link board to space immediately
monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true

# Step 4 — Columns
todo_col_id=$(monotask column create "$board_id" "Todo"  --json | jq -r '.id // empty')
doing_col_id=$(monotask column create "$board_id" "Doing" --json | jq -r '.id // empty')
done_col_id=$(monotask column create "$board_id" "Done"  --json | jq -r '.id // empty')
[ -z "$todo_col_id" ]  && { echo "ERROR: Failed to create 'Todo' column on board $board_id"; exit 1; }
[ -z "$doing_col_id" ] && { echo "ERROR: Failed to create 'Doing' column on board $board_id"; exit 1; }
[ -z "$done_col_id" ]  && { echo "ERROR: Failed to create 'Done' column on board $board_id"; exit 1; }
```

Patch the saved org config with the board and column IDs:
```bash
tmp="${orgJson}.tmp"
jq --arg board_id "$board_id" \
   --arg todo_col_id "$todo_col_id" \
   --arg doing_col_id "$doing_col_id" \
   --arg done_col_id "$done_col_id" \
   '. + {board_id:$board_id,todo_col_id:$todo_col_id,doing_col_id:$doing_col_id,done_col_id:$done_col_id}' \
   "$orgJson" > "$tmp" && mv "$tmp" "$orgJson"
```

**POST-SAVE VALIDATION (run immediately after saving — abort if either check fails):**

```bash
# Check 1 — communication array is non-empty (dashboard Chart tab requires this for arrows)
comm_count=$(jq '.communication | length' "$orgJson" 2>/dev/null || echo 0)
if [ "$comm_count" -eq 0 ]; then
  echo "ERROR: Saved org has empty communication array — dashboard Chart will show isolated nodes with no arrows."
  echo "Fix: go back to Step 3 and Step 3.5, define edges, then re-save."
  exit 1
fi
echo "✓ Communication: $comm_count edges saved"

# Check 2 — every role has agent_type set
bad_roles=$(jq -r '.roles[] | select((.agent_type // "") == "") | .id' "$orgJson" 2>/dev/null)
if [ -n "$bad_roles" ]; then
  echo "ERROR: These roles have no agent_type — dashboard will show '?' for each:"
  echo "$bad_roles"
  echo "Fix: go back to Step 2 / Step 2.5 and set agent_type for each role, then re-save."
  exit 1
fi
echo "✓ All roles have agent_type set"

# Check 3 — every role has skills (non-empty array)
empty_skills=$(jq -r '.roles[] | select((.skills // []) | length == 0) | .id' "$orgJson" 2>/dev/null)
if [ -n "$empty_skills" ]; then
  echo "WARNING: These roles have empty skills arrays — dashboard Skills tab will show nothing:"
  echo "$empty_skills"
  echo "Fix: populate skills from each role's generated agent definition."
fi

echo "✓ Org config validated — org is ready to run"
```

---

## Step 6.5 — Seed Memory Namespace

**Prime the org's memory namespace so agents start with context instead of cold-starting. On day one the boss and every team member can query `org:<org_name>` and immediately know the org's goal, their role, and their peers.**

```bash
NAMESPACE="org:${org_name}"
ROLE_COUNT=$(jq '.roles | length' "$orgJson" 2>/dev/null || echo "0")

# 1 — Org-level context (all agents can read this at any time)
npx monomind@latest memory store \
  --key "org-context" \
  --value "Org: ${org_name}. Goal: $(jq -r '.goal' "$orgJson"). Topology: $(jq -r '.topology' "$orgJson"). Roles: $(jq -r '[.roles[].title] | join(", ")' "$orgJson"). Governance: $(jq -r '.governance.policy' "$orgJson")." \
  --namespace "$NAMESPACE" 2>/dev/null || echo "[warn] memory store failed for org-context — continuing"

# 2 — Per-role brief (each agent reads its own key at spawn time)
jq -r '.roles[] | [.id, .title, .agent_type, (.reports_to // "none"), (.responsibilities // [] | if type=="array" then join("; ") else . end)] | join("\t")' "$orgJson" | \
while IFS=$'\t' read -r role_id title agent_type reports_to responsibilities; do
  npx monomind@latest memory store \
    --key "role:${role_id}" \
    --value "You are the ${title} (${agent_type}) in the ${org_name} org. Reporting to: ${reports_to}. Responsibilities: ${responsibilities}." \
    --namespace "$NAMESPACE" 2>/dev/null || true
done

echo "✓ Memory namespace '${NAMESPACE}' seeded (org context + ${ROLE_COUNT} role briefs)"
```

> **If any `memory store` call fails** (daemon not running, storage full): the warning is printed and the script continues — memory seeding is best-effort. The org is valid without it.

---

## Step 6.7 — Generate Loop Prompt File (scheduled orgs only)

**Skip this step if `--schedule` was NOT provided.**

If `poll_interval_minutes` is set, generate the self-scheduling loop prompt at `.monomind/loops/<org_name>.md`.

This file is the single source of truth for one scheduled iteration. It is passed verbatim as the `prompt` argument to `ScheduleWakeup` at the end of every iteration — the loop is self-perpetuating as long as `status == "active"`.

**Loop prompt structure:**

The file must follow this exact template (substitute actual values for all `<placeholders>`):

````markdown
# <org_name> — Loop Prompt

**Controlled by:** `.monomind/orgs/<org_name>.json` → `status` field
**Start:** `/mastermind:runorg --org <org_name>` (sets `status: "active"` and runs first iteration)
**Stop:** `/mastermind:stoporg --org <org_name>` (sets `status: "stopped"` — next wakeup exits without rescheduling)
**Pause (HIL):** set `status: "paused"` in `.monomind/orgs/<org_name>.json` — loop keeps waking up but skips work until status returns to `"active"`

---

## Step 0 — Status Gate (REQUIRED FIRST — do not skip)

```bash
ORG_FILE=".monomind/orgs/<org_name>.json"
LOOP_STATUS=$(jq -r '.status // "stopped"' "$ORG_FILE" 2>/dev/null || echo "stopped")
```

- If `LOOP_STATUS == "active"` → continue to Step 1.
- If `LOOP_STATUS == "paused"` → print "Org '<org_name>' is paused — skipping iteration. Jump directly to Schedule Next." Do NOT run Steps 1–N.
- If `LOOP_STATUS == "complete"` → print "Org '<org_name>' mission accomplished — all milestones done. Not rescheduling." and stop. **Do NOT call ScheduleWakeup.**
- If anything else (including `"stopped"`) → print "Org '<org_name>' status is '$LOOP_STATUS' — exiting loop. **Do NOT call ScheduleWakeup.**" and stop.

---

## Step 1 — Record Iteration Start

```bash
ORG_FILE=".monomind/orgs/<org_name>.json"
tmp="${ORG_FILE}.tmp"
jq '.loop.last_run = (now|todate)' "$ORG_FILE" > "$tmp" && mv "$tmp" "$ORG_FILE"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
# Unique run ID — used to thread all events in the Chat tab under one session
RUN_ID="run-$(date -u +%Y%m%dT%H%M%S)"
# Capture Claude project dir for per-agent token tracking
CLAUDE_PROJECT_DIR="$HOME/.claude/projects/$(echo "$REPO_ROOT" | tr '/' '-' | sed 's/^-//')"

# Comm helper — emits org:comms so Chat tab shows agent-to-agent messages
_comm() {
  local _from="$1" _to="$2" _msg="$3"
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(jq -cn \
      --arg org "<org_name>" \
      --arg runId "$RUN_ID" \
      --arg from "$_from" \
      --arg to "$_to" \
      --arg msg "$_msg" \
      '{type:"org:comms",org:$org,runId:$runId,from:$from,to:$to,msg:$msg,ts:(now*1000|floor)}')" || true
}

# Register this run with the server — creates run file and enables Chat tab dropdown
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg org "<org_name>" \
    --arg runId "$RUN_ID" \
    --arg goal "<goal>" \
    '{type:"run:start",org:$org,runId:$runId,goal:$goal,ts:(now*1000|floor)}')" || true
```

---

## [Org-specific iteration steps]

<IMPORTANT: Generate the actual work steps here from the org's goal and roles. These are NOT generic placeholders — write real, actionable steps derived from the org's goal, roles, and communication topology.>

<For a GitHub issue-resolver org, these would be: find next issue, claim it, implement, test, deploy, report.>
<For a content org, these would be: check content calendar, assign writers, review drafts, publish.>
<Derive from orgConfig.goal and orgConfig.roles[].responsibilities — be specific.>

**REQUIRED — include these patterns at every agent handoff:**

1. **Before spawning each agent**, snapshot the Claude project JSONL files and emit a `_comm` from the dispatching role to the receiving role describing the task:
   ```bash
   JSONL_SNAP_<N>=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
   _comm "<dispatcher-role-id>" "<agent-role-id>" "Task: <what the agent is being asked to do>"
   ```

2. **After the agent returns**, emit a `_comm` from that agent back to its caller with the result summary, then emit its token usage:
   ```bash
   JSONL_SNAP_<N+1>=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
   NEW_JSONL=$(comm -13 <(echo "$JSONL_SNAP_<N>") <(echo "$JSONL_SNAP_<N+1>") | head -1)
   _comm "<agent-role-id>" "<dispatcher-role-id>" "Result: <one-sentence summary of what the agent returned>"
   if [ -n "$NEW_JSONL" ] && [ -f "$NEW_JSONL" ]; then
     USAGE=$(python3 -c "
   import json, sys
   tin=tout=0
   for l in open(sys.argv[1]):
     try:
       d=json.loads(l)
       u=d.get('message',{}).get('usage',{})
       tin+=u.get('input_tokens',0); tout+=u.get('output_tokens',0)
     except: pass
   cost=tin*3e-6+tout*15e-6
   print(json.dumps({'tokens_in':tin,'tokens_out':tout,'cost_usd':round(cost,6)}))
   " "$NEW_JSONL" 2>/dev/null || echo '{"tokens_in":0,"tokens_out":0,"cost_usd":0}')
     curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
       -H "Content-Type: application/json" \
       -d "$(echo "$USAGE" | jq \
         --arg org "<org_name>" \
         --arg role "<agent-role-id>" \
         --arg runId "$RUN_ID" \
         '. + {type:"agent:usage",org:$org,role:$role,runId:$runId,ts:(now*1000|floor|tostring|tonumber)}')" || true
   fi
   ```

3. Use the actual content from the agent's return value in the `_comm` `msg` field — not a generic placeholder. The Chat tab shows this text verbatim.

4. At cycle end (before Schedule Next), emit the completion comms and event:
   ```bash
   _comm "<boss-role-id>" "sys" "Cycle complete: <one-line summary of what was accomplished>"
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "$(jq -cn \
       --arg org "<org_name>" \
       --arg runId "$RUN_ID" \
       '{type:"org:cycle:complete",org:$org,runId:$runId,ts:(now*1000|floor)}')" || true
   ```

---

## Milestone Check (only if org has milestones — run after org-specific iteration steps)

```bash
ORG_FILE=".monomind/orgs/<org_name>.json"
HAS_MILESTONES=$(jq '(.milestones // []) | length > 0' "$ORG_FILE" 2>/dev/null || echo "false")
```

If `HAS_MILESTONES=true`:

1. Spawn the boss agent with a milestone review task:
   ```
   Review the milestones in .monomind/orgs/<org_name>.json.
   For each milestone with status "pending", determine if its `done_when` condition
   is now met based on the work completed this cycle.
   Return a JSON array of milestone IDs that are now complete (empty array if none).
   ```

2. For each milestone ID returned as complete:
   ```bash
   tmp="${ORG_FILE}.tmp"
   jq --arg mid "<milestone_id>" \
      '(.milestones[] | select(.id == $mid) | .status) = "complete"' \
      "$ORG_FILE" > "$tmp" && mv "$tmp" "$ORG_FILE"

   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "$(jq -cn \
       --arg org "<org_name>" \
       --arg mid "<milestone_id>" \
       --arg runId "$RUN_ID" \
       '{type:"org:milestone:complete",org:$org,milestone:$mid,runId:$runId,ts:(now*1000|floor)}')" || true
   ```

3. After patching, check if all milestones are now complete:
   ```bash
   PENDING_COUNT=$(jq '[.milestones[] | select(.status == "pending")] | length' "$ORG_FILE" 2>/dev/null || echo "-1")
   if [ "$PENDING_COUNT" -eq 0 ]; then
     echo "✓ All milestones complete — mission accomplished."
     tmp="${ORG_FILE}.tmp"
     jq '.status = "complete"' "$ORG_FILE" > "$tmp" && mv "$tmp" "$ORG_FILE"
     curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
       -H "Content-Type: application/json" \
       -d "$(jq -cn \
         --arg org "<org_name>" \
         --arg runId "$RUN_ID" \
         '{type:"org:complete",org:$org,runId:$runId,ts:(now*1000|floor)}')" || true
     # Proceed to Schedule Next — the re-check of status there will see "complete" and not reschedule.
   fi
   ```

---

## Schedule Next (ONLY if status is active or paused)

Re-check org status before rescheduling:

```bash
ORG_FILE=".monomind/orgs/<org_name>.json"
LOOP_STATUS=$(jq -r '.status // "stopped"' "$ORG_FILE" 2>/dev/null || echo "stopped")
```

If `LOOP_STATUS == "active"` or `LOOP_STATUS == "paused"`:

1. Read this loop prompt file verbatim:
   ```bash
   LOOP_PROMPT=$(cat .monomind/loops/<org_name>.md)
   ```

2. Call `ScheduleWakeup` with:
   - `delaySeconds`: `<poll_interval_minutes * 60>`
   - `reason`: `"<org_name>: next scheduled poll (every <poll_interval_minutes> min)"`
   - `prompt`: the full contents of `$LOOP_PROMPT`

3. Update `next_run` in the org JSON:
   ```bash
   ORG_FILE=".monomind/orgs/<org_name>.json"
   tmp="${ORG_FILE}.tmp"
   next_ts=$(( $(date +%s) + <poll_interval_minutes * 60> ))
   next_iso=$(date -u -r "$next_ts" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
     || date -u -d "@$next_ts" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
     || python3 -c "import datetime; print(datetime.datetime.utcfromtimestamp($next_ts).strftime('%Y-%m-%dT%H:%M:%SZ'))")
   jq --arg next "$next_iso" '.loop.next_run = $next' "$ORG_FILE" > "$tmp" && mv "$tmp" "$ORG_FILE"
   ```

4. Emit `org:loop:scheduled` event:
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "$(jq -cn --arg org "<org_name>" --arg next "$next_iso" --arg proj "$REPO_ROOT" \
       '{type:"org:loop:scheduled",org:$org,next_run:$next,project:$proj,ts:(now*1000|floor)}')" || true
   ```

If `LOOP_STATUS` is anything else (e.g. `"stopped"`) → print "Org '<org_name>' loop ended — not rescheduling." and exit.
````

**Before writing: substitute ALL `<org_name>` tokens with the actual resolved org name string (the value from Step 1, e.g. `research-pod`), and all `<poll_interval_minutes>` tokens with the numeric value. These are template placeholders — the written file must contain no angle-bracket tokens. Every `ORG_FILE=".monomind/orgs/<org_name>.json"` becomes `ORG_FILE=".monomind/orgs/research-pod.json"`, every `cat .monomind/loops/<org_name>.md` becomes `cat .monomind/loops/research-pod.md`, etc. Leaving any `<...>` token unexpanded will cause shell failures at loop execution time.**

**Write this file to disk:**

```bash
mkdir -p .monomind/loops
# Write the generated loop prompt (with all placeholders substituted)
# to .monomind/loops/<org_name>.md  (← substitute this path too)
```

Use the Write tool (not Bash echo/cat) to write the file so the content is verbatim.

The org-specific iteration steps (the block between Step 1 and "Schedule Next") must be **generated from the actual org** — goal, roles, responsibilities — not left as generic placeholders.

---

## Step 7 — Emit Dashboard Events

Read values from the saved JSON file and emit two events: `domain:complete` (for the session stream) and `org:create` (so the dashboard Orgs panel registers the new org immediately):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
orgName=$(jq -r '.name' "$orgJson")
goal_val=$(jq -r '.goal' "$orgJson")
rolesCount=$(jq '.roles | length // 0' "$orgJson")

# domain:complete — for session correlation
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg orgName "$orgName" \
    --arg goal "$goal_val" \
    --argjson rolesCount "$rolesCount" \
    '{type:"domain:complete",session:$session,domain:"ops",status:"complete",
      org:$orgName,goal:$goal,roles_count:$rolesCount,ts:(now*1000|floor)}')" || true

# org:create — so handleOrgEvent routes it to the Orgs panel event log and SSE triggers list refresh
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$orgName" \
    --arg goal "$goal_val" \
    --arg proj "$(pwd)" \
    '{type:"org:create",session:$session,org:$org,goal:$goal,project:$proj,ts:(now*1000|floor)}')" || true
```

---

## Step 8 — Return Output

```yaml
domain: ops
status: complete
artifacts:
  - path: .monomind/orgs/<org_name>.json
    type: config
  - path: .claude/agents/generated/<agent_type>.md
    type: agent-definition
    note: "one per role with agent_source='generated' — omit roles resolved from the registry"
  - path: .claude/agents/<category>/<agent_file>.md
    type: agent-definition-reference
    note: "registry agents — already exist, no new file written; listed here for transparency"
  - path: .monomind/loops/<org_name>.md
    type: loop-prompt
    note: "only present when --schedule was used; omit otherwise"
decisions:
  - what: "Org <org_name> created with N roles"
    why: "Role mapping derived from goal and user description"
    confidence: 0.85
    outcome: shipped
lessons:
  - what_worked: "Auto-suggested roles matched user intent"
  - what_didnt: ""
next_actions:
  - "Run /mastermind:runorg --org <org_name> to start the organization"
  - "Edit .monomind/orgs/<org_name>.json to customize roles or communication"
  - "[scheduled orgs only] Run /mastermind:stoporg --org <org_name> to stop the loop"
  - "[scheduled orgs only] Run /mastermind:orgs to see all org statuses"
board_url: "monotask://<org_name>/org-tasks"
run_id: "<current UTC datetime as ISO8601, e.g. via $(date -u +%Y-%m-%dT%H:%M:%SZ)>"
```

Print confirmation:
```
✓ Org "<org_name>" saved to .monomind/orgs/<org_name>.json
  → Run: /mastermind:runorg --org <org_name>
```

If `--schedule` was provided, also print:
```
✓ Loop prompt saved to .monomind/loops/<org_name>.md
  Schedule: every <poll_interval_minutes> minutes
  Status: stopped (org will not run until /mastermind:runorg --org <org_name>)

  Lifecycle:
    Start: /mastermind:runorg --org <org_name>
    Stop:  /mastermind:stoporg --org <org_name>
    List:  /mastermind:orgs
```

---

## Step 9 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.

---
name: project-board-sync
description: Synchronizes swarm tasks with GitHub Projects boards — cards, custom fields, status columns, and progress views
when_to_use: Use when swarm or team tasks should be mirrored onto a GitHub Projects board and kept in sync
tags: [github, projects, project-management, tracking]
category: github
---

# Project Board Sync - GitHub Projects Integration

## Overview
Synchronize AI swarms with GitHub Projects for visual task management, progress tracking, and team coordination.

All board work goes through `gh project` (and `gh api graphql` where `gh project` has no subcommand). The `project` token scope is required: `gh auth refresh -s project`. There is no monomind board command; this agent reads swarm tasks (`monomind task list`) and mirrors them onto the board.

## Core Features

### 1. Board Initialization
```bash
# Find the project number and node ID
OWNER=my-org
PROJECT_NUMBER=$(gh project list --owner $OWNER --format json \
  --jq '.projects[] | select(.title == "Development Board") | .number')
PROJECT_ID=$(gh project view $PROJECT_NUMBER --owner $OWNER --format json --jq .id)

# Create project fields for swarm tracking
gh project field-create $PROJECT_NUMBER --owner $OWNER \
  --name "Swarm Status" \
  --data-type "SINGLE_SELECT" \
  --single-select-options "pending,in_progress,completed"
gh project field-create $PROJECT_NUMBER --owner $OWNER --name "Agent" --data-type TEXT

# Field and option IDs, needed by item-edit
gh project field-list $PROJECT_NUMBER --owner $OWNER --format json > /tmp/fields.json
```

Views (board, table, roadmap) are created in the GitHub UI; `gh project` cannot create them.

### 2. Task Synchronization
```bash
# Swarm tasks on the local side
npx monomind task list --all

# Map a task status to the board's Status option and set it on an item
STATUS_FIELD=$(jq -r '.fields[] | select(.name == "Status") | .id' /tmp/fields.json)
option_id() { jq -r --arg n "$1" '.fields[] | select(.name == "Status") | .options[] | select(.name == $n) | .id' /tmp/fields.json; }

ITEM_ID=$(gh project item-add $PROJECT_NUMBER --owner $OWNER \
  --url "https://github.com/$OWNER/repo/issues/456" --format json --jq .id)

gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$STATUS_FIELD" --single-select-option-id "$(option_id 'In Progress')"
```

### 3. Real-time Updates
GitHub Projects has built-in workflows (Project → Workflows in the UI) that move items when an issue is closed or a PR is merged. Turn those on for status transitions and use this agent for the fields GitHub does not set, such as Agent and Swarm Status.

## Configuration

### Board Mapping Configuration
```yaml
# .github/board-sync.yml — read by this agent when mapping tasks to fields
version: 1
project:
  name: "AI Development Board"
  number: 1

mapping:
  # Map swarm task status to board columns
  status:
    pending: "Backlog"
    assigned: "Ready"
    in_progress: "In Progress"
    review: "Review"
    completed: "Done"
    blocked: "Blocked"

  # Map agent types to labels
  agents:
    coder: "🔧 Development"
    tester: "🧪 Testing"
    analyst: "📊 Analysis"
    designer: "🎨 Design"
    architect: "🏗️ Architecture"

  # Map priority to project fields
  priority:
    critical: "🔴 Critical"
    high: "🟡 High"
    medium: "🟢 Medium"
    low: "⚪ Low"

  # Custom fields
  fields:
    - name: "Agent Count"
      type: number
      source: task.agents.length
    - name: "Complexity"
      type: select
      source: task.complexity
    - name: "ETA"
      type: date
      source: task.estimatedCompletion
```

### View Configuration
```javascript
// Suggested board views (create them in the GitHub UI)
{
  "views": [
    {
      "name": "Swarm Overview",
      "type": "board",
      "groupBy": "status",
      "filters": ["is:open"],
      "sort": "priority:desc"
    },
    {
      "name": "Agent Workload",
      "type": "table",
      "groupBy": "assignedAgent",
      "columns": ["title", "status", "priority", "eta"],
      "sort": "eta:asc"
    },
    {
      "name": "Sprint Progress",
      "type": "roadmap",
      "dateField": "eta",
      "groupBy": "milestone"
    }
  ]
}
```

## Automation Features

### 1. Auto-Assignment
```bash
# Set the Agent text field on an item
AGENT_FIELD=$(jq -r '.fields[] | select(.name == "Agent") | .id' /tmp/fields.json)
gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$AGENT_FIELD" --text "coder"

# Or assign the underlying issue to a person
gh issue edit 456 --add-assignee octocat
```

### 2. Progress Tracking
```bash
# Count items per Status
gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json \
  --jq '.items | group_by(.status) | map({status: (.[0].status // "No status"), count: length})'
```

### 3. Smart Card Movement
```bash
# Move items whose issue is closed to Done
gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json \
  --jq '.items[] | select(.content.type == "Issue" and .status != "Done") | [.id, .content.url] | @tsv' |
while IFS=$'\t' read -r id url; do
  if [ "$(gh issue view "$url" --json state -q .state)" = "CLOSED" ]; then
    gh project item-edit --id "$id" --project-id "$PROJECT_ID" \
      --field-id "$STATUS_FIELD" --single-select-option-id "$(option_id Done)"
  fi
done
```

## Board Commands

### Create Cards from Issues
```bash
# List issues with label
ISSUES=$(gh issue list --label "enhancement" --json url)

# Add issues to project
echo "$ISSUES" | jq -r '.[].url' | while read -r url; do
  gh project item-add $PROJECT_NUMBER --owner $OWNER --url "$url"
done
```

### Draft Cards
```bash
# A card for a swarm task that has no issue yet
gh project item-create $PROJECT_NUMBER --owner $OWNER \
  --title "Implement user authentication" --body "Agents: architect, coder, tester"
```

### Bulk Operations
```bash
# Label every blocked item's issue
gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json \
  --jq '.items[] | select(.status == "Blocked" and .content.type == "Issue") | .content.url' |
  while read -r url; do gh issue edit "$url" --add-label "needs-attention"; done

# Archive finished items
gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json \
  --jq '.items[] | select(.status == "Done") | .id' |
  while read -r id; do gh project item-archive $PROJECT_NUMBER --owner $OWNER --id "$id"; done
```

## Advanced Synchronization

### 1. Multi-Board Sync
```bash
# An issue can sit on several boards; add it to the next board when it is ready
gh project item-add 2 --owner $OWNER --url "https://github.com/$OWNER/repo/issues/456"
```

### 2. Cross-Organization Sync
```bash
# Read one board, add the same issues to a board owned by another org
gh project item-list 1 --owner org1 --format json --jq '.items[].content.url' |
  while read -r url; do gh project item-add 7 --owner org2 --url "$url"; done
```

## Visualization & Reporting

### Board Analytics
```bash
# Fetch project data
PROJECT_DATA=$(gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json)

# Cycle time of closed issues on the board
echo "$PROJECT_DATA" | jq -r '.items[] | select(.content.type == "Issue") | .content.url' |
  while read -r url; do
    gh issue view "$url" --json number,createdAt,closedAt,labels,assignees
  done | jq -s 'map(select(.closedAt)) |
    map({number, hours: (((.closedAt | fromdate) - (.createdAt | fromdate)) / 3600)})'
```

### Reports
```bash
# Markdown sprint summary: items per status
gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json --jq '
  "## Sprint summary\n" +
  (.items | group_by(.status) | map("- **\(.[0].status // "No status")**: \(length)") | join("\n"))'
```

## Workflow Integration

### Sprint Management
Use an Iteration field for sprints. `gh project field-create` cannot create one (it only supports TEXT, SINGLE_SELECT, DATE and NUMBER), so create the Sprint iteration field in the Projects UI, then set it per item with `gh project item-edit --id ... --project-id ... --field-id ... --iteration-id ...` (iteration IDs are in `gh project field-list --format json`).

### Milestone Tracking
```bash
# Milestone progress from the issues side
gh api "repos/{owner}/{repo}/milestones" \
  --jq '.[] | "\(.title): \(.closed_issues)/\(.open_issues + .closed_issues) closed"'
```

## Team Collaboration

### Standup Automation
```bash
# What changed on the board since yesterday (by the underlying issues' update time)
SINCE=$(date -d yesterday --iso-8601)
gh issue list --search "updated:>=$SINCE" --json number,title,state,assignees \
  --jq '.[] | "- #\(.number) \(.title) [\(.state)]"'
```

### Review Coordination
```bash
# PRs on the board still waiting on review
gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json \
  --jq '.items[] | select(.content.type == "PullRequest" and .status == "Review") | .content.url'
```

## Best Practices

### 1. Board Organization
- Clear column definitions
- Consistent labeling system
- Regular board grooming
- Automation rules

### 2. Data Integrity
- Treat the issue as the source of truth and the board as a view of it
- Resolve conflicts in favor of the most recent issue update
- Keep an audit trail in issue comments

### 3. Team Adoption
- Training materials
- Clear workflows
- Regular reviews
- Feedback loops

## Troubleshooting

### Sync Issues
```bash
# Missing scope is the most common failure
gh auth status
gh auth refresh -s project

# Rate limits
gh api rate_limit --jq '.resources.graphql'
```

### Performance
Archive finished items (`gh project item-archive`) to keep `item-list` fast, and pass `--limit` explicitly: `gh project item-list` returns 30 items by default.

## Examples

### Agile Development Board
```bash
gh project create --owner $OWNER --title "Sprint Board"
# Add the Sprint iteration field in the Projects UI (gh cannot create iteration fields)
gh project field-create <number> --owner $OWNER --name "Story Points" --data-type NUMBER
```

### Kanban Flow Board
```bash
gh project create --owner $OWNER --title "Kanban"
# WIP limits are shown per column in the board view settings (GitHub UI)
gh project item-list <number> --owner $OWNER --format json \
  --jq '[.items[] | select(.status == "In Progress")] | length'
```

### Research Project Board
```bash
gh project create --owner $OWNER --title "Research"
gh project field-create <number> --owner $OWNER --name Phase --data-type SINGLE_SELECT \
  --single-select-options "ideation,research,experiment,analysis,publish"
```

## Metrics & KPIs

### Performance Metrics
```bash
# Throughput: issues on the board closed in the last 14 days
SINCE=$(date -d '14 days ago' +%s)
gh project item-list $PROJECT_NUMBER --owner $OWNER --limit 500 --format json \
  --jq '.items[] | select(.content.type == "Issue") | .content.url' |
  while read -r url; do gh issue view "$url" --json closedAt; done |
  jq -s --argjson since "$SINCE" 'map(select(.closedAt and ((.closedAt | fromdate) >= $since))) | length'
```

See also: [issue-tracker.md](./issue-tracker.md), [monoswarm-multi-repo.md](./monoswarm-multi-repo.md)

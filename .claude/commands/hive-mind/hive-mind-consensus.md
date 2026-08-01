---
name: hive-mind:hive-mind-consensus
---

# hive-mind consensus

Manage consensus proposals and voting within the hive.

## Usage
```bash
npx monomind hive-mind consensus [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--action` | `-a` | string | `list` | Action: `propose`, `vote`, `status`, `list` |
| `--proposal-id` | `-p` | string | — | Proposal ID (required for `vote` and `status`) |
| `--type` | `-t` | string | — | Proposal type (used with `propose`) |
| `--value` | — | string | — | Proposal value (used with `propose`) |
| `--vote` | `-v` | string | — | Vote to cast: `yes` or `no` (used with `vote`) |
| `--voter-id` | — | string | — | Voter agent ID (used with `vote`) |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# List all pending proposals
npx monomind hive-mind consensus

# Create a new proposal
npx monomind hive-mind consensus -a propose -t config-change --value '{"maxAgents":20}'

# Vote on a proposal
npx monomind hive-mind consensus -a vote -p proposal-abc123 -v yes --voter-id agent-1

# Check proposal status
npx monomind hive-mind consensus -a status -p proposal-abc123

# List pending proposals as JSON
npx monomind hive-mind consensus -a list --format json
```

## Actions

- **`list`** — Show all pending proposals (default)
- **`propose`** — Create a new consensus proposal (requires `--type` and `--value`)
- **`vote`** — Cast a vote on a proposal (requires `--proposal-id`, `--vote`, and `--voter-id`)
- **`status`** — Check the current vote tally for a proposal (requires `--proposal-id`)

## MCP Tool

```javascript
// List proposals
mcp__monomind__hive-mind_consensus({ action: "list" })

// Create proposal
mcp__monomind__hive-mind_consensus({
  action: "propose",
  type: "config-change",
  value: '{"maxAgents":20}'
})

// Vote
mcp__monomind__hive-mind_consensus({
  action: "vote",
  proposalId: "proposal-abc123",
  vote: true,
  voterId: "agent-1"
})
```

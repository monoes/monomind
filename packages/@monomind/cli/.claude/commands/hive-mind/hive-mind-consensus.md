---
name: hive-mind:hive-mind-consensus
---

# hive-mind consensus

Propose or vote on a threshold-based decision, single-process only. This is
vote-count bookkeeping over one JSON state file — not real distributed
consensus (no leader election, log replication, or network model).

There is no `npx monomind hive-mind consensus` CLI command — this is invoked
directly as an MCP tool call (see below).

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `action` | string | — | `propose`, `vote`, `status`, `list` (required) |
| `proposalId` | string | — | Proposal ID (required for `vote` and `status`) |
| `type` | string | — | Proposal type (used with `propose`) |
| `value` | any | — | Proposal value (used with `propose`) |
| `vote` | boolean | — | `true` = for, `false` = against (used with `vote`) |
| `voterId` | string | — | Voter agent ID (used with `vote`) |
| `strategy` | string | hive's configured strategy, else `raft` | `bft`, `raft`, `quorum` |
| `quorumPreset` | string | `majority` | `unanimous`, `majority`, `supermajority` (for `quorum` strategy) |
| `term` | number | — | Term number (for `raft` strategy) |
| `timeoutMs` | number | `30000` | Timeout in ms for raft re-proposal |

## Examples

```javascript
// List all pending proposals
mcp__monomind__hive-mind_consensus({ action: "list" })

// Create a new proposal
mcp__monomind__hive-mind_consensus({
  action: "propose",
  type: "config-change",
  value: { maxAgents: 20 }
})

// Vote on a proposal
mcp__monomind__hive-mind_consensus({
  action: "vote",
  proposalId: "proposal-abc123",
  vote: true,
  voterId: "agent-1"
})

// Check proposal status
mcp__monomind__hive-mind_consensus({ action: "status", proposalId: "proposal-abc123" })
```

## Actions

- **`list`** — Show all pending proposals
- **`propose`** — Create a new consensus proposal (requires `type` and `value`)
- **`vote`** — Cast a vote on a proposal (requires `proposalId`, `vote`, and `voterId`)
- **`status`** — Check the current vote tally for a proposal (requires `proposalId`)

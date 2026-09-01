---
description: monoswarm consensus command (monomind)
type: flow
name: monomind-monoswarm-consensus
---

# monoswarm vote

Propose or vote on a threshold-based decision — vote-count bookkeeping over one
JSON state file. See `doc/concepts/monoswarm.md` for how the mechanism works.

There is no `npx monomind monoswarm vote` CLI command — this is invoked
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
| `strategy` | string | run's configured strategy, else `majority` | `majority`, `supermajority`, `unanimous`, `threshold` |
| `term` | number | — | Term number (majority-strategy re-proposals) |
| `timeoutMs` | number | `30000` | Timeout in ms for re-proposal |

## Examples

```javascript
// List all pending proposals
mcp__monomind__monoswarm_vote({ action: "list" })

// Create a new proposal
mcp__monomind__monoswarm_vote({
  action: "propose",
  type: "config-change",
  value: { maxAgents: 20 }
})

// Vote on a proposal
mcp__monomind__monoswarm_vote({
  action: "vote",
  proposalId: "proposal-abc123",
  vote: true,
  voterId: "agent-1"
})

// Check proposal status
mcp__monomind__monoswarm_vote({ action: "status", proposalId: "proposal-abc123" })
```

## Actions

- **`list`** — Show all pending proposals
- **`propose`** — Create a new proposal (requires `type` and `value`)
- **`vote`** — Cast a vote on a proposal (requires `proposalId`, `vote`, and `voterId`)
- **`status`** — Check the current vote tally for a proposal (requires `proposalId`)

Resolved decisions are HMAC-signed and appended to a tamper-evident JSONL
audit trail. Verify with `mcp__monomind__monoswarm_audit_verify { decisionId }`;
list history with `mcp__monomind__monoswarm_audit_list { limit }`.

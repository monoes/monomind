---
name: agents-agent-types
description: Complete guide to all 60+ available agent types in Monomind.
type: flow
---

# agent-types

Complete guide to all 60+ available agent types in Monomind.

## Core Development Agents
- `coder` - Implementation specialist
- `reviewer` - Code quality assurance
- `tester` - Test creation and validation
- `planner` - Strategic planning
- `researcher` - Information gathering

## Monoswarm Coordination Agents
- `coordinator` - Lead coordination
- `mesh-coordinator` - Peer-to-peer networks
- `collective-intelligence-coordinator` - Shared knowledge synthesis

## Specialized Agents
- `Backend Architect` - API and server design
- `Mobile App Builder` - Mobile (native and React Native) development
- `AI Engineer` - Machine learning
- `system-architect` - High-level design

These names are the Task `subagent_type` values. To choose one for a task, use the prompt's `[PICK]` line or `mcp__monomind__pick` (without MCP: `monomind pick -t "<task>"`).

For full list and details:
```bash
npx monomind agent list
```

---
name: swarm-README
description: Swarm skill index — lists all available swarm coordination skills and strategies for multi-agent task execution
---

# Swarm Skills

Multi-agent swarm coordination for Monomind.

## Core Skills

- [swarm](./swarm.md) — Main swarm skill: how to start and coordinate swarms

## Strategy Skills

- [analysis](./analysis.md) — Distributed analysis via coordinated agents
- [development](./development.md) — Coordinated development teams
- [research](./research.md) — Parallel information gathering
- [testing](./testing.md) — Distributed test execution
- [maintenance](./maintenance.md) — System maintenance coordination
- [optimization](./optimization.md) — Performance optimization swarms
- [examples](./examples.md) — Common swarm patterns and recipes

## Reference Skills

- [swarm-status](./swarm-status.md) — Check swarm health and agent progress
- [swarm-monitor](./swarm-monitor.md) — Monitor running swarms
- [swarm-modes](./swarm-modes.md) — Topology modes: hierarchical, mesh, star
- [swarm-strategies](./swarm-strategies.md) — Strategy selection guide
- [swarm-background](./swarm-background.md) — Running swarms in the background
- [swarm-analysis](./swarm-analysis.md) — Swarm performance analysis

## Quick Start

```bash
# Initialize and start a swarm via CLI
npx monomind swarm init --topology hierarchical --max-agents 8
npx monomind swarm start "Build REST API" --strategy development
npx monomind swarm status
```

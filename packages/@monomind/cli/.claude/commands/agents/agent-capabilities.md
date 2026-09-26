---
name: agents:agent-capabilities
description: Matrix of agent capabilities and their specializations.
---

# agent-capabilities

Matrix of agent capabilities and their specializations.

## Capability Matrix

| Agent Type | Primary Skills | Best For |
|------------|---------------|----------|
| coder | Implementation, debugging | Feature development |
| researcher | Analysis, synthesis | Requirements gathering |
| tester | Testing, validation | Quality assurance |
| architect | Design, planning | System architecture |

## Querying Capabilities
```bash
# Rank installed agents whose capabilities fit a task
npx monomind pick -t "write integration tests" --agents
```

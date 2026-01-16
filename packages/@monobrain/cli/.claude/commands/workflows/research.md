# Research Workflow Coordination

## Purpose
Coordinate Claude Code's research activities for comprehensive, systematic exploration.

## Step-by-Step Coordination

### 1. Initialize Research Framework
```
Tool: mcp__monobrain__swarm_init
Parameters: {"topology": "mesh", "maxAgents": 5, "strategy": "balanced"}
```
Creates a mesh topology for comprehensive exploration from multiple angles.

### 2. Define Research Perspectives
```
Tool: mcp__monobrain__agent_spawn
Parameters: {"type": "researcher", "name": "Literature Review"}
```
```
Tool: mcp__monobrain__agent_spawn  
Parameters: {"type": "analyst", "name": "Data Analysis"}
```
Sets up different analytical approaches for Claude Code to use.

### 3. Execute Coordinated Research
```
Tool: mcp__monobrain__task_orchestrate
Parameters: {
  "task": "Research modern web frameworks performance",
  "strategy": "adaptive",
  "priority": "medium"
}
```

### 4. Store Research Findings
```
Tool: mcp__monobrain__memory_usage
Parameters: {
  "action": "store",
  "key": "research_findings",
  "value": "framework performance analysis results",
  "namespace": "research"
}
```

## What Claude Code Actually Does
1. Uses **WebSearch** tool for finding resources
2. Uses **Read** tool for analyzing documentation
3. Uses **Task** tool for parallel exploration
4. Synthesizes findings using coordination patterns
5. Stores insights in memory for future reference

Remember: The swarm coordinates HOW Claude Code researches, not WHAT it finds.

## CLI Usage
```bash
# Start research workflow via CLI
npx monobrain workflow research "modern web frameworks"

# Export research workflow
npx monobrain workflow export research --format json
```
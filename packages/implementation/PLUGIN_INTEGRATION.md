# Monomind Plugin Integration

## Overview

This document describes how monomind integrates with the official Claude Code plugin system.

## Plugin Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json          # Official plugin manifest
├── .mcp.json                 # MCP server bundle
├── hooks/
│   └── hooks.json            # Hook configurations
├── skills -> ../.claude/skills     # 60+ skills
├── commands -> ../.claude/commands # 100+ commands
└── agents -> ../v1/agents          # Agent YAML templates
```

## Official Claude Code Integration Points

### 1. Plugin Manifest (`plugin.json`)

```json
{
  "name": "monomind",
  "version": "3.0.0",
  "capabilities": {
    "skills": true,
    "commands": true,
    "agents": true,
    "hooks": true,
    "mcpServers": true
  }
}
```

### 2. Hook Event Mapping

| V1 Internal Event | Official Claude Code Event | Tool Matcher                 |
| ----------------- | -------------------------- | ---------------------------- |
| `PreEdit`         | `PreToolUse`               | `^(Write\|Edit\|MultiEdit)$` |
| `PostEdit`        | `PostToolUse`              | `^(Write\|Edit\|MultiEdit)$` |
| `PreCommand`      | `PreToolUse`               | `^Bash$`                     |
| `PostCommand`     | `PostToolUse`              | `^Bash$`                     |
| `PreTask`         | `UserPromptSubmit`         | -                            |
| `PostTask`        | `PostToolUse`              | `^Task$`                     |
| `SessionStart`    | `SessionStart`             | -                            |
| `SessionEnd`      | `Stop`                     | -                            |
| `AgentSpawn`      | `PostToolUse`              | `^Task$`                     |
| `AgentTerminate`  | `SubagentStop`             | -                            |
| `PreRoute`        | `UserPromptSubmit`         | -                            |

### 3. MCP Server Bundle

The plugin bundles three MCP servers:

1. **monomind** (required): Core swarm coordination
2. **ruv-swarm** (optional): Enhanced topology patterns

### 4. Skills Integration

Skills follow the official SKILL.md format:

```yaml
---
name: skill-name
description: What this skill does
allowed-tools: Read, Write, Bash
---
# Skill Name

[Instructions for Claude]
```

## Hooks Bridge

The `@monomind/hooks` package includes an official hooks bridge:

```typescript
import {
  OfficialHooksBridge,
  processOfficialHookInput,
  outputOfficialHookResult,
  executeWithBridge,
} from "@monomind/hooks";

// Process input from Claude Code
const input = await processOfficialHookInput();

// Convert to V1 context
const context = OfficialHooksBridge.toV1Context(input);

// Execute V1 handler
const result = await handler(context);

// Convert back to official output
const output = OfficialHooksBridge.toOfficialOutput(
  result,
  input.hook_event_name,
);
outputOfficialHookResult(output);
```

## Installation

### Via Plugin Command (Recommended)

```bash
# Add plugin marketplace
/plugin marketplace add monomind https://github.com/nokhodian/monomind

# Install plugin
/plugin install monomind
```

### Manual Installation

```bash
# Clone and link
git clone https://github.com/nokhodian/monomind
claude --plugin-dir ./monomind/plugin
```

### Via npx Init

```bash
npx monomind@alpha init --hooks
```

## Configuration

### Enable All Hooks

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [...],
    "PostToolUse": [...],
    "UserPromptSubmit": [...],
    "SessionStart": [...],
    "Stop": [...]
  }
}
```

### Selective Hooks

Enable only specific hooks by choosing matchers:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": [
          { "type": "command", "command": "npx monomind@alpha hooks pre-edit" }
        ]
      }
    ]
  }
}
```

## MCP Tool Access

After installation, MCP tools are available:

- `mcp__monomind__swarm_init`
- `mcp__monomind__agent_spawn`
- `mcp__monomind__task_orchestrate`
- `mcp__monomind__memory_usage`
- `mcp__monomind__hooks_route`
- `mcp__monomind__hooks_metrics`

## Marketplace Publishing

### Create Marketplace Entry

```json
{
  "name": "monomind-marketplace",
  "plugins": [
    {
      "name": "monomind",
      "description": "Multi-agent swarm coordination",
      "version": "3.0.0",
      "path": "plugin"
    }
  ]
}
```

### Host on GitHub

1. Push to repository
2. Add marketplace: `/plugin marketplace add name https://github.com/user/repo`
3. Users install: `/plugin install monomind@name`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code                              │
├─────────────────────────────────────────────────────────────┤
│  Official Hooks API                                          │
│  ┌─────────────┬─────────────┬─────────────┬──────────────┐ │
│  │ PreToolUse  │ PostToolUse │ SessionStart│ UserPrompt   │ │
│  └──────┬──────┴──────┬──────┴──────┬──────┴──────┬───────┘ │
│         │             │             │             │          │
│         ▼             ▼             ▼             ▼          │
│  ┌──────────────────────────────────────────────────────────┐│
│  │              Official Hooks Bridge                        ││
│  │  (packages/@monomind/hooks/src/bridge/official-hooks-bridge)││
│  └──────────────────────────────────────────────────────────┘│
│         │             │             │             │          │
│         ▼             ▼             ▼             ▼          │
│  ┌─────────────┬─────────────┬─────────────┬──────────────┐ │
│  │ PreEdit     │ PostEdit    │ SessionStart│ PreTask      │ │
│  │ PreCommand  │ PostCommand │ SessionEnd  │ PostTask     │ │
│  └─────────────┴─────────────┴─────────────┴──────────────┘ │
│                     V1 Hooks System                          │
├─────────────────────────────────────────────────────────────┤
│                    @monomind/hooks                        │
│  ┌───────────┬───────────┬───────────┬───────────────────┐  │
│  │ Registry  │ Executor  │ Daemons   │ MCP Tools         │  │
│  └───────────┴───────────┴───────────┴───────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│              Skills │ Commands │ Agents │ MCP Servers       │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

1. **Seamless Integration**: V1 hooks map directly to official events
2. **Full Feature Access**: 60+ skills, 100+ commands, 80+ agents
3. **MCP Bundling**: All servers configured in one file
4. **Marketplace Ready**: Standard plugin format for distribution
5. **Backward Compatible**: Works with existing `.claude/` configurations

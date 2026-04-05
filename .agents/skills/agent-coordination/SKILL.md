---
name: agent-coordination
description: >
  Agent spawning, lifecycle management, and coordination patterns. Manages 230+ agent types across 20+ categories including engineering, design, marketing, game development, sales, testing, and more.
  Use when: spawning agents, coordinating multi-agent tasks, managing agent pools, routing domain-specific work.
  Skip when: single-agent work, no coordination needed.
---

# Agent Coordination Skill

## Purpose
Spawn and coordinate agents for complex multi-agent tasks.

## Agent Types

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`

### Consensus
`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `consensus-builder`

### GitHub
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### SPARC
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`, `refinement`

### Academic
`academic-anthropologist`, `academic-geographer`, `academic-historian`, `academic-narratologist`, `academic-psychologist`

### Design
`design-brand-guardian`, `design-image-prompt-engineer`, `design-inclusive-visuals-specialist`, `design-ui-designer`, `design-ux-architect`, `design-ux-researcher`, `design-visual-storyteller`, `design-whimsy-injector`

### Engineering
`engineering-ai-engineer`, `engineering-backend-architect`, `engineering-code-reviewer`, `engineering-data-engineer`, `engineering-database-optimizer`, `engineering-devops-automator`, `engineering-embedded-firmware-engineer`, `engineering-frontend-developer`, `engineering-git-workflow-master`, `engineering-incident-response-commander`, `engineering-mobile-app-builder`, `engineering-rapid-prototyper`, `engineering-security-engineer`, `engineering-senior-developer`, `engineering-software-architect`, `engineering-solidity-smart-contract-engineer`, `engineering-sre`, `engineering-technical-writer`, `engineering-threat-detection-engineer`

### Game Development
`game-designer`, `game-audio-engineer`, `level-designer`, `narrative-designer`, `technical-artist`, `blender-addon-engineer`, `godot-gameplay-scripter`, `godot-multiplayer-engineer`, `godot-shader-developer`, `unity-architect`, `unity-editor-tool-developer`, `unity-multiplayer-engineer`, `unity-shader-graph-artist`, `unreal-multiplayer-architect`, `unreal-systems-engineer`, `unreal-technical-artist`, `unreal-world-builder`, `roblox-avatar-creator`, `roblox-experience-designer`, `roblox-systems-scripter`

### Marketing
`marketing-seo-specialist`, `marketing-content-creator`, `marketing-social-media-strategist`, `marketing-growth-hacker`, `marketing-tiktok-strategist`, `marketing-linkedin-content-creator`, `marketing-instagram-curator`, `marketing-twitter-engager`, `marketing-reddit-community-builder`, `marketing-podcast-strategist`, `marketing-book-co-author`, `marketing-app-store-optimizer`, `marketing-ai-citation-strategist`, `marketing-baidu-seo-specialist`, `marketing-bilibili-content-strategist`, `marketing-douyin-strategist`, `marketing-kuaishou-strategist`, `marketing-weibo-strategist`, `marketing-xiaohongshu-specialist`, `marketing-zhihu-strategist`, `marketing-wechat-official-account`, `marketing-china-ecommerce-operator`, `marketing-cross-border-ecommerce`, `marketing-livestream-commerce-coach`, `marketing-private-domain-operator`, `marketing-short-video-editing-coach`, `marketing-carousel-growth-engine`

### Paid Media
`paid-media-ppc-strategist`, `paid-media-programmatic-buyer`, `paid-media-paid-social-strategist`, `paid-media-auditor`, `paid-media-creative-strategist`, `paid-media-search-query-analyst`, `paid-media-tracking-specialist`

### Product
`product-manager`, `product-sprint-prioritizer`, `product-feedback-synthesizer`, `product-trend-researcher`, `product-behavioral-nudge-engine`

### Project Management
`project-manager-senior`, `project-management-project-shepherd`, `project-management-jira-workflow-steward`, `project-management-studio-producer`, `project-management-studio-operations`, `project-management-experiment-tracker`

### Sales
`sales-coach`, `sales-engineer`, `sales-deal-strategist`, `sales-discovery-coach`, `sales-outbound-strategist`, `sales-pipeline-analyst`, `sales-proposal-strategist`, `sales-account-strategist`

### Spatial Computing
`visionos-spatial-engineer`, `xr-immersive-developer`, `xr-interface-architect`, `xr-cockpit-interaction-specialist`, `macos-spatial-metal-engineer`, `terminal-integration-specialist`

### Specialized
`specialized-mcp-builder`, `specialized-salesforce-architect`, `specialized-workflow-architect`, `specialized-developer-advocate`, `specialized-document-generator`, `specialized-model-qa`, `specialized-cultural-intelligence-strategist`, `blockchain-security-auditor`, `compliance-auditor`, `identity-graph-operator`, `agentic-identity-trust`, `agents-orchestrator`, `automation-governance-architect`, `lsp-index-engineer`, `zk-steward`, `supply-chain-strategist`, `recruitment-specialist`, `corporate-training-designer`, `study-abroad-advisor`, `healthcare-marketing-compliance`, `accounts-payable-agent`, `data-consolidation-agent`, `report-distribution-agent`, `sales-data-extraction-agent`

### Support
`support-analytics-reporter`, `support-executive-summary-generator`, `support-finance-tracker`, `support-infrastructure-maintainer`, `support-legal-compliance-checker`, `support-support-responder`

### Testing
`testing-accessibility-auditor`, `testing-api-tester`, `testing-evidence-collector`, `testing-performance-benchmarker`, `testing-reality-checker`, `testing-test-results-analyzer`, `testing-tool-evaluator`, `testing-workflow-optimizer`

## Commands

### Spawn Agent
```bash
npx monobrain agent spawn --type coder --name my-coder
```

### List Agents
```bash
npx monobrain agent list --filter active
```

### Agent Status
```bash
npx monobrain agent status --id agent-123
```

### Agent Metrics
```bash
npx monobrain agent metrics --id agent-123
```

### Stop Agent
```bash
npx monobrain agent stop --id agent-123
```

### Pool Management
```bash
npx monobrain agent pool --size 5 --type coder
```

## Routing (Current: Semantic RouteLayer)

Use `npx monobrain@latest route --task "your task description"` to resolve the optimal agent.
The RouteLayer computes cosine similarity against 10–15 representative utterances per agent category,
covering all 40+ route definitions across core, security, engineering, testing, design, marketing,
product, specialized, and game-dev categories.

```bash
# Route a task and get the best agent slug + confidence
npx monobrain@latest route task "audit the JWT token handling for vulnerabilities"
# → { agentSlug: "engineering-security-engineer", confidence: 0.87, method: "semantic" }

# Spawn with auto-routing (omit --type to trigger RouteLayer)
npx monobrain@latest agent spawn --task "implement the password reset feature"
```

Import in TypeScript:
```typescript
import { RouteLayer, ALL_ROUTES } from '@monobrain/routing';
const layer = new RouteLayer({ routes: ALL_ROUTES });
const result = await layer.route(taskDescription);
// result.agentSlug, result.confidence, result.method
```

## Routing Codes (DEPRECATED — use RouteLayer above)

> **Deprecated**: The integer codes below are kept as a legacy reference only.
> They cover only 5 task types out of 40+ available agent categories.
> Use the Semantic RouteLayer instead.

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |

## Best Practices
1. Use hierarchical topology for coordination
2. Keep agent count under 8 for tight coordination
3. Use specialized agents for specific tasks
4. Coordinate via memory, not direct communication

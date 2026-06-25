---
name: specialagent
description: Find the single best specialized agent from the full 160+ agent roster using two-stage LLM domain→agent selection
version: 2.0.0
triggers:
  - /specialagent
  - find best agent
  - which agent should i use
  - best agent for
  - recommend an agent
  - pick an agent
  - what agent
  - who should handle this
  - which specialist
  - what specialist
  - agent for this task
  - assign an agent
  - which swarm agent
tools:
  - Bash
---

# /specialagent — Two-Stage LLM Agent Selection

Finds the best agent using a lightweight two-stage LLM approach: first pick the domain, then pick the agent within that domain. Only names are passed at each stage — no descriptions, no keyword dumps.

## How It Works

```
Stage 1: Give LLM domain names → LLM picks best domain
Stage 2: Give LLM agent names in that domain → LLM picks best agent
```

## Stage 1: Domain Selection

The available domains and their agent counts are:

| Domain | Count |
|---|---|
| development | 20 |
| testing | 10 |
| security | 6 |
| devops | 5 |
| data-ai | 5 |
| architecture | 6 |
| research | 5 |
| marketing | 27 |
| sales | 8 |
| paid-media | 7 |
| design | 8 |
| product | 5 |
| project-management | 6 |
| specialized | 26 |
| academic | 5 |
| support | 6 |

**Stage 1 prompt to yourself:**
> "Given the task: `<task>` — which single domain from this list best fits: development, testing, security, devops, data-ai, architecture, research, marketing, sales, paid-media, design, product, project-management, specialized, academic, support? Answer with just the domain name."

## Stage 2: Agent Selection Per Domain

Once the domain is selected, use only the agent names for that domain:

### development
sparc-coder, coder, backend-dev, Frontend Developer, mobile-dev, ml-developer, Rapid Prototyper, base-template-generator, LSP/Index Engineer, macOS Spatial/Metal Engineer, Terminal Integration Specialist, Embedded Firmware Engineer, Solidity Smart Contract Engineer, WeChat Mini Program Developer, Feishu Integration Developer, Roblox Systems Scripter, Godot Gameplay Scripter, Unity Architect, Unreal Systems Engineer, visionOS Spatial Engineer

### testing
tdd-london-swarm, API Tester, production-validator, Evidence Collector, agent-browser-testing, Accessibility Auditor, Reality Checker, Code Reviewer, code-analyzer, feature-dev:code-reviewer

### security
Security Engineer, Compliance Auditor, Blockchain Security Auditor, v1-security-architect, Threat Detection Engineer, Agentic Identity & Trust Architect

### devops
DevOps Automator, SRE, cicd-engineer, Incident Response Commander, Git Workflow Master

### data-ai
Data Engineer, AI Engineer, Database Optimizer, AI Data Remediation Engineer, Model QA Specialist

### architecture
system-architect, Software Architect, Backend Architect, Plan, UX Architect, Workflow Architect

### research
sparc:researcher, Explore, Trend Researcher, Technical Writer, api-docs

### marketing
AI Citation Strategist, App Store Optimizer, Baidu SEO Specialist, Bilibili Content Strategist, Carousel Growth Engine, China E-Commerce Operator, Content Creator, Cross-Border E-Commerce Specialist, Developer Advocate, Douyin Strategist, Growth Hacker, Healthcare Marketing Compliance Specialist, Instagram Curator, Kuaishou Strategist, LinkedIn Content Creator, Podcast Strategist, Reddit Community Builder, SEO Specialist, Short-Video Editing Coach, Social Media Strategist, TikTok Strategist, Twitter Engager, WeChat Official Account Manager, Weibo Strategist, Xiaohongshu Specialist, Zhihu Strategist, Livestream Commerce Coach

### sales
Account Strategist, Sales Coach, Deal Strategist, Discovery Coach, Outbound Strategist, Pipeline Analyst, Sales Engineer, Proposal Strategist

### paid-media
Paid Media Auditor, Ad Creative Strategist, Paid Social Strategist, PPC Campaign Strategist, Programmatic & Display Buyer, Search Query Analyst, Tracking & Measurement Specialist

### design
Brand Guardian, Image Prompt Engineer, Inclusive Visuals Specialist, Cultural Intelligence Strategist, Behavioral Nudge Engine, Whimsy Injector, UI Designer, Visual Storyteller

### product
Feedback Synthesizer, Product Manager, Sprint Prioritizer, Experiment Tracker, UX Researcher

### project-management
Jira Workflow Steward, Project Shepherd, Studio Operations, Studio Producer, Automation Governance Architect, Autonomous Optimization Architect

### specialized
Accounts Payable Agent, Agents Orchestrator, Analytics Reporter, Book Co-Author, Corporate Training Designer, Document Generator, Executive Summary Generator, Finance Tracker, French Consulting Market Navigator, Government Digital Presales Consultant, Identity Graph Operator, Infrastructure Maintainer, Korean Business Navigator, Legal Compliance Checker, MCP Builder, Narrative Designer, Private Domain Operator, Recruitment Specialist, Report Distribution Agent, Salesforce Architect, Supply Chain Strategist, Support Responder, Tool Evaluator, ZK Steward, agentic-payments, adaptive-coordinator

### academic
Anthropologist, Geographer, Historian, Narratologist, Psychologist

### support
Analytics Reporter, Executive Summary Generator, Finance Tracker, Support Responder, Study Abroad Advisor, Trend Researcher

**Stage 2 prompt to yourself:**
> "Given the task: `<task>` — which single agent from this list is the best fit: `<comma-separated agent names for selected domain>`? Answer with just the agent name."

## Execution Steps

1. Read the user's task
2. **Stage 1**: Internally reason through the domain list → select one domain
3. **Stage 2**: Internally reason through agent names in that domain → select one agent
4. Retrieve that agent's `subagent_type` slug from the mapping below
5. Output the recommendation

## Slug Mapping (agent name → subagent_type)

Use this to convert the chosen agent name to a callable slug:

```
sparc-coder → sparc-coder
coder → coder
backend-dev → backend-dev
Frontend Developer → Frontend Developer
mobile-dev → mobile-dev
ml-developer → ml-developer
Rapid Prototyper → Rapid Prototyper
LSP/Index Engineer → LSP/Index Engineer
macOS Spatial/Metal Engineer → macOS Spatial/Metal Engineer
Agentic Identity & Trust Architect → Agentic Identity & Trust Architect
tdd-london-swarm → tdd-london-swarm
API Tester → API Tester
production-validator → production-validator
Evidence Collector → Evidence Collector
agent-browser-testing → agent-browser-testing
Accessibility Auditor → Accessibility Auditor
Reality Checker → Reality Checker
Security Engineer → Security Engineer
Compliance Auditor → Compliance Auditor
Blockchain Security Auditor → Blockchain Security Auditor
DevOps Automator → DevOps Automator
SRE → SRE
cicd-engineer → cicd-engineer
Incident Response Commander → Incident Response Commander
Git Workflow Master → Git Workflow Master
Data Engineer → Data Engineer
AI Engineer → AI Engineer
Database Optimizer → Database Optimizer
system-architect → system-architect
Software Architect → Software Architect
Backend Architect → Backend Architect
Plan → Plan
UX Architect → UX Architect
sparc:researcher → sparc:researcher
Explore → Explore
Trend Researcher → Trend Researcher
Technical Writer → Technical Writer
api-docs → api-docs
Code Reviewer → Code Reviewer
code-analyzer → code-analyzer
feature-dev:code-reviewer → feature-dev:code-reviewer
TikTok Strategist → TikTok Strategist
SEO Specialist → SEO Specialist
Content Creator → Content Creator
LinkedIn Content Creator → LinkedIn Content Creator
Growth Hacker → Growth Hacker
Product Manager → Product Manager
Project Shepherd → Project Shepherd
Sales Coach → Sales Coach
Deal Strategist → Deal Strategist
Legal Compliance Checker → Legal Compliance Checker
Finance Tracker → Finance Tracker
Support Responder → Support Responder
Analytics Reporter → Analytics Reporter
Brand Guardian → Brand Guardian
UI Designer → UI Designer
Anthropologist → Anthropologist
Historian → Historian
Psychologist → Psychologist
```
(For any agent not listed, use the agent name directly as the slug.)

## Output Format

```
TASK: <one-line task summary>

DOMAIN: <selected domain>

RECOMMENDED AGENT: <Agent Name>
Invoke: Task({ subagent_type: "<slug>", prompt: "..." })
```

Then ask: "Should I spawn this agent now?"

## Rules

1. Only pass names at each stage — no descriptions, no keyword dumps, no scoring tables
2. Pick exactly one domain, then exactly one agent
3. For dev tasks that clearly need a specialized tool (e.g. CI/CD → cicd-engineer, not DevOps Automator), prefer the more specific agent
4. Never recommend a generic role (coder, tester) when a specialized agent in the right domain exists

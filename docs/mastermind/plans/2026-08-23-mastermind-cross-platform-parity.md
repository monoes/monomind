# Mastermind Cross-Platform Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Monomind and Mastermind provide the same supported user outcomes on every supported coding platform through each platform's native configuration surfaces.

**Architecture:** Replace the current collection of overlapping installers with one declarative platform-adapter registry. Mastermind becomes a canonical set of portable `SKILL.md` packages plus a short router instruction; each adapter renders that content into the platform's documented instruction, skill, MCP, command, agent, hook, and status surfaces. The MCP server and `monomind` CLI remain the functional source of truth, so a platform without a native UI surface receives an explicit CLI fallback rather than an unreliable emulation.

**Tech Stack:** TypeScript, Node.js, pnpm, Vitest, TOML/JSON/Markdown renderers, MCP stdio, platform fixtures.

## Global Constraints

- Supported runtime universe is exactly: Claude Code, Gemini CLI, Cursor, VS Code, GitHub Copilot CLI, OpenCode, Aider, Kiro, Trae, OpenClaw, Droid, Google Antigravity, Hermes, Codex, Kimi Code, and Zed.
- A platform is not declared **supported** until its install, upgrade, uninstall, and smoke fixture passes on macOS/Linux and Windows command rendering is covered by tests.
- “Parity” means equivalent outcomes, not identical files or forced hooks: project instructions, Mastermind workflows, Monomind MCP tools, graph navigation, memory, organization control, status, safety checks, diagnosis, and clean removal.
- Keep static project instructions below 200 lines; detailed Mastermind procedures must remain in on-demand skills. This follows the documented loading model for Claude Code and avoids the previous large session-start prompt injection. [Claude Code feature model](https://code.claude.com/docs/en/features-overview)
- Use only platform-owned or officially documented shared skill roots. Never assume `~/.agents/skills` is universal.
- Do not install SessionStart prompt-injection hooks. Hooks are for deterministic checks, formatting, telemetry, or policy only; all must be fast, stdin-safe, idempotent, and fail open unless the user explicitly enables a blocking policy.
- Preserve user configuration. Every generated block must have a stable Monomind marker and every merge/uninstall must modify only that block or named MCP entry.
- Do not claim a native capability where the platform does not provide one. Surface the capability through MCP or the `monomind` CLI and report the intentional fallback in `monomind platforms doctor`.
- Do not make global changes from project initialization unless the user explicitly requests `--scope user`; project installation is the default.

---

## Executive decision

**Proceed with a full adapter revision.** Do not repair each existing platform writer independently. The current implementation has three incompatible platform inventories, treats Markdown commands as skills, installs Claude-oriented protocol content into other runtimes, and has no end-to-end contract that proves a generated configuration is valid for its target.

The revision should ship in two release milestones:

1. **Core parity (all 16 targets):** instructions, skill router, MCP, CLI fallback, install/upgrade/uninstall/doctor, and a capability report.
2. **Native enhancement parity (only where documented and tested):** slash commands, subagents, hooks, status UI, and plugins.

No platform may receive a full Mastermind protocol at session start. The old mechanism is the direct cause of the prior Codex startup noise and makes all runtimes pay the context cost of workflows they may never use.

## Comprehensive review

### Current implementation findings

| Finding | Evidence in the repository | Required correction |
|---|---|---|
| There are conflicting platform inventories. | `packages/@monomind/cli/src/commands/platforms.ts` lists 14 targets; `packages/@monomind/monograph/src/skills/platform-skills.ts` lists 9; init writers additionally implement Kimi Code and Zed paths. | Replace all inventories with one registry and derive CLI help, install, doctor, and tests from it. |
| The current generic installer writes instructions, not native skills. | `platforms.ts` appends one generic Monograph/Mastermind block to platform config files. | Separate concise instructions from canonical skill packages. |
| The old global setup injects a Claude command file into SessionStart. | `MASTERMIND_ACTIVATE_SCRIPT` in `platforms.ts` searches `.claude/commands/mastermind/master.md` and writes it to stdout. | Delete this setup mechanism and migrate it away on upgrade. |
| Codex has two incompatible hook schemas. | `setupCodex` writes legacy `[[hooks]]`; `codex-generator.ts` writes event-specific `[[hooks.PreToolUse]]`. | Own exactly one Codex adapter and test the rendered TOML with a real schema fixture. |
| Existing "shared" skills were command Markdown files without skill metadata. | `installMastermindSkills` copied command files into `SKILL.md`; frontmatter was only recently added. | Create canonical skill sources first; commands become optional platform projections. |
| Core runtime features are Claude-shaped. | Codex, OpenCode, Kimi, and Gemini writers bridge into `.claude/helpers` or copy from `.claude/` trees. | Introduce runtime-neutral core contracts; retain Claude adapters only as render targets. |
| Current tests prove names and a few file writes, not runtime compatibility. | `packages/@monomind/cli/__tests__/commands/platforms.test.ts` only checks command metadata. | Add per-platform fixture, merge, uninstall, command-rendering, hook-stdin, and smoke-contract tests. |

### Native-platform review and target policy

| Platform | Native surfaces to use | Required parity surface | Adapter policy |
|---|---|---|---|
| Claude Code | `CLAUDE.md`, `.claude/skills`, `.mcp.json`, `.claude/settings.json`, agents/plugins | Full native parity | Baseline reference adapter. Claude distinguishes persistent instructions, skills, MCP, subagents, and hooks. [Official overview](https://code.claude.com/docs/en/features-overview) |
| Gemini CLI | `GEMINI.md`, `.gemini/skills`, settings/hooks, MCP | Full native parity | Native skill/MCP adapter; no Claude helper dependency. [Hook reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md) |
| Cursor | `.cursor/rules`, native skills, MCP, `hooks.json` | Full native parity | Do not write deprecated `.cursorrules`; use rule/skill model and Cursor hook schema. [Cursor skills](https://cursor.com/docs/context/skills), [hooks](https://cursor.com/docs/agent/hooks) |
| VS Code | `.github/copilot-instructions.md`, `.github/skills`, MCP/custom agents | Full native parity | Treat VS Code as a Copilot host; skills for reusable workflows and instructions for baseline rules. [VS Code agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills) |
| GitHub Copilot CLI | `AGENTS.md`/GitHub instructions, `.github/skills`, `.github/hooks` | Full native parity | Separate identity from VS Code while sharing renderer primitives. [Copilot customization](https://docs.github.com/en/copilot/customizing-copilot) |
| OpenCode | `AGENTS.md`, `.opencode/skills`, commands, agents, plugin, MCP | Full native parity | Keep the existing direction but render from canonical artifacts, not `.claude/` copies. [OpenCode skills](https://opencode.ai/docs/skills/) |
| Aider | conventions file read through `.aider.conf.yml`, CLI/MCP if supported | Core parity with explicit CLI fallback | No fake skills, agents, hooks, or status UI. Keep concise project conventions and `monomind` commands. [Aider config](https://aider.chat/docs/config/aider_conf.html) |
| Kiro | steering, `.kiro/skills`, MCP, hooks, agents | Full native parity | Use inclusion modes so only the short router is always loaded. [Kiro steering](https://kiro.dev/docs/steering/), [skills](https://kiro.dev/docs/skills/) |
| Trae | rules, skills, MCP, agents where version confirms them | Core parity first | Mark native enhancement experimental until an automated fixture verifies the installed version. |
| OpenClaw | workspace or `.agents/skills`, `~/.openclaw/skills`, plugins/hooks | Full native parity | Use native OpenClaw skill roots; never write the current nonexistent `.claw/config.md` convention. [OpenClaw skills](https://docs.openclaw.ai/tools/skills) |
| Droid | `AGENTS.md`, `.factory/skills`, `.factory/hooks.json`, plugins/MCP | Full native parity | Use the documented `.factory` paths and plugin packaging. [Droid skills](https://docs.factory.ai/harness/skills), [hooks](https://docs.factory.ai/harness/hooks) |
| Google Antigravity | workspace/global skills, MCP, JSON hooks, rules | Full native parity | Use an adapter after version discovery; keep hooks separate from Gemini CLI. [Antigravity overview](https://www.antigravity.google/product/antigravity-2), [hooks](https://antigravity.google/docs/hooks) |
| Hermes | skills, config, hooks, MCP where discovery confirms them | Core parity first | Add only after a versioned discovery probe records supported paths and schema. |
| Codex | `AGENTS.md`, `$CODEX_HOME/skills`, `.codex/config.toml`, MCP, native hooks | Full native parity | Keep current native project integration; remove the legacy global activation writer and make hooks optional/off by default until contract-tested. |
| Kimi Code | `AGENTS.md`, `.kimi-code/skills`, plugin commands/agents/hooks, MCP | Full native parity | Promote from hidden init target into the registry; canonical skills map directly to `SKILL.md`. [Kimi skills](https://www.kimi.ai/help/features/use-skills-in-code), [plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html) |
| Zed | Zed instructions, skills, MCP, agent profiles | Core parity then native enhancements | Promote from the monograph-only registry; validate actual file paths through a versioned probe. [Zed agents](https://zed.dev/docs/ai/agents) |

### Capability contract

Every adapter must declare one of `native`, `cli_fallback`, `unsupported`, or `experimental` for each capability.

| Capability | Functional definition | Minimum parity requirement |
|---|---|---|
| Project instructions | The agent receives concise project operating rules. | Native instruction file or generated `AGENTS.md` equivalent. |
| Mastermind router | The agent can discover which Mastermind workflow applies. | One concise always-on router plus a list of available skill names. |
| Mastermind workflows | The agent can load the full procedure for plan, review, debug, research, execution, org, and memory work. | Canonical `SKILL.md` package available natively or launched through `monomind mastermind run <skill>`. |
| Monomind tools | The agent can query graph, impact, memory, organizations, events, and diagnostics. | Named MCP server; a documented CLI fallback only if MCP is unavailable. |
| Commands | A user can invoke workflows intentionally. | Native command/slash-command aliases where available; otherwise documented `monomind` CLI equivalents. |
| Agents | A user can run specialized roles. | Native subagent manifest where available; otherwise `monomind org run` plus a skill that explains it. |
| Hooks | Deterministic pre/post validation and learning. | Disabled by default unless adapter contract test proves native schema and payload. |
| Status | A user can view runtime, MCP, graph, memory, and hook health. | Native status line/command if available; otherwise `monomind status --json` and a platform command wrapper. |
| Upgrade/removal | The integration is idempotent and reversible. | Dry-run, diff, backup, merge, uninstall, and stale legacy cleanup. |

## File structure

| File or directory | Responsibility |
|---|---|
| `packages/@monomind/cli/src/platform-adapters/types.ts` | Canonical types, capability enum, install scopes, artifact model, diagnostics. |
| `packages/@monomind/cli/src/platform-adapters/registry.ts` | The only list of supported platforms and their capability declarations. |
| `packages/@monomind/cli/src/platform-adapters/core.ts` | Builds neutral instruction, skill, MCP, command, status, and hook intents. |
| `packages/@monomind/cli/src/platform-adapters/renderers/*.ts` | Platform-specific instruction, skill, MCP, hook, command, agent, and status renderers. |
| `packages/@monomind/cli/src/platform-adapters/operations.ts` | Plan, apply, upgrade, uninstall, backup, and doctor orchestration. |
| `packages/@monomind/cli/src/platform-adapters/discovery.ts` | Version/path/schema probes for experimental or evolving platforms. |
| `packages/@monomind/cli/src/mastermind/manifest.ts` | Canonical Mastermind skill manifest and aliases. |
| `packages/@monomind/cli/assets/mastermind/skills/**/SKILL.md` | Canonical portable workflows and references. |
| `packages/@monomind/cli/src/commands/platforms.ts` | Thin CLI facade delegating to `operations.ts`; removes local maps and legacy setup writers. |
| `packages/@monomind/cli/src/init/*` | Calls registry adapters instead of independently generating platform artifacts. |
| `packages/@monomind/cli/__tests__/platform-adapters/**` | Unit, fixture, merge/uninstall, hook-contract, and smoke tests. |
| `docs/platforms/compatibility.md` | Generated supported-platform and capability matrix for users. |
| `docs/mastermind/plans/2026-08-23-mastermind-cross-platform-parity.md` | This implementation and acceptance plan. |

## Implementation tasks

### Task 1: Freeze the capability baseline and registry vocabulary

**Files:**
- Create: `packages/@monomind/cli/src/platform-adapters/types.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/registry.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/registry.test.ts`
- Modify: `packages/@monomind/cli/src/commands/platforms.ts`

**Interfaces:**
- Produces `PlatformId`, `Capability`, `SupportLevel`, `PlatformAdapter`, and `PLATFORM_REGISTRY`.
- `platforms` CLI, init writers, documentation generator, and tests consume `PLATFORM_REGISTRY` only.

- [ ] **Step 1: Write the failing registry test**

```ts
import { describe, expect, it } from 'vitest';
import { PLATFORM_REGISTRY, PLATFORM_IDS } from '../../src/platform-adapters/registry.js';

describe('platform registry', () => {
  it('has one unique adapter for all sixteen supported targets', () => {
    expect(PLATFORM_IDS).toEqual([
      'claude', 'gemini', 'cursor', 'vscode', 'copilot', 'opencode', 'aider',
      'kiro', 'trae', 'openclaw', 'droid', 'antigravity', 'hermes', 'codex',
      'kimi', 'zed',
    ]);
    expect(new Set(PLATFORM_IDS).size).toBe(PLATFORM_IDS.length);
    expect(Object.keys(PLATFORM_REGISTRY)).toEqual(PLATFORM_IDS);
  });
});
```

- [ ] **Step 2: Implement the registry contract**

```ts
export const CAPABILITIES = [
  'instructions', 'skills', 'mcp', 'commands', 'agents', 'hooks', 'status', 'lifecycle',
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type SupportLevel = 'native' | 'cli_fallback' | 'unsupported' | 'experimental';
export type PlatformId =
  | 'claude' | 'gemini' | 'cursor' | 'vscode' | 'copilot' | 'opencode' | 'aider'
  | 'kiro' | 'trae' | 'openclaw' | 'droid' | 'antigravity' | 'hermes' | 'codex'
  | 'kimi' | 'zed';

export interface PlatformAdapter {
  id: PlatformId;
  displayName: string;
  capabilities: Record<Capability, SupportLevel>;
  projectArtifacts: readonly string[];
  userArtifacts: readonly string[];
  requiresDiscovery: boolean;
}
```

- [ ] **Step 3: Replace exported duplicate platform arrays with registry-derived values**

```ts
export const PLATFORM_IDS = Object.freeze([
  'claude', 'gemini', 'cursor', 'vscode', 'copilot', 'opencode', 'aider', 'kiro',
  'trae', 'openclaw', 'droid', 'antigravity', 'hermes', 'codex', 'kimi', 'zed',
] as const satisfies readonly PlatformId[]);

export const SUPPORTED_PLATFORMS = PLATFORM_IDS;
```

- [ ] **Step 4: Run the focused test**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/platform-adapters/registry.test.ts`

Expected: PASS; exactly sixteen adapters, no duplicates, and each has all eight capability values.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/commands/platforms.ts
git commit -m "refactor(platforms): add canonical adapter registry"
```

### Task 2: Create canonical Mastermind skill packages and the short router

**Files:**
- Create: `packages/@monomind/cli/src/mastermind/manifest.ts`
- Create: `packages/@monomind/cli/assets/mastermind/router/SKILL.md`
- Create: `packages/@monomind/cli/assets/mastermind/skills/`
- Create: `packages/@monomind/cli/src/__tests__/mastermind/manifest.test.ts`
- Modify: `packages/@monomind/cli/src/init/copy-assets.ts`

**Interfaces:**
- `MASTERMIND_SKILLS: readonly MastermindSkill[]` owns canonical name, description, aliases, body path, and required tool classes.
- `renderSkillPackage(skill, target)` always returns a valid `SKILL.md` beginning with `name` and `description` YAML fields.

- [ ] **Step 1: Write the failing canonical-skill test**

```ts
it('renders a portable Mastermind skill with required frontmatter', () => {
  const skill = MASTERMIND_SKILLS.find(({ name }) => name === 'mastermind-plan')!;
  const rendered = renderSkillPackage(skill, 'codex');
  expect(rendered).toMatch(/^---\nname: mastermind-plan\ndescription: .+\n---\n/m);
  expect(rendered).not.toContain('$CLAUDE_PROJECT_DIR');
  expect(rendered).not.toContain('SessionStart hook injection');
});
```

- [ ] **Step 2: Define the canonical manifest**

```ts
export interface MastermindSkill {
  name: string;
  description: string;
  aliases: readonly string[];
  source: string;
  mode: 'automatic' | 'manual';
}

export const MASTERMIND_SKILLS: readonly MastermindSkill[] = [
  { name: 'mastermind', description: 'Route work to the applicable Mastermind workflow.', aliases: ['master'], source: 'router/SKILL.md', mode: 'automatic' },
  { name: 'mastermind-plan', description: 'Write a verified implementation plan before code changes.', aliases: ['plan'], source: 'skills/plan/SKILL.md', mode: 'automatic' },
  { name: 'mastermind-review', description: 'Perform an evidence-backed technical review.', aliases: ['review'], source: 'skills/review/SKILL.md', mode: 'automatic' },
  { name: 'mastermind-debug', description: 'Diagnose a failure before proposing a fix.', aliases: ['debug'], source: 'skills/debug/SKILL.md', mode: 'automatic' },
];
```

- [ ] **Step 3: Write the router as concise always-available guidance**

```markdown
---
name: mastermind
description: Route a request to the relevant Mastermind workflow.
---

# Mastermind Router

Use `mastermind-plan` before multi-file implementation, `mastermind-review` for audits,
and `mastermind-debug` for failures. Load only the selected skill. Use Monograph before
broad repository search when the platform exposes the Monomind MCP server.
```

- [ ] **Step 4: Migrate command-only source material into canonical skills without deleting legacy commands**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/mastermind/manifest.test.ts src/__tests__/platforms-skills.test.ts`

Expected: PASS; every exported skill has metadata, source files, aliases, and no platform-specific environment variable outside an adapter template.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/mastermind packages/@monomind/cli/assets/mastermind packages/@monomind/cli/src/init/copy-assets.ts packages/@monomind/cli/src/__tests__/mastermind
git commit -m "feat(mastermind): add portable canonical skill packages"
```

### Task 3: Build neutral artifact intents and safe merge operations

**Files:**
- Create: `packages/@monomind/cli/src/platform-adapters/core.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/operations.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/merge.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/merge.test.ts`

**Interfaces:**
- `planInstall(request): Promise<PlatformPlan>` is side-effect free.
- `applyPlan(plan): Promise<ApplyResult>` writes only after preflight succeeds.
- `removeManagedBlock(content, marker)` preserves unrelated content byte-for-byte.

- [ ] **Step 1: Write failing merge and idempotency tests**

```ts
it('replaces only the managed TOML block and keeps user configuration', () => {
  const current = '[features]\nhooks = true\n\n# user comment\n';
  const once = mergeManagedBlock(current, '# monomind:start hooks', '# monomind:end hooks', '[[hooks.PreToolUse]]\n');
  const twice = mergeManagedBlock(once, '# monomind:start hooks', '# monomind:end hooks', '[[hooks.PreToolUse]]\n');
  expect(twice).toBe(once);
  expect(twice).toContain('# user comment');
});

it('uninstalls only Monomind-owned content', () => {
  expect(removeManagedBlock('# before\n# monomind:start x\nowned\n# monomind:end x\n# after\n', 'x'))
    .toBe('# before\n# after\n');
});
```

- [ ] **Step 2: Implement typed artifact intents**

```ts
export type ArtifactKind = 'instruction' | 'skill' | 'mcp' | 'command' | 'agent' | 'hook' | 'status' | 'plugin';
export interface ArtifactIntent {
  kind: ArtifactKind;
  path: string;
  content: string;
  marker?: string;
  scope: 'project' | 'user';
  replace: 'managed_block' | 'named_entry' | 'create_if_missing';
}
export interface PlatformPlan {
  platform: PlatformId;
  intents: readonly ArtifactIntent[];
  diagnostics: readonly string[];
}
```

- [ ] **Step 3: Implement dry-run, backup, and atomic application**

```ts
export async function installPlatform(request: InstallRequest): Promise<ApplyResult> {
  const plan = await planInstall(request);
  if (request.dryRun) return { changed: [], skipped: [], diagnostics: plan.diagnostics, plan };
  return applyPlan(plan);
}
```

- [ ] **Step 4: Run focused verification**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/platform-adapters/merge.test.ts`

Expected: PASS; second application is a no-op, dry-run does not write, uninstall restores user content, malformed user configuration yields a diagnostic and no mutation.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/__tests__/platform-adapters/merge.test.ts
git commit -m "feat(platforms): add managed artifact planning and safe merges"
```

### Task 4: Implement instructions, skills, and MCP for every platform

**Files:**
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/instructions.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/skills.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/mcp.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/core-parity.test.ts`
- Modify: `packages/@monomind/cli/src/init/mcp-generator.ts`
- Modify: `packages/@monomind/cli/src/init/write-codex.ts`
- Modify: `packages/@monomind/cli/src/init/write-opencode.ts`
- Modify: `packages/@monomind/cli/src/init/write-antigravity.ts`
- Modify: `packages/@monomind/cli/src/init/write-kimicode.ts`

**Interfaces:**
- `renderCoreArtifacts(adapter, options): ArtifactIntent[]` emits a concise instruction, router/package skills, and one named `monomind` MCP entry for every `native` or `cli_fallback` capability.
- `mcpCommand(platform, os)` owns Windows and POSIX command rendering.

- [ ] **Step 1: Write the all-target core-parity test**

```ts
it.each(PLATFORM_IDS)('%s has instructions, a router, and a tool path', (platform) => {
  const plan = renderCoreArtifacts(PLATFORM_REGISTRY[platform], testOptions);
  expect(plan.some(({ kind }) => kind === 'instruction')).toBe(true);
  expect(plan.some(({ kind, path }) => kind === 'skill' && path.endsWith('/mastermind/SKILL.md'))).toBe(true);
  expect(plan.some(({ kind }) => kind === 'mcp') || PLATFORM_REGISTRY[platform].capabilities.mcp === 'cli_fallback').toBe(true);
});
```

- [ ] **Step 2: Make the short instruction platform-neutral**

```markdown
<!-- monomind:start instructions -->
# Monomind

Use the `monomind` MCP tools for graph navigation, impact analysis, memory, and organization work.
For multi-step work, load the applicable `mastermind-*` skill; do not load all workflows at once.
If MCP is unavailable, run `npx -y monomind@latest doctor` and use `npx -y monomind@latest` commands.
<!-- monomind:end instructions -->
```

- [ ] **Step 3: Render documented target locations**

```ts
const CORE_LOCATIONS: Record<PlatformId, { instruction: string; skillRoot?: string; mcp?: string }> = {
  claude: { instruction: 'CLAUDE.md', skillRoot: '.claude/skills', mcp: '.mcp.json' },
  codex: { instruction: 'AGENTS.md', skillRoot: '.codex/skills', mcp: '.codex/config.toml' },
  opencode: { instruction: 'AGENTS.md', skillRoot: '.opencode/skills', mcp: 'opencode.json' },
  kimi: { instruction: 'AGENTS.md', skillRoot: '.kimi-code/skills', mcp: '.kimi-code/mcp.json' },
  droid: { instruction: 'AGENTS.md', skillRoot: '.factory/skills', mcp: '.factory/settings.json' },
  openclaw: { instruction: 'AGENTS.md', skillRoot: '.agents/skills', mcp: 'openclaw.json' },
  // Remaining adapters provide their tested native paths in dedicated renderer data.
};
```

- [ ] **Step 4: Preserve CLI fallbacks for Aider, unknown Trae/Hermes versions, and any unavailable MCP host**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/platform-adapters/core-parity.test.ts`

Expected: PASS; all sixteen targets have a concise instruction and router; every non-native MCP target has a clear CLI fallback diagnostic.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/init
git commit -m "feat(platforms): provide core Mastermind and MCP parity"
```

### Task 5: Add native commands, agents, status, and organization entry points

**Files:**
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/commands.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/agents.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/status.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/enhancement-parity.test.ts`
- Modify: `packages/@monomind/cli/src/init/opencode-generator.ts`
- Modify: `packages/@monomind/cli/src/init/kimi-generator.ts`
- Modify: `packages/@monomind/cli/src/init/codex-generator.ts`

**Interfaces:**
- `commandAliases(skill: MastermindSkill, adapter: PlatformAdapter): ArtifactIntent[]` exposes a native command only where it is documented.
- `renderStatus(adapter): ArtifactIntent | undefined` returns a platform status line/command or `undefined` with a CLI fallback capability.

- [ ] **Step 1: Write failing feature parity assertions**

```ts
it.each(['claude', 'opencode', 'droid', 'kimi'] as const)('%s has native command aliases', (platform) => {
  expect(renderEnhancements(PLATFORM_REGISTRY[platform], testOptions).some(({ kind }) => kind === 'command')).toBe(true);
});

it.each(PLATFORM_IDS)('%s reports either native status or CLI fallback', (platform) => {
  const capabilities = PLATFORM_REGISTRY[platform].capabilities;
  expect(capabilities.status === 'native' || capabilities.status === 'cli_fallback').toBe(true);
});
```

- [ ] **Step 2: Use one portable command vocabulary**

```ts
export const COMMAND_ALIASES = {
  plan: 'mastermind-plan', review: 'mastermind-review', debug: 'mastermind-debug',
  research: 'mastermind-research', status: 'monomind status', doctor: 'monomind doctor',
  org: 'monomind org run', memory: 'monomind memory',
} as const;
```

- [ ] **Step 3: Map commands/agents/status only through adapter-owned renderers**

```ts
if (adapter.capabilities.commands === 'native') intents.push(...renderCommands(adapter));
if (adapter.capabilities.agents === 'native') intents.push(...renderAgents(adapter));
if (adapter.capabilities.status === 'native') intents.push(renderStatus(adapter)!);
else diagnostics.push(`${adapter.displayName}: use \`monomind status --json\` for status.`);
```

- [ ] **Step 4: Run focused verification**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/platform-adapters/enhancement-parity.test.ts`

Expected: PASS; native command names do not collide, all named agent definitions include explicit tool policy, and every platform exposes a status path.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/init
git commit -m "feat(platforms): add commands agents and status parity"
```

### Task 6: Rebuild hooks as optional, platform-specific contracts

**Files:**
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/hooks.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/hook-bridge.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/hooks.test.ts`
- Modify: `packages/@monomind/cli/src/init/codex-generator.ts`
- Modify: `packages/@monomind/cli/src/init/write-codex.ts`
- Modify: `packages/@monomind/cli/src/init/write-opencode.ts`
- Modify: `packages/@monomind/cli/src/init/write-kimicode.ts`
- Modify: `packages/@monomind/cli/src/commands/platforms.ts`

**Interfaces:**
- `normalizeHookInput(platform, payload): NormalizedHookEvent | null` converts only documented hook payloads.
- `runHook(event, policy): HookResult` has one 2-second default timeout and explicit `allow | block | observe` result.
- Default policy is `observe`; `block` requires `--enable-blocking-hooks`.

- [ ] **Step 1: Write hook input and failure-mode tests**

```ts
it('never converts a hook bridge failure into a failed agent tool call in observe mode', async () => {
  const result = await runHook({ event: 'PreToolUse', tool: 'shell_command', input: {} }, { mode: 'observe', timeoutMs: 20 });
  expect(result.exitCode).toBe(0);
});

it('renders no SessionStart prompt injection for any platform', () => {
  for (const platform of PLATFORM_IDS) expect(renderHooks(PLATFORM_REGISTRY[platform])).not.toContain('SessionStart');
});
```

- [ ] **Step 2: Define the normal form and exit behavior**

```ts
export interface NormalizedHookEvent {
  event: 'PreToolUse' | 'PostToolUse';
  tool: string;
  cwd: string;
  input: Record<string, unknown>;
}
export interface HookResult { exitCode: 0 | 2; reason?: string; }
```

- [ ] **Step 3: Replace all bridges that call `.claude/helpers` directly**

The new bridge must import runtime-neutral Monomind policy code. It must never set `CLAUDE_PROJECT_DIR`, assume a Claude tool name, print human-readable text on protocol stdout, or let an exception exit non-zero in observe mode.

- [ ] **Step 4: Test rendered schemas and subprocess behavior**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/platform-adapters/hooks.test.ts`

Expected: PASS; each native hook adapter parses sample stdin, returns the required result shape, completes under two seconds, and fails open unless blocking was opted in.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/init packages/@monomind/cli/src/commands/platforms.ts
git commit -m "feat(platforms): add opt-in native hook contracts"
```

### Task 7: Implement every platform renderer and experimental discovery probes

**Files:**
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/claude.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/gemini.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/cursor.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/copilot.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/opencode.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/aider.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/kiro.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/openclaw.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/droid.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/antigravity.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/codex.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/kimi.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/zed.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/renderers/experimental.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/discovery.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/discovery.test.ts`

**Interfaces:**
- Every renderer implements `render(adapter, request): PlatformPlan`.
- Trae, Hermes, and any changing Antigravity/Zed layout implement `discover(commandRunner): DiscoveryResult` before native enhancement artifacts are planned.

- [ ] **Step 1: Write the adapter completeness test**

```ts
it.each(PLATFORM_IDS)('%s resolves to a renderer', (platform) => {
  expect(getRenderer(platform)).toBeDefined();
});

it('does not enable experimental features when discovery is missing', async () => {
  const plan = await planInstall({ platform: 'trae', scope: 'project', discovery: { available: false } });
  expect(plan.intents.some(({ kind }) => kind === 'hook')).toBe(false);
  expect(plan.diagnostics).toContain('Trae: native enhancements require successful discovery.');
});
```

- [ ] **Step 2: Implement each renderer with a narrow responsibility**

Each renderer may only emit artifacts described by its registry capability declaration. It must use `renderCoreArtifacts` for shared content, add native enhancements only when its capability is `native`, and use a dedicated parser/serializer for JSON or TOML.

- [ ] **Step 3: Use a common discovery result**

```ts
export interface DiscoveryResult {
  available: boolean;
  version?: string;
  paths: Readonly<Record<string, string>>;
  features: ReadonlySet<Capability>;
  diagnostics: readonly string[];
}
```

- [ ] **Step 4: Run focused verification**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/platform-adapters/discovery.test.ts src/__tests__/platform-adapters/registry.test.ts`

Expected: PASS; all sixteen renderers resolve; discovery failure produces no native unverified artifact; no renderer writes outside its selected scope.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters
git commit -m "feat(platforms): implement native and discovered renderers"
```

### Task 8: Replace legacy platform commands and migrate existing installations

**Files:**
- Modify: `packages/@monomind/cli/src/commands/platforms.ts`
- Modify: `packages/@monomind/cli/src/commands/init.ts`
- Modify: `packages/@monomind/cli/src/init/executor.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/migration.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/migration.test.ts`

**Interfaces:**
- `monomind platforms install --platform <id> [--scope project|user] [--dry-run] [--enable-hooks]`
- `monomind platforms upgrade --all [--dry-run]`
- `monomind platforms doctor [--platform <id>]`
- `monomind platforms uninstall --platform <id> [--remove-legacy]`

- [ ] **Step 1: Write failing legacy migration tests**

```ts
it('removes the obsolete Codex activation block without removing user hooks', async () => {
  const result = await migrateLegacyInstall(fixture('codex-legacy-config.toml'));
  expect(result.content).not.toContain('monomind-activate.cjs');
  expect(result.content).toContain('# user hook');
});

it('reports unsupported legacy shared-skill roots rather than deleting user skills', async () => {
  const result = await migrateLegacyInstall(fixture('legacy-agent-skills'));
  expect(result.diagnostics).toContain('Manual review required for shared user skill root.');
});
```

- [ ] **Step 2: Remove old setup behavior**

Delete `MASTERMIND_ACTIVATE_SCRIPT`, `setupCodex`, `setupCursor`, and `setupAntigravity` from the legacy command after equivalent adapter operations exist. Keep a migration detector for their markers and files; it must not delete files that lack a Monomind ownership marker.

- [ ] **Step 3: Make init select adapters rather than writing platform-specific copies**

```ts
for (const platform of selectedPlatforms) {
  const result = await installPlatform({ platform, scope: 'project', options, dryRun: false });
  initResult.created.files.push(...result.changed);
  initResult.errors.push(...result.diagnostics.filter((message) => message.startsWith('ERROR:')));
}
```

- [ ] **Step 4: Run migration verification**

Run: `pnpm --filter @monomind/cli exec vitest run src/__tests__/platform-adapters/migration.test.ts src/__tests__/commands/platforms.test.ts`

Expected: PASS; all four platform subcommands use the registry, dry-run is mutation-free, legacy Codex prompt injection is removed only when owned, and uninstall remains idempotent.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/commands/platforms.ts packages/@monomind/cli/src/commands/init.ts packages/@monomind/cli/src/init/executor.ts packages/@monomind/cli/src/platform-adapters
git commit -m "refactor(platforms): migrate installers to adapter operations"
```

### Task 9: Add fixture contracts, real smoke tests, and generated compatibility documentation

**Files:**
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/fixtures/`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/fixtures.test.ts`
- Create: `packages/@monomind/cli/src/__tests__/platform-adapters/smoke.test.ts`
- Create: `packages/@monomind/cli/src/platform-adapters/docs.ts`
- Create: `docs/platforms/compatibility.md`
- Modify: `.github/workflows/ci.yml` or the existing CI workflow that runs CLI tests

**Interfaces:**
- One fixture per platform includes pristine, user-customized, malformed, and legacy configuration samples.
- `renderCompatibilityMatrix(registry): string` is the only producer of the public platform table.

- [ ] **Step 1: Write the fixture matrix test**

```ts
it.each(PLATFORM_IDS)('%s fixture supports plan, apply, upgrade, and uninstall', async (platform) => {
  const directory = await copyFixture(platform, 'user-customized');
  const first = await installPlatform({ platform, path: directory, scope: 'project' });
  const second = await installPlatform({ platform, path: directory, scope: 'project' });
  const removed = await uninstallPlatform({ platform, path: directory, scope: 'project' });
  expect(first.changed.length).toBeGreaterThan(0);
  expect(second.changed).toEqual([]);
  expect(removed.diagnostics.filter((line) => line.startsWith('ERROR:'))).toEqual([]);
});
```

- [ ] **Step 2: Add subprocess smoke checks**

For every `native` MCP adapter, launch its rendered `npx -y monomind@latest mcp start` command in a temporary directory, send an MCP initialization request, and assert the tool list contains `monograph_query`, `memory_search`, and `platforms_doctor`. For hook-capable targets, pass the saved sample stdin payload to the hook bridge and assert a zero exit in observe mode.

- [ ] **Step 3: Generate compatibility documentation from the registry**

```ts
export function renderCompatibilityMatrix(registry: PlatformRegistry): string {
  const rows = PLATFORM_IDS.map((id) => {
    const adapter = registry[id];
    return `| ${adapter.displayName} | ${CAPABILITIES.map((capability) => adapter.capabilities[capability]).join(' | ')} |`;
  });
  return ['# Monomind platform compatibility', '', '| Platform | Instructions | Skills | MCP | Commands | Agents | Hooks | Status | Lifecycle |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}
```

- [ ] **Step 4: Run full verification**

Run: `pnpm --filter @monomind/cli test && pnpm --filter @monomind/cli typecheck && pnpm --filter @monomind/cli lint`

Expected: PASS. If a pre-existing unrelated failure remains, record its exact command, package, test name, and error separately; do not label the release verified.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/__tests__/platform-adapters packages/@monomind/cli/src/platform-adapters/docs.ts docs/platforms .github
git commit -m "test(platforms): add compatibility contract matrix"
```

### Task 10: Release safely and prove upgrades on clean machines

**Files:**
- Create: `docs/platforms/migration-guide.md`
- Modify: `packages/@monomind/cli/src/commands/doctor.ts`
- Modify: `packages/@monomind/cli/src/commands/update.ts`
- Modify: release notes/changelog path used by the repository

**Interfaces:**
- `monomind doctor --platform <id> --json` returns adapter version, detected runtime version, capability levels, config ownership, MCP health, skill-frontmatter validation, and hook state.
- `monomind platforms upgrade --all --dry-run` prints a complete change plan before mutation.

- [ ] **Step 1: Write doctor acceptance tests**

```ts
it('reports native capabilities and legacy migration advice as structured JSON', async () => {
  const report = await runDoctor({ platform: 'codex', json: true, fixture: 'legacy-codex' });
  expect(report.platform).toBe('codex');
  expect(report.capabilities.skills).toBe('native');
  expect(report.legacy.findings).toContain('Remove Monomind SessionStart protocol injector.');
});
```

- [ ] **Step 2: Add migration guidance with exact safety behavior**

Document that the upgrade disables only Monomind-marked legacy prompt injection, preserves user hooks/configuration, creates a timestamped backup before a schema rewrite, and requires a full runtime restart to load changed hook configuration.

- [ ] **Step 3: Validate release candidates in a clean temporary home**

Run each native CLI with an isolated `HOME`, initialize a temporary repository, install one adapter, invoke the platform's noninteractive config/diagnostic command if available, and run `monomind platforms doctor --json`. Test at least macOS/Linux and Windows command rendering in CI.

- [ ] **Step 4: Run final verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`

Expected: PASS, generated compatibility documentation matches the registry, no legacy SessionStart protocol-injection code remains, and all smoke suites pass.

- [ ] **Step 5: Commit**

```bash
git add docs/platforms packages/@monomind/cli/src/commands
git commit -m "docs(platforms): publish parity migration and diagnostics"
```

## Acceptance gates

The revision is complete only when all statements below are true:

1. There is one registry containing the same sixteen platforms used by `init`, `platforms`, Monograph skill installation, doctor, tests, and generated documentation.
2. Every target provides a project instruction, Mastermind router, portable skill path, and either MCP or a clearly tested CLI fallback.
3. Every `SKILL.md` validates `name` and `description`; no generated skill relies on Claude-only variables, paths, or tool names.
4. No generated configuration injects the full Mastermind protocol at SessionStart.
5. Hooks are opt-in, platform-specific, payload-tested, under two seconds by default, and fail open in observe mode.
6. Install, upgrade, and uninstall are idempotent and preserve user content for every platform fixture.
7. `monomind platforms doctor --json` accurately reports available, fallback, experimental, and unsupported capabilities.
8. The public compatibility table is generated from the registry and includes Kimi Code and Zed.
9. All focused tests, the full test suite, typecheck, lint, and native MCP smoke tests pass.

## Risks and decisions

- **Do not promise identical user interfaces.** Aider has no skill/hook/status equivalent; parity is the same workflow and tools through concise conventions plus CLI/MCP fallback.
- **Do not automatically enable unverified integration points.** Trae, Hermes, and fast-changing Antigravity/Zed layouts require version discovery before native enhancement artifacts are emitted.
- **Do not use hooks as a prompt delivery mechanism.** Hooks are runtime code with real failure semantics. The existing Codex errors demonstrate why they must be isolated from instruction loading.
- **Do not let format conversion be lossy.** Canonical skill content is neutral; platform renderers may add a short wrapper but cannot rewrite procedural meaning.
- **Treat user scope as explicit consent.** Global skills/configuration can affect multiple projects and coding runtimes, so the default remains project scope.

## Research sources consulted

- [Claude Code: extension surfaces and loading model](https://code.claude.com/docs/en/features-overview)
- [Claude Code: hook configuration and SessionStart guidance](https://code.claude.com/docs/en/hooks)
- [VS Code: Agent Skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [GitHub Copilot: customization overview](https://docs.github.com/en/copilot/customizing-copilot)
- [Cursor: Agent Hooks](https://cursor.com/docs/agent/hooks)
- [OpenCode: Skills](https://opencode.ai/docs/skills/)
- [Kiro: Steering](https://kiro.dev/docs/steering/)
- [Droid: Skills](https://docs.factory.ai/harness/skills)
- [Droid: Hooks](https://docs.factory.ai/harness/hooks)
- [OpenClaw: Skills](https://docs.openclaw.ai/tools/skills)
- [Google Antigravity: product customization](https://www.antigravity.google/product/antigravity-2)
- [Kimi Code: Skills](https://www.kimi.ai/help/features/use-skills-in-code)
- [Kimi Code: Plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html)
- [Zed: Agents](https://zed.dev/docs/ai/agents)

## Self-review

- **Coverage:** The plan covers the full discovered target set, core Monomind functionality, Mastermind delivery, MCP, commands, agents, hooks, status, initialization, migration, removal, testing, release, and user documentation.
- **Known limitation:** Trae and Hermes native schema/path details are intentionally gated behind discovery because reliable authoritative documentation was not established during the audit. They retain core parity through instructions and CLI/MCP paths, rather than receiving guessed configuration.
- **Consistency:** `PlatformId`, `Capability`, `SupportLevel`, `PlatformAdapter`, `PLATFORM_REGISTRY`, `ArtifactIntent`, `PlatformPlan`, and `DiscoveryResult` are defined before tasks consume them. No task depends on an undeclared feature name.
- **Placeholder scan:** No implementation task defers a required behavior without a named interface, concrete files, test, expected result, and acceptance condition.

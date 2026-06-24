# Reengineer Squad — Cycle 1 Implementation Plan

**Date**: 2026-06-24
**Source**: impeccable v3.1.0
**Target**: monomind / monodesign skill

---

## Critic Architect Verdicts

### ADOPT (port closely, low change needed)

| Module | Rationale |
|---|---|
| `antipatterns-catalog-delta` | 17 patterns rigorously defined in impeccable's registry. Monodesign's catalog already follows the same format. Direct append — no restructuring needed. High immediate value: these are the patterns monodesign's audit/critique will miss until added. |
| `codex-reference` | A self-contained reference file for image-gen workflows. Monodesign already has `reference/brand.md` and `reference/image-prompts.md`, but lacks the 4-stop palette/mock gate flow codex.md defines. Drop-in addition with no integration risk. |
| `hooks-reference` | `reference/hooks.md` covers design detector hook management. Monodesign already references hooks in SKILL.md but has no reference/hooks.md. The impeccable source maps 1:1 to monomind's hook system (Claude Code settings.local.json path is the same). Minor adaptation: replace `npx impeccable` references with `npx monomind` or note the external dependency clearly. |
| `brand-workflow-reference` | `reference/brand-workflow.md` fills a gap in monodesign's brand decision chain. Monodesign has `reference/brand.md` but not the workflow decision tree for sequencing brand choices. Low risk, high value for craft/shape flows. |

### ADAPT (valuable but requires adjustment for monomind conventions)

| Module | Rationale |
|---|---|
| `cli-detection-engine` | Impeccable's 44-rule Node.js engine is the most technically sophisticated piece. It has genuine value: DESIGN.md token diffing, 4 scan engines (browser, regex, static-html, visual), a 2,671-line rule set. However, shipping the full engine as-is into monomind would add a heavy Node.js runtime dependency. Adaptation: expose the engine as an optional monomind CLI sub-command (`monomind design detect`) that delegates to `npx impeccable detect` when impeccable is installed, with a graceful fallback message when it's not. This preserves value without duplicating 3,500+ lines of engine code that is actively maintained upstream. Update monodesign SKILL.md anti-pattern detection section to document this. |
| `skill-runtime-scripts` | context.mjs, palette.mjs, detect.mjs, and hook.mjs are valuable for live mode and hook management. However, they are deeply tied to impeccable's config schema (`.impeccable/config.json`). Adaptation: for monodesign, the relevant pieces are (1) palette.mjs logic — port the OKLCH brand seed algorithm as a standalone script under `packages/@monomind/cli/src/commands/design-palette.ts`, and (2) hook integration pattern — document the hook wiring in monodesign's hooks.md reference without porting the runtime. Live mode scripts (3,716 lines, Svelte-specific) are out of scope for Cycle 1. |
| `specialist-subagents` | `impeccable-asset-producer.md` is a Codex-native image production agent — highly relevant for monodesign's `images` command. `impeccable-manual-edit-applier.md` is specific to impeccable's live mode protocol. Adaptation: port `impeccable-asset-producer.md` as `monodesign-asset-producer.md` under `.claude/skills/monodesign/agents/`, replacing Codex-specific tool names with monodesign equivalents. Veto `impeccable-manual-edit-applier.md` — it's tied to impeccable's live server protocol. |

### VETO (concept is clear; do not implement now)

| Module | Reason |
|---|---|
| `browser-extension` | Chrome MV3 extension duplicates monobrowse's existing CDP browser automation. Monomind's strength is server-side agent orchestration, not browser distribution. Adding a packaged Chrome extension would require a separate release pipeline, Chrome Web Store account, and ongoing maintenance that adds zero value to the core agent platform. The anti-pattern detection use case is already served by the CLI engine. **Preserved for re-evaluation if a monomind desktop companion product is ever scoped.** |
| `live-mode-runtime` | 3,716 lines of Svelte/SvelteKit live variant mode server with its own HMR injection, browser DOM protocol, and manual edit session store. This is a browser development tool tightly coupled to Svelte's component model. Monomind targets multi-framework agent orchestration, not a specific frontend framework's dev experience. The complexity-to-value ratio is extremely high for Cycle 1. **Preserved for re-evaluation when monomind has a dedicated browser tooling product area.** |

---

## Idea Generator Proposals (incorporated into verdicts)

- **Anti-pattern detection as a monomind CLI command**: rather than duplicating the engine, wrap `npx impeccable detect` as `monomind design detect` — users get the full engine immediately, and maintenance stays upstream. This is better than the original impeccable approach where detection is bundled inside the skill (duplicating code across projects).
- **OKLCH palette script as a standalone design token generator**: impeccable's `palette.mjs` is a hidden gem — an OKLCH brand color seeder. Extract this algorithm into a first-class monomind CLI tool (`monomind design palette`) that could be used outside the monodesign skill context for any project color system work.
- **Antipattern catalog as a living reference**: monodesign's catalog should track impeccable's registry as the upstream source of truth. Add a comment header to `reference/antipatterns-catalog.md` noting the source and version, making future syncs explicit and automated-friendly.

---

## Ordered Task Cards

### Task Card 1 (Priority: CRITICAL)
**ID**: `task-1-antipatterns-delta`
**Title**: Add 17 missing anti-patterns to monodesign's antipatterns-catalog.md
**Verdict**: ADOPT
**Target file**: `/Users/morteza/Desktop/tools/monomind/.claude/skills/monodesign/reference/antipatterns-catalog.md`
**Source**: `/Users/morteza/Desktop/tools/impeccable/cli/engine/registry/antipatterns.mjs`

**What to do**:
1. Read the existing `antipatterns-catalog.md` to understand format (each entry: `### \`id\` — Name`, Detect, Why it's wrong, Fix)
2. Extract the 19 missing patterns from impeccable's registry with their descriptions
3. Append them in the correct category sections (slop vs quality), maintaining alphabetical order within each category
4. Update the category counts in the catalog header (slop: 15→23, quality: 12→23)
5. Add a version comment at the top: `<!-- Synced from impeccable v3.1.0 registry. Source of truth: cli/engine/registry/antipatterns.mjs -->`

**Patterns to add (slop category)**: `aphoristic-cadence`, `cream-palette`, `em-dash-overuse`, `extreme-negative-tracking`, `gpt-thin-border-wide-shadow`, `image-hover-transform`, `marketing-buzzword`, `numbered-section-markers`, `oversized-h1`, `repeated-section-kickers`, `repeating-stripes-gradient`, `theater-slop-phrase`

**Patterns to add (quality category)**: `body-text-viewport-edge`, `broken-image`, `clipped-overflow-container`, `design-system-color`, `design-system-font`, `design-system-radius`, `text-overflow`

**Test criteria**: grep `antipatterns-catalog.md` for all 19 IDs — all must be present. Category counts in header must be updated. Format must match existing entries (### header, Detect/Why/Fix structure).

---

### Task Card 2 (Priority: HIGH)
**ID**: `task-2-codex-reference`
**Title**: Add reference/codex.md to monodesign for image-gen direction workflow
**Verdict**: ADOPT
**Target file**: `/Users/morteza/Desktop/tools/monomind/.claude/skills/monodesign/reference/codex.md`
**Source**: `/Users/morteza/Desktop/tools/impeccable/skill/reference/codex.md`

**What to do**:
1. Read impeccable's `skill/reference/codex.md` in full
2. Port it to monodesign with these adaptations:
   - Replace `{{command_prefix}}impeccable craft` with `/monodesign craft`
   - Replace any references to `craft.md` with `reference/craft.md`
   - Replace `{{command_prefix}}` template variable with `/monodesign`
   - Keep all 4 stop points and workflow structure intact (this is the core value)
3. Update monodesign's `reference/craft.md` to reference `reference/codex.md` when image generation is available

**Test criteria**: File exists at target path. All 4 stop points (A-D) are present. No `{{` template variables remain. `/monodesign` references are correct.

---

### Task Card 3 (Priority: HIGH)
**ID**: `task-3-hooks-reference`
**Title**: Add reference/hooks.md to monodesign for design detector hook management
**Verdict**: ADAPT
**Target file**: `/Users/morteza/Desktop/tools/monomind/.claude/skills/monodesign/reference/hooks.md`
**Source**: `/Users/morteza/Desktop/tools/impeccable/skill/reference/hooks.md`

**What to do**:
1. Read impeccable's `skill/reference/hooks.md` in full
2. Port it to monodesign with these adaptations:
   - Replace all `npx impeccable` references with `npx impeccable` (keep as external dep — monodesign delegates to impeccable for detection)
   - Replace `{{command_prefix}}impeccable hooks` with `/monodesign hooks`
   - Replace `.impeccable/config.json` path references with a note that the config lives at `.impeccable/config.json` when using the impeccable detector backend
   - Add a note at the top: "Monodesign integrates the impeccable design detector for anti-pattern detection. This reference covers how to manage the detection hook per project."
   - Keep all action table rows (status/on/off/ignore-rule/ignore-file/ignore-value/reset)
   - Preserve the harness support table (Claude Code / Codex / Cursor / Copilot)
3. Update SKILL.md to add `hooks` to the commands table pointing to `reference/hooks.md`

**Test criteria**: File exists. All 7 hook actions are documented. Harness table is present. SKILL.md commands table includes `hooks` entry.

---

### Task Card 4 (Priority: MEDIUM)
**ID**: `task-4-brand-workflow-reference`
**Title**: Add reference/brand-workflow.md to monodesign
**Verdict**: ADOPT
**Target file**: `/Users/morteza/Desktop/tools/monomind/.claude/skills/monodesign/reference/brand-workflow.md`
**Source**: `/Users/morteza/Desktop/tools/impeccable/skill/reference/brand-workflow.md`

**What to do**:
1. Read impeccable's `skill/reference/brand-workflow.md` in full
2. Port it replacing template variables (`{{command_prefix}}` → `/monodesign`)
3. Verify it doesn't overlap with or contradict monodesign's existing `reference/brand.md`
4. If there's overlap, merge or cross-reference rather than duplicate
5. Update monodesign's `reference/craft.md` and `reference/shape.md` to reference brand-workflow.md where appropriate

**Test criteria**: File exists. No template variables remain. No substantive contradiction with brand.md. craft.md or shape.md cross-references it.

---

### Task Card 5 (Priority: MEDIUM)
**ID**: `task-5-monodesign-asset-producer-agent`
**Title**: Port impeccable-asset-producer as monodesign-asset-producer agent
**Verdict**: ADAPT
**Target file**: `/Users/morteza/Desktop/tools/monomind/.claude/skills/monodesign/agents/monodesign-asset-producer.md`
**Source**: `/Users/morteza/Desktop/tools/impeccable/skill/agents/impeccable-asset-producer.md`

**What to do**:
1. Read impeccable's `skill/agents/impeccable-asset-producer.md` in full
2. Port with these adaptations:
   - Replace `name: impeccable-asset-producer` → `name: monodesign-asset-producer`
   - Replace `codex-name: impeccable_asset_producer` → `codex-name: monodesign_asset_producer`
   - Remove `providers: codex` (or keep as optional — the agent logic is not Codex-specific)
   - Replace any `npx impeccable` references with appropriate equivalents
   - Keep the full Input Contract, Core Rule, and Workflow sections — they are the primary value
3. Create the agents directory if it doesn't exist: `.claude/skills/monodesign/agents/`
4. Update monodesign's `reference/image-prompts.md` to reference this agent when raster asset production is needed

**Test criteria**: File exists in new `agents/` directory. Frontmatter is valid YAML. No `impeccable-` name references remain. image-prompts.md cross-references it.

---

### Task Card 6 (Priority: LOW — but high long-term value)
**ID**: `task-6-cli-detect-command`
**Title**: Add `monomind design detect` CLI command wrapping impeccable's detector
**Verdict**: ADAPT
**Target file**: `/Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/design-detect.ts`
**Secondary**: Update monodesign SKILL.md anti-pattern section

**What to do**:
1. Explore `packages/@monomind/cli/src/commands/` to understand command structure conventions
2. Create `design-detect.ts` — a thin wrapper command that:
   - Checks if `npx impeccable` is available (via `which impeccable` or package.json check)
   - If available: delegates to `npx impeccable detect <args>` and forwards stdout/stderr
   - If not available: prints a helpful message: "Install impeccable for design anti-pattern detection: npm install -g impeccable"
   - Exposes `--json` flag for machine-readable output
   - Has typed TypeScript interface for the result shape
3. Register the command in `packages/@monomind/cli/src/commands/index.ts` under `design` namespace
4. Update monodesign SKILL.md: replace `npx impeccable detect` invocation with `monomind design detect` as the primary call, with `npx impeccable detect` as a fallback note

**Test criteria**: `monomind design detect --help` works. Graceful error when impeccable not installed. TypeScript compiles without errors. SKILL.md updated.

---

## Skipped (VETO) — Preserved for Future Cycles

| Module | Reason | Re-evaluate when |
|---|---|---|
| Browser extension | Duplicates monobrowse CDP; wrong distribution model for monomind | Desktop companion product is scoped |
| Live-mode runtime | 3,716-line Svelte-specific server; framework-locked complexity | Monomind browser tooling product area exists |
| `impeccable-manual-edit-applier.md` agent | Tied to impeccable's live server protocol | If monodesign ships its own live variant server |

---

## Pendng Modules Queue (after Cycle 1)

Modules queued for implementation in subsequent cycles (after task cards above are completed):

1. `task-1-antipatterns-delta` — immediate, file edit only
2. `task-2-codex-reference` — immediate, file creation only
3. `task-3-hooks-reference` — immediate, file creation + SKILL.md edit
4. `task-4-brand-workflow-reference` — immediate, file creation only
5. `task-5-monodesign-asset-producer-agent` — file creation + directory creation
6. `task-6-cli-detect-command` — TypeScript CLI work, requires test

# Implementation Plan: monolean for monomind

**Analyst role:** Integration Planner
**Date:** 2026-06-24
**Branch naming convention:** `port/monolean-<card-id>`

---

## Phase 1 — Core Delivery (5 task cards)

These cards deliver the minimum viable monolean feature: skill + hooks + statusline + debt tracking + token delta.

---

### Card 1: monolean skill files

**Branch:** `port/monolean-skills`
**Verdict source:** ADAPT (core-skill, review-skill, audit-skill, debt-skill, help-skill)

**Files to create:**
- `.claude/skills/monolean/SKILL.md`
- `.claude/skills/monolean-review/SKILL.md`
- `.claude/skills/monolean-audit/SKILL.md`
- `.claude/skills/monolean-debt/SKILL.md`
- `.claude/skills/monolean-help/SKILL.md`

**Implementer instructions:**

Port the 5 skills from ponytail with these changes applied uniformly:

1. Replace all occurrences of "ponytail" (case-insensitive) with "monolean" in frontmatter name fields, description trigger lists, body text, and comment convention markers.
2. In `monolean/SKILL.md` frontmatter, update `argument-hint` to `"[lite|full|ultra]"` (unchanged) and add `license: MIT`.
3. In the `monolean/SKILL.md` body, add this paragraph after the ladder section:
   ```
   In monomind projects: rung 2 is assisted by the knowledge graph (run monograph_query for the symbol you think already exists before writing); rung 5 is assisted by monograph_query with the package name to confirm it is imported somewhere.
   ```
4. In `monolean-debt/SKILL.md`, extend the output section to add: "Also writes findings to `.monomind/metrics/monolean-debt.json` when run inside a monomind project."
5. In `monolean-help/SKILL.md`, update the config section: replace `~/.config/ponytail/config.json` with `.monomind/state/monolean-mode` and `PONYTAIL_DEFAULT_MODE` with `MONOLEAN_DEFAULT_MODE`.

**Validation:**
- All 5 files exist
- `grep -ri "ponytail" .claude/skills/monolean* --include="*.md"` returns zero results
- YAML frontmatter is valid (name, description, argument-hint, license fields present)
- Each SKILL.md has the correct skill name matching its directory

---

### Card 2: monolean helper scripts

**Branch:** `port/monolean-hooks`
**Verdict source:** ADOPT/ADAPT (monolean-config, monolean-instructions, monolean-activate, monolean-propagate, monolean-tracker, monolean-runtime→restructured)

**Files to create:**
- `.claude/helpers/monolean-config.cjs`
- `.claude/helpers/monolean-instructions.cjs`
- `.claude/helpers/monolean-activate.cjs`
- `.claude/helpers/monolean-propagate.cjs`
- `.claude/helpers/monolean-tracker.cjs`

**Implementer instructions:**

**monolean-config.cjs** — Port `ponytail-config.js`:
```javascript
'use strict';
const path = require('path');
const fs = require('fs');

const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'review'];
const DEFAULT_MODE = 'full';
const STATE_FILE = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.monomind/state/monolean-mode');

function getDefaultMode() {
  const env = process.env.MONOLEAN_DEFAULT_MODE;
  if (env && VALID_MODES.includes(env)) return env;
  try {
    return fs.readFileSync(STATE_FILE, 'utf8').trim() || DEFAULT_MODE;
  } catch { return DEFAULT_MODE; }
}

function setMode(mode) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, mode);
}

function readMode() {
  try { return fs.readFileSync(STATE_FILE, 'utf8').trim(); } catch { return null; }
}

function clearMode() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

function isDeactivationCommand(text) {
  return /^(stop monolean|normal mode)[.!]?$/i.test(text.trim());
}

module.exports = { VALID_MODES, DEFAULT_MODE, STATE_FILE, getDefaultMode, setMode, readMode, clearMode, isDeactivationCommand };
```

**monolean-instructions.cjs** — Port `ponytail-instructions.js`:
- Read SKILL.md from `.claude/skills/monolean/SKILL.md` relative to `CLAUDE_PROJECT_DIR`
- Rename `getPonytailInstructions` to `getMonoleanInstructions`
- In `filterSkillBodyForMode`, change regex from exact string to: `/\|\s*\*\*${mode}\*\*\s*\|/` and `/^- ${mode}:/`
- `getFallbackInstructions(mode)` returns a 7-line hardcoded ladder summary (monolean-branded) as failsafe

**monolean-activate.cjs** — Port `ponytail-activate.js` (ADAPT — Claude Code only):
```javascript
'use strict';
const { getDefaultMode, setMode, clearMode } = require('./monolean-config.cjs');
const { getMonoleanInstructions } = require('./monolean-instructions.cjs');

const mode = getDefaultMode();
if (!mode || mode === 'off') { clearMode(); process.exit(0); }

setMode(mode);

// Write mode for statusline
const fs = require('fs'), path = require('path');
const metricsDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.monomind/metrics');
try {
  fs.mkdirSync(metricsDir, { recursive: true });
  fs.writeFileSync(path.join(metricsDir, 'monolean-mode.json'), JSON.stringify({ mode, ts: Date.now() }));
} catch {}

const instructions = getMonoleanInstructions(mode);
process.stdout.write(instructions);
```

**monolean-propagate.cjs** — Port `ponytail-subagent.js` (ADOPT):
```javascript
'use strict';
const { readMode } = require('./monolean-config.cjs');
const { getMonoleanInstructions } = require('./monolean-instructions.cjs');

const mode = readMode();
if (!mode || mode === 'off') process.exit(0);

const instructions = getMonoleanInstructions(mode);
// Claude Code SubagentStart: write to hookSpecificOutput JSON
process.stdout.write(JSON.stringify({ hookSpecificOutput: instructions }));
```

**monolean-tracker.cjs** — Port `ponytail-mode-tracker.js` (ADAPT):
```javascript
'use strict';
const { VALID_MODES, setMode, clearMode, isDeactivationCommand } = require('./monolean-config.cjs');

let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    const { prompt } = JSON.parse(data);
    if (isDeactivationCommand(prompt)) { clearMode(); process.exit(0); }
    const m = prompt.match(/^[/@$]monolean\s*(\w+)?/i);
    if (!m) process.exit(0);
    const requested = (m[1] || 'full').toLowerCase();
    if (!VALID_MODES.includes(requested)) process.exit(0);
    if (requested === 'off') clearMode();
    else setMode(requested);
  } catch {}
});
```

**Note on monolean-runtime.cjs:** RESTRUCTURE verdict — do NOT port the multi-platform runtime. The scripts above use direct stdout writes for Claude Code only. This eliminates ~100 lines of dead platform-switching code.

**Validation:**
- All 5 files exist and are syntactically valid Node.js (`node --check`)
- `node .claude/helpers/monolean-activate.cjs` exits 0 and writes something to stdout when `MONOLEAN_DEFAULT_MODE=full` is set
- `echo '{"prompt":"/monolean ultra"}' | node .claude/helpers/monolean-tracker.cjs` exits 0 and writes `ultra` to `.monomind/state/monolean-mode`
- `echo '{"prompt":"stop monolean"}' | node .claude/helpers/monolean-tracker.cjs` exits 0 and removes the state file

---

### Card 3: hook registration in settings.json

**Branch:** `port/monolean-hooks` (same branch as Card 2)
**Verdict source:** ADOPT (hooks-manifest)
**Files to edit:** `.claude/settings.json`

**Implementer instructions:**

Read `.claude/settings.json`. In the hooks array:

1. Under `SessionStart` matchers, append:
   ```json
   {
     "matcher": "",
     "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/helpers/monolean-activate.cjs\"", "timeout": 5000 }]
   }
   ```

2. Under `SubagentStart` matchers, append:
   ```json
   {
     "matcher": "",
     "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/helpers/monolean-propagate.cjs\"", "timeout": 3000 }]
   }
   ```

3. Add a new top-level `UserPromptSubmit` key (if absent) with:
   ```json
   {
     "matcher": "",
     "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/helpers/monolean-tracker.cjs\"", "timeout": 3000 }]
   }
   ```

**Validation:**
- `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"` exits 0 (valid JSON)
- `grep -c "monolean" .claude/settings.json` returns 3

---

### Card 4: statusline integration

**Branch:** `port/monolean-statusline`
**Verdict source:** ADAPT (statusline-script)
**Files to edit:** `packages/@monomind/hooks/src/statusline/index.ts`

**Implementer instructions:**

Read the StatuslineGenerator class. Add lean mode display:

1. In the method that reads metrics files, add:
   ```typescript
   const monoleanPath = path.join(projectDir, '.monomind/metrics/monolean-mode.json');
   let leanMode: string | null = null;
   try {
     const lm = JSON.parse(fs.readFileSync(monoleanPath, 'utf8'));
     if (lm.mode && lm.mode !== 'off') leanMode = lm.mode;
   } catch {}
   ```

2. In the statusline string assembly, append the lean badge if leanMode is set:
   ```typescript
   if (leanMode) {
     parts.push(leanMode === 'full' ? '[LEAN]' : `[LEAN:${leanMode.toUpperCase()}]`);
   }
   ```

Use the same pattern as the existing metric reads (try/catch, graceful skip on missing file).

**Validation:**
- TypeScript compiles without errors: `cd packages/@monomind/hooks && npx tsc --noEmit`
- When `.monomind/metrics/monolean-mode.json` contains `{"mode":"ultra"}`, statusline output includes `[LEAN:ULTRA]`
- When file is absent, statusline output is unchanged

---

### Card 5: lean-delta token command

**Branch:** `port/monolean-token-delta`
**Verdict source:** Proposal 2 (Innovation)
**Files to edit:**
- `.claude/helpers/capture-handler.cjs` (add mode field to snapshot)
- `packages/@monomind/cli/src/commands/tokens.ts` (add `lean-delta` subcommand)

**Implementer instructions:**

**capture-handler.cjs changes:**

In the snapshot-writing section (SubagentStart path), add lean mode to the snapshot JSON:
```javascript
const leanModePath = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.monomind/state/monolean-mode');
let leanMode = null;
try { leanMode = fs.readFileSync(leanModePath, 'utf8').trim(); } catch {}
// Add leanMode to existing snapshot object
snapshot.leanMode = leanMode || 'off';
```

**tokens.ts changes:**

Add a `lean-delta` subcommand after the existing `today` command:
```typescript
program.command('hooks lean-delta')
  .description('Compare token cost: sessions with monolean active vs without')
  .action(async () => {
    // Load session snapshots from .claude/data/ or wherever capture-handler writes them
    // Group by leanMode field: truthy vs 'off'/null
    // Compute average cost per group
    // Print comparison table
    const data = loadSnapshotData(); // reuse existing snapshot loader
    const lean = data.filter(s => s.leanMode && s.leanMode !== 'off');
    const normal = data.filter(s => !s.leanMode || s.leanMode === 'off');
    if (lean.length < 3 || normal.length < 3) {
      console.log('Not enough data yet. Need 3+ sessions in each group.');
      return;
    }
    const avg = (arr: any[]) => arr.reduce((s, x) => s + (x.cost || 0), 0) / arr.length;
    const leanAvg = avg(lean), normalAvg = avg(normal);
    const delta = ((leanAvg - normalAvg) / normalAvg * 100).toFixed(1);
    console.log(`Sessions with monolean: ${lean.length}  avg cost: $${leanAvg.toFixed(4)}`);
    console.log(`Sessions without:       ${normal.length}  avg cost: $${normalAvg.toFixed(4)}`);
    console.log(`delta: ${delta}%`);
  });
```

Note: The implementer must read capture-handler.cjs first to understand the exact snapshot format and storage location before writing.

**Validation:**
- `node --check .claude/helpers/capture-handler.cjs` exits 0
- TypeScript compiles: `cd packages/@monomind/cli && npx tsc --noEmit`
- `monomind hooks lean-delta` (or `npx ts-node`) runs without crash when no data exists, prints "Not enough data" message

---

## Phase 2 — Extensions (3 task cards, deferred)

These cards add the monomind-exclusive superpowers. Implement after Phase 1 is stable.

---

### Card 6: ReasoningBank rung memory (Proposal 1)

**Branch:** `port/monolean-rung-memory`
**Estimated effort:** Medium

Add SubagentStop hook `monolean-learn.cjs` that records which ladder rung fired (parsed from session context or user feedback signal) and stores to ReasoningBank. Extend `monolean-activate.cjs` to query ReasoningBank and prepend a per-project rung-affinity hint.

Prerequisite: Understand the exact ReasoningBank API from `packages/@monomind/hooks/src/index.ts` before implementing.

---

### Card 7: Monograph rung-5 dep assist (Proposal 3)

**Branch:** `port/monolean-dep-assist`
**Estimated effort:** Medium

Extend `monolean-tracker.cjs` to call `mcp__monomind__monograph_query` with the submitted prompt description, filter results to external IMPORT edges, and prepend a dep-hint to the prompt before it reaches the model. Only fires when monolean is active.

---

### Card 8: init --lean AGENTS.md injection (Proposal 6)

**Branch:** `port/monolean-init-lean`
**Estimated effort:** Low

Add `--lean` flag to `monomind init`. When passed, write a 15-line AGENTS.md fragment (monolean ladder condensed, no frontmatter) to the project root. Fragment should be read from `.claude/skills/monolean/AGENTS-fragment.md` (a new file to create alongside Card 1).

---

## Execution Order

```
Card 1 (skills) → Card 2+3 (hooks + registration) → Card 4 (statusline) → Card 5 (token delta)
                                                          ↓ (after Phase 1 verified stable)
                              Card 6 (rung memory) || Card 7 (dep assist) || Card 8 (init lean)
```

Cards 2 and 3 share a branch and must be committed together. All others are independent.

---

## Files Changed Summary

| Card | New Files | Modified Files |
|------|-----------|----------------|
| 1 | 5 skill files | 0 |
| 2 | 5 helper scripts | 0 |
| 3 | 0 | `.claude/settings.json` |
| 4 | 0 | `packages/@monomind/hooks/src/statusline/index.ts` |
| 5 | 0 | `.claude/helpers/capture-handler.cjs`, `packages/@monomind/cli/src/commands/tokens.ts` |
| Total Phase 1 | 10 | 3 |

---

## Definition of Done (Phase 1)

- [ ] All 5 skill files exist, zero "ponytail" occurrences in them
- [ ] All 5 helper scripts are syntactically valid and pass their smoke tests
- [ ] `settings.json` registers all 3 hooks and is valid JSON
- [ ] StatuslineGenerator compiles and shows `[LEAN]` badge when active
- [ ] `monomind hooks lean-delta` command exists and handles the no-data case gracefully
- [ ] All changes committed on `port/monolean-*` branches
- [ ] No secrets committed, no files created in repo root

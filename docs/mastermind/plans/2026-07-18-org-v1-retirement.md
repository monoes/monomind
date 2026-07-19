# Org Runtime v1 Retirement — v2 Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the v1 prompt-orchestrated org path everywhere: `/mastermind:runorg` delegates to the v2 CLI daemon, v1-only skills carry an explicit `v1` suffix, all on-disk v1 configs are migrated, and a new `monomind org migrate` command automates the conversion.

**Architecture:** The v2 daemon (`packages/@monomind/cli/src/orgrt/`) is already the complete runtime — SDK sessions per role, `org_send` bus, self-forwarded dashboard events, scheduler, human-input `question` events. Retirement is therefore: (a) one new CLI subcommand (`org migrate`), (b) skill-layer renames and a thin v2 delegator for runorg, (c) data migration of 6 configs across 3 projects, (d) docs/reference sweep. No daemon changes.

**Tech Stack:** TypeScript (CLI), vitest, markdown skills, jq/bash inside skills.

## Global Constraints

- Every `.claude` edit MUST be mirrored into `packages/@monomind/cli/.claude/` (npm-shipped copy) in the same task.
- v1 behavior stays REACHABLE under explicit `v1` names (`runorgv1`, `approvev1`, `heartbeatv1`) — retired from defaults, not deleted.
- Migration NEVER destroys data: original config saved as `<name>.v1.json` beside the migrated file; monotask boards are left untouched (only config references to them are dropped).
- `OrgDefSchema` and `RoleSchema` are passthrough — migration must still run `org validate` on its output and refuse to write on failure.
- A currently-RUNNING org is never migrated in place: `org migrate` refuses when `isOrgRunning()` is true (reuse the guard from `deleteAction`).
- The portal/server.mjs KEEPS reading v1 fields (`cfg.loop`, `topology`) for historical runs — no server changes in this plan.
- All new event emissions follow the tokenized curl pattern (`x-monomind-token` from `.monomind/dashboard-token`).
- Files stay under 500 lines; org.ts is at ~460 — `migrate` lands in a new `src/orgrt/migrate.ts` with a thin subcommand wrapper.
- **Deprecation marker (MANDATORY):** every v1 artifact — renamed skill files, command wrappers, v1-only branches inside dual-reader skills, the `.v1.json` backup convention doc line — carries the literal greppable marker `LEGACY-ORG-V1` in a comment or header line. Cleanup day is `grep -rl LEGACY-ORG-V1` and delete. No v1 artifact without the marker; no marker on anything that must survive v1 removal.
- **v2 is the unqualified default:** every skill, doc, and reference that says "org" means v2. v1 appears only under explicitly-suffixed names (`runorgv1`, `approvev1`, `heartbeatv1`) or marker-tagged legacy branches.

## Current-State Inventory (evidence, 2026-07-18)

**On-disk configs (V1 = has `topology`/`loop`/`board_id`/role `agent_type`):**

| Config | Shape | Project |
|---|---|---|
| dlsoe-remittance-partners, monomind-audit, monomind-growth, orgrt-builders | V1 | monomind |
| diff-demo, org-alpha, org-beta, orgrt-demo, sample-team | v2 | monomind |
| srs-research-swarm | V1 (run LIVE right now via v1 path) | alansari |
| email-triage, srs-research-swarm-matrix | v2 | alansari |
| exec-llm-course | V1 | aicourse |

**Skill surface:**

| Skill | v1 coupling | Disposition |
|---|---|---|
| `createorg` | none (already pure v2) | keep — no `createorgv1` needed, there is no v1 behavior left to preserve |
| `runorg` | ENTIRE skill (boss Task agent, monotask board, ORG_VARS/runcontext, curl events) | rename → `runorgv1`; new `runorg` = thin v2 delegator |
| `stoporg` | reads `.loop` for legacy orgs (already v2-aware) | keep; v2-first ordering, label v1 branch legacy |
| `orgs` / `orgstatus` | dual-aware readers | keep; no rename (readers must understand both shapes forever) |
| `approve` | reads `-approvals.json` written only by v1 bosses | rename → `approvev1`; v2 equivalent is the Human Input tab (`question` bus events) |
| `heartbeat` | wakes agents via monotask board task queues | rename → `heartbeatv1`; v2 equivalent is a chat message to the role (dashboard Send / daemon inbox) |
| `monitor` | monotask/Linear/GitHub watcher — orthogonal to org runtime | keep as-is (not org-coupled; out of scope) |

**Missing pieces:** no `org migrate` command; no v1→v2 conversion doc; master.md/help/reference text still describes runorg as the way to start orgs.

---

### Task 1: `monomind org migrate` — v1→v2 config conversion

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/migrate.ts`
- Modify: `packages/@monomind/cli/src/commands/org.ts` (register subcommand)
- Test: `packages/@monomind/cli/__tests__/orgrt/org-migrate.test.ts` (create)

**Interfaces:**
- Consumes: `OrgDefSchema` (`../orgrt/types.js`), `validateOrgName`/`isOrgRunning`/`listOrgConfigFiles` (org.ts), `parseSchedule` (`../orgrt/scheduler.js`).
- Produces: `migrateOrgConfig(raw: Record<string, unknown>): { def: Record<string, unknown>; dropped: string[]; notes: string[] }` (pure, exported for tests) and `migrateAction(ctx: CommandContext): Promise<CommandResult>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/orgrt/org-migrate.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateOrgConfig } from '../../src/orgrt/migrate.js';
import { orgCommand } from '../../src/commands/org.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

const V1 = {
  name: 'growth', goal: 'grow', version: 1, topology: 'hierarchical',
  consensus: 'raft', strategy: 'specialized', maxAgents: 8,
  communication: { channels: ['all'] }, board_id: 'b-1', todo_col_id: 'c-1',
  loop: { poll_interval_minutes: 30, last_run: 'x', next_run: 'y', run_prompt_file: 'p.md' },
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null, agent_type: 'coordinator', delegates_to: ['dev'], responsibilities: ['lead'] },
    { id: 'dev', title: 'Dev', reports_to: 'boss', agent_type: 'coder', responsibilities: ['build'] },
  ],
};

describe('migrateOrgConfig', () => {
  it('drops v1-only keys, maps loop interval to schedule, keeps roles', () => {
    const { def, dropped } = migrateOrgConfig(structuredClone(V1));
    expect(def.schedule).toBe('30m');
    expect(def.status).toBe('stopped');
    for (const k of ['topology', 'consensus', 'strategy', 'maxAgents', 'communication', 'board_id', 'todo_col_id', 'loop', 'version']) {
      expect(def).not.toHaveProperty(k);
      expect(dropped).toContain(k);
    }
    const roles = def.roles as Record<string, unknown>[];
    expect(roles).toHaveLength(2);
    expect(roles[0]).not.toHaveProperty('agent_type');
    expect(roles[0]).not.toHaveProperty('delegates_to');
    expect(roles[1].reports_to).toBe('boss');
  });

  it('leaves an already-v2 config unchanged except normalization', () => {
    const v2 = { name: 'clean', goal: 'g', schedule: null, roles: [{ id: 'boss', reports_to: null }] };
    const { def, dropped } = migrateOrgConfig(structuredClone(v2));
    expect(dropped).toEqual([]);
    expect(def.name).toBe('clean');
  });

  it('maps agent_type onto type when type is missing', () => {
    const raw = { name: 'x', roles: [{ id: 'boss', reports_to: null, agent_type: 'coordinator' }] };
    const { def } = migrateOrgConfig(structuredClone(raw));
    expect((def.roles as Record<string, unknown>[])[0].type).toBe('coordinator');
  });
});

describe('org migrate subcommand', () => {
  const setup = (): string => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-'));
    mkdirSync(join(cwd, ORG_DIR), { recursive: true });
    writeFileSync(join(cwd, ORG_DIR, 'growth.json'), JSON.stringify(V1));
    return cwd;
  };
  const migrate = (cwd: string, ...args: string[]) =>
    orgCommand.subcommands!.find(c => c.name === 'migrate')!
      .action!({ args, flags: {}, cwd, interactive: false } as any);

  it('migrates a v1 config, backs up the original, and validates the result', async () => {
    const cwd = setup();
    try {
      const res = await migrate(cwd, 'growth');
      expect(res?.success).toBe(true);
      expect(existsSync(join(cwd, ORG_DIR, 'growth.v1.json'))).toBe(true);
      const out = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'growth.json'), 'utf8'));
      expect(out.topology).toBeUndefined();
      expect(out.schedule).toBe('30m');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('refuses to migrate a running org', async () => {
    const cwd = setup();
    try {
      mkdirSync(join(cwd, ORG_DIR, 'growth'), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'growth', 'runtime.json'),
        JSON.stringify({ status: 'running', pid: process.pid }));
      const res = await migrate(cwd, 'growth');
      expect(res?.success).toBe(false);
      expect(existsSync(join(cwd, ORG_DIR, 'growth.v1.json'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('reports a nonexistent org cleanly', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-none-'));
    try {
      const res = await migrate(cwd, 'ghost');
      expect(res?.success).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/org-migrate.test.ts`
Expected: FAIL — `migrate.js` module not found / `migrate` subcommand missing.

- [ ] **Step 3: Implement `src/orgrt/migrate.ts`**

```typescript
// packages/@monomind/cli/src/orgrt/migrate.ts
/** v1 → v2 org config conversion. Pure transform + validation; file IO stays
 * in the org command so tests can exercise the transform directly. */
import { OrgDefSchema } from './types.js';

const V1_TOP_LEVEL_KEYS = [
  'topology', 'consensus', 'strategy', 'maxAgents', 'communication',
  'board_id', 'todo_col_id', 'doing_col_id', 'done_col_id', 'loop',
  'version', 'channels', 'differentiation', 'outputDir', 'runBehavior', 'created',
] as const;
const V1_ROLE_KEYS = ['agent_type', 'delegates_to', 'board_id'] as const;

export function migrateOrgConfig(raw: Record<string, unknown>): {
  def: Record<string, unknown>; dropped: string[]; notes: string[];
} {
  const def: Record<string, unknown> = { ...raw };
  const dropped: string[] = [];
  const notes: string[] = [];

  // v1 loop → v2 schedule ("<N>m"); only when no v2 schedule already set
  const loop = def['loop'] as { poll_interval_minutes?: number } | null | undefined;
  if (loop && typeof loop.poll_interval_minutes === 'number' && def['schedule'] == null) {
    def['schedule'] = `${loop.poll_interval_minutes}m`;
    notes.push(`loop.poll_interval_minutes=${loop.poll_interval_minutes} → schedule "${def['schedule']}"`);
  }

  for (const k of V1_TOP_LEVEL_KEYS) {
    if (k in def) { delete def[k]; dropped.push(k); }
  }

  if (Array.isArray(def['roles'])) {
    def['roles'] = (def['roles'] as Record<string, unknown>[]).map(role => {
      const r = { ...role };
      if (typeof r['agent_type'] === 'string' && (r['type'] == null || r['type'] === 'specialist' || r['type'] === undefined)) {
        if (r['type'] == null) { r['type'] = r['agent_type']; notes.push(`role ${String(r['id'])}: agent_type → type`); }
      }
      for (const k of V1_ROLE_KEYS) delete r[k];
      return r;
    });
  }

  if (def['schedule'] === undefined) def['schedule'] = null;
  if (typeof def['status'] !== 'string') def['status'] = 'stopped';

  // Throws ZodError on an unmigratable config — caller surfaces it.
  OrgDefSchema.parse(def);
  return { def, dropped, notes };
}
```

- [ ] **Step 4: Register the subcommand in `org.ts`**

Add to imports: `import { migrateOrgConfig } from '../orgrt/migrate.js';`

Add the action (after `validateAction`):

```typescript
const migrateAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const validated = validateOrgName(ctx.args[0]);
  if (!validated.ok) return validated.result;
  const name = validated.name;
  const cwd = ctx.cwd;
  const cfgPath = join(cwd, ORG_DIR, `${name}.json`);
  if (!existsSync(cfgPath)) {
    log(output.error(`Org not found: ${name}`));
    return { success: false, message: 'org not found' };
  }
  if (isOrgRunning(cwd, name)) {
    log(output.error(`Org "${name}" is currently running — stop it first, then migrate.`));
    return { success: false, message: 'org is running' };
  }
  const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  let result: ReturnType<typeof migrateOrgConfig>;
  try {
    result = migrateOrgConfig(raw);
  } catch (err) {
    log(output.error(`Cannot migrate ${name}: ${err instanceof Error ? err.message : String(err)}`));
    return { success: false, message: 'migration produced an invalid config' };
  }
  if (result.dropped.length === 0 && result.notes.length === 0) {
    log(output.info(`${name}: already v2 — nothing to migrate.`));
    return { success: true, message: 'already v2' };
  }
  const { writeFileSync } = await import('node:fs');
  const backup = join(cwd, ORG_DIR, `${name}.v1.json`);
  if (!existsSync(backup)) writeFileSync(backup, JSON.stringify(raw, null, 2));
  writeFileSync(cfgPath, JSON.stringify(result.def, null, 2));
  log(output.success(`${name}: migrated to v2 (backup: ${name}.v1.json)`));
  for (const d of result.dropped) log(output.info(`  dropped v1 field: ${d}`));
  for (const n of result.notes) log(output.info(`  ${n}`));
  log(output.info(`  run it with: monomind org run ${name}`));
  return { success: true, message: `migrated ${name}` };
};
```

Register in `subcommands` after `validate`:

```typescript
    {
      name: 'migrate', description: 'Convert a v1 org config (topology/board/loop) to the v2 daemon shape',
      examples: [{ command: 'monomind org migrate growth', description: 'Migrate one org; original saved as growth.v1.json' }],
      action: migrateAction,
    },
```

Update the usage string to include `migrate`. **Also update `listOrgConfigFiles`'s exclusion:** `.v1.json` backups must not be listed as orgs — add `&& !f.endsWith('.v1.json')` to its filter, and add a test asserting a `growth.v1.json` sibling is not listed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/org-migrate.test.ts __tests__/orgrt/org-command.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json` — expected exit 0.

```bash
git add packages/@monomind/cli/src/orgrt/migrate.ts packages/@monomind/cli/src/commands/org.ts packages/@monomind/cli/__tests__/orgrt/org-migrate.test.ts
git commit -m "feat(cli): org migrate converts v1 org configs to the v2 daemon shape"
```

---

### Task 2: `runorg` becomes the v2 delegator; v1 path renamed `runorgv1`

**Files:**
- Rename: `.claude/skills/mastermind-skills/runorg.md` → `.claude/skills/mastermind-skills/runorgv1.md` (git mv; prepend a header: "LEGACY-ORG-V1 — prompt-orchestrated path. Reach it only via /mastermind:runorgv1. For everything else use /mastermind:runorg (v2 delegator).")
- Rename: `.claude/commands/mastermind/runorg.md` → `.claude/commands/mastermind/runorgv1.md` (update its Skill() call to `mastermind-skills:runorgv1`)
- Create: `.claude/skills/mastermind-skills/runorg.md` (new v2 delegator, full content below)
- Create: `.claude/commands/mastermind/runorg.md` (thin wrapper invoking the new skill)
- Mirror: all four into `packages/@monomind/cli/.claude/`

**Interfaces:**
- Consumes: `monomind org validate|migrate|run|serve|logs` (Task 1), `.monomind/control.json` + `dashboard-token` convention.
- Produces: `/mastermind:runorg <name>` → v2 daemon run; `/mastermind:runorgv1 <name>` → old path, explicit opt-in only.

- [ ] **Step 1: git mv both runorg files to runorgv1 and add the LEGACY header**
- [ ] **Step 2: Write the new `runorg.md` skill with exactly this flow:**

````markdown
---
name: mastermind-runorg
description: Start a saved org via the Org Runtime v2 daemon (monomind org run/serve). Migrates v1-shaped configs first. The legacy prompt-orchestrated path lives in runorgv1.
type: domain-skill
default_mode: auto
---

# Mastermind Runorg (v2)

Starts orgs exclusively through the v2 SDK daemon. Every role becomes a live
SDK session; events reach the dashboard through the daemon's own forwarder —
no curl emissions, no delivery gaps.

## Steps

1. **Resolve the org.** `org_name` from params. List available orgs when missing:
   `monomind org list`.
2. **Validate.** Run `monomind org validate <name>`.
   - Valid → step 4.
   - Invalid AND the errors are v1-shape symptoms (`topology`, `board_id`,
     `loop`, role `agent_type` reported as unknown/legacy) → step 3.
   - Invalid otherwise → surface the validator output and stop.
3. **Migrate (v1 configs).** `monomind org migrate <name>` — original is kept
   as `<name>.v1.json`. In confirm mode ask first; in auto mode migrate and
   state it. If migration fails, stop and surface the error — do NOT fall back
   to runorgv1 silently.
4. **Start.**
   - One-shot (no `schedule` in config): run in background bash:
     `monomind org run <name> --task "<optional task from params>"`
   - Scheduled (`schedule` set): ensure the daemon host is up:
     `monomind org serve` (background) — it picks up every scheduled org.
5. **Confirm liveness.** Within ~15 s: `monomind org status <name>` shows
   `running`. Surface the dashboard link (`<CTRL_URL>/orgs`) and
   `monomind org logs <name> --follow` as the tail command.
6. **Never** spawn a boss Task agent, create monotask boards, or emit
   dashboard events manually. If the user explicitly asks for the legacy
   behavior, direct them to `/mastermind:runorgv1` (deprecated).
````

- [ ] **Step 3: New command wrapper `runorg.md`** — standard preamble (repeat flags, brain load) + `Skill("mastermind-skills:runorg")` + brain write + `_repeat` (copy the structure of any current thin command wrapper, e.g. stoporg's).
- [ ] **Step 4: Mirror all four files into the package copy; verify with `diff -rq`.**
- [ ] **Step 5: Grep sweep for stale references:** `runorg` mentions in `master.md`, `help.md`, `orgs.md`, `orgstatus.md`, `createorg.md`, `_protocol.md` must describe the v2 delegator (or explicitly say `runorgv1` where the legacy path is meant). Update each line found.
- [ ] **Step 6: Commit** (`feat(mastermind): runorg delegates to org runtime v2; legacy path moved to runorgv1`).

---

### Task 3: `approve` → `approvev1`, `heartbeat` → `heartbeatv1`; tag every v1 branch

**Files:**
- Rename (git mv) both skill files + both command wrappers; update each command wrapper's `Skill()` target; prepend `LEGACY-ORG-V1` headers pointing to the v2 equivalent (approve → dashboard Human Input tab / `question` bus events; heartbeat → send the role a chat message from the dashboard, or `monomind org logs <name>` to inspect).
- Modify: `orgs.md`, `orgstatus.md`, `stoporg.md`, `org-settings.md` — these stay dual-readers, but every v1-only branch/section (`.loop` handling, `topology` display, v1 field validation) gets a `<!-- LEGACY-ORG-V1: remove this branch when v1 orgs are gone -->` comment immediately above it, and their prose leads with v2 (v1 branches read as the fallback, not the default). `org-settings.md` (the update-org skill) must edit v2 fields (`schedule`, `run_config`, roles) as its primary flow.
- Mirror into the package copy.
- Update `master.md`'s routing table row "Review and action pending agent approval requests" → point at `approvev1` with the note "(v1 orgs only — v2 approvals arrive in the dashboard Human Input tab)".
- Update `help.md` listing accordingly.

- [ ] **Step 1: git mv + LEGACY-ORG-V1 headers + Skill() retargets**
- [ ] **Step 2: Tag v1 branches in the four dual-reader skills; make v2 the leading flow in each**
- [ ] **Step 3: master.md + help.md routing text updates**
- [ ] **Step 4: Verify marker coverage: `grep -rl "LEGACY-ORG-V1" .claude | sort` lists exactly: runorgv1 (skill+command), approvev1 (skill+command), heartbeatv1 (skill+command), orgs.md, orgstatus.md, stoporg.md, org-settings.md**
- [ ] **Step 5: Mirror, verify `diff -rq` clean, commit**

---

### Task 4: Migrate the six on-disk v1 configs

**Files:** data only — `.monomind/orgs/*.json` in monomind, alansari, aicourse.

- [ ] **Step 1 (monomind):** for each of `dlsoe-remittance-partners`, `monomind-audit`, `monomind-growth`, `orgrt-builders`: `monomind org migrate <name>` then `monomind org validate <name>`. Expected: `migrated` + `valid`.
- [ ] **Step 2 (aicourse):** `cd /Volumes/media/projects/aicourse && monomind org migrate exec-llm-course && monomind org validate exec-llm-course`.
- [ ] **Step 3 (alansari):** `srs-research-swarm` is LIVE on the v1 path — wait for the run to finish (or the user stops it), then either migrate it or adopt the already-v2 `srs-research-swarm-matrix.json` as its replacement (decide by diffing goals/roles; if matrix is the intended successor, delete the v1 config after backup, else migrate normally). Do NOT touch while running.
- [ ] **Step 4:** Verify no org listing shows `.v1.json` backups (Task 1's filter) and the portal still lists all orgs (`/api/orgs` with token).
- [ ] **Step 5:** Commit config changes in monomind (`chore(orgs): migrate v1 org configs to v2 shape`); alansari/aicourse are outside the repo — report, don't commit.

---

### Task 5: Docs and reference sweep

**Files:**
- Modify: `CLAUDE.md` (root — "Org runtime v2: use `monomind org run <name>` — the /mastermind:runorg prompt path is deprecated" → update to "…/mastermind:runorg now delegates to the v2 daemon; the legacy prompt path is /mastermind:runorgv1"), `packages/@monomind/cli/CLAUDE.md` (org row: add `migrate` to the subcommand list), `docs/commands/mastermind-reference.md`, `.claude/skills/mastermind-skills/help.md`.
- Update memory: `org-runtime-v2-status.md` auto-memory (v1 fully retired; runorg = v2 delegator).

- [ ] **Step 1:** Apply the four doc edits; grep each file for `runorg`/`approve`/`heartbeat` and reconcile every mention with the new names.
- [ ] **Step 2:** Mirror `help.md` into the package copy.
- [ ] **Step 3:** Commit (`docs: v1 org path retired — runorg/approve/heartbeat point at v2`).

---

### Task 6: End-to-end verification gate

- [ ] **Step 1:** `monomind org validate` (no name) in monomind — every config valid, zero v1 shapes reported.
- [ ] **Step 2:** `monomind org test-loop -n 1` — the e2e verification loop passes against a scratch v2 org.
- [ ] **Step 3:** Start one migrated org for real (`monomind org run monomind-audit --task "smoke check"` or the cheapest migrated org), confirm on the portal: LIVE badge, chat events flowing (daemon forwarder), then stop it.
- [ ] **Step 4:** `/mastermind:runorg <that org>` in a fresh session — confirm it routes through the CLI (no Task-spawned boss, no board creation).
- [ ] **Step 5:** Full suite: `npx vitest run` in the CLI package + `tsc --noEmit`. Expected: green.
- [ ] **Step 6:** Final review per taskdev (final-reviewer-prompt.md, diff from plan-start BASE), then `mastermind:finish`.

## Rollout order & risk

Tasks 1 → 2 → 3 → 5 are code/doc changes safe to land immediately (v1 stays reachable under v1 names throughout). Task 4 is data migration gated on Task 1 and on the srs run ending. Task 6 gates completion. Riskiest step is Task 2 Step 5 (reference sweep — easy to miss a mention); the grep in that step plus Task 6 Step 4's live check cover it.

## Self-Review (spec coverage / placeholders / type consistency)

- Every v1 surface from the inventory table has a task: runorg (T2), approve/heartbeat (T3), configs (T4), docs (T5), tooling gap (T1). `monitor` explicitly out of scope; `orgs`/`orgstatus`/`stoporg` stay dual-readers by design.
- No TBDs; migrate transform + action + tests are complete code; skill content for the new runorg is complete.
- `migrateOrgConfig` signature consistent across Task 1 steps; `isOrgRunning`/`validateOrgName` exist in org.ts today (verified in session); `parseSchedule` import listed but only needed if schedule validation is added to migrate — validation already happens via `org validate` in the flow, so migrate.ts does not import it (Interfaces line corrected accordingly).

// packages/@monomind/cli/__tests__/orgrt/sections-off-golden.test.ts
//
// README: the sections-off golden net (org sections spec 13.1.3, piece P3.0).
//
// What this is. Every org whose definition has no top-level `sections` key must
// behave byte for byte as it did on `main` at the capture commit, whatever else
// it sets. The seven checks of 13.1.3 are pinned here against committed fixtures
// in `fixtures/sections-off/*.json`, captured from `main` BEFORE any sections
// behaviour existed: (1) prompt bytes, (2) tool list and schemas per role and
// callback combination, (3) provider tools and their position after the org
// tools, (4) bus events of a scripted run, (5) state files, (6) mailbox messages
// and receipts, (7) configuration: OrgDefSchema defaults, checklistFindings and
// the signature digest. Tests that use a real OrgDaemon run it with a stub
// queryFn (no model) and wait on counted conditions, never on sleeps; the clock
// that matters (lead-watch) is a fake one. Only truly volatile values (run and
// bus ids, timestamps, pids, temp paths, uuids) are normalised, by
// `support/normalize-golden.ts` (itself tested in normalize-golden.test.ts).
//
// Frozen for the whole phase. These goldens, and the four prompt/tool SHAs in
// src/__tests__/org-loadouts-default-off.test.ts (second copy in
// frozen-sha-tripwire.test.ts), stay frozen until the phase ends. A piece that
// fails here is wrong, not the test.
//
// How to re-capture, deliberately. Only the piece that intentionally changes
// prompts (P3.12) may, and the initial capture (P3.0) did. From the cli package:
//   SECTIONS_OFF_GOLDEN_RECAPTURE=P3.12 npx vitest run __tests__/orgrt/sections-off-golden.test.ts
// rewrites the fixtures (any other value is refused by support/golden-capture.ts;
// without the variable a missing or different fixture is a failure and nothing is
// written). Review the fixture diff line by line, and change the four frozen SHAs
// in BOTH files in the same commit, saying why. On a mismatch the actual value is
// written to $TMPDIR/sections-off-golden-actual/<name>.json for diffing.
//
// Other pinned-hash guards found by search (P3.0 inventory), none of them about
// sections-off behaviour: src/__tests__/org-loadouts-default-off.test.ts (the four
// SHAs), __tests__/orgrt/context-surface.test.ts (fingerprint equalities for an
// org that adopts nothing), __tests__/orgrt/org-signature-blueprint.test.ts,
// src/__tests__/org-sign-review-json.test.ts and src/__tests__/org-sign-expect-hash.test.ts
// (signature digests of fixed definitions).
//
// Left out of the scripted run on purpose: bus events with reason `org-memory-*`.
// Whether run memory is stored depends on the machine (the known environmental
// daemon.test.ts failure), so those events are not a property of the org.
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHECKPOINT_VERSION } from '../../src/orgrt/checkpoint.js';
import { contextSurface } from '../../src/orgrt/context-surface.js';
import { LeadWatch, leadWatchConfig, MAX_NOTICES } from '../../src/orgrt/lead-watch.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import {
  CONTROL_FILES,
  DECISION_FILES,
  GIT_GUARD_DIR,
  ORG_STATE_FILES,
  ORG_WORK_DIRS,
  RUN_STATE_FILES,
} from '../../src/orgrt/org-authority-files.js';
import { computeOrgDefHash } from '../../src/orgrt/org-signature.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildRolePrompt, runAgentSession } from '../../src/orgrt/session.js';
import { MAX_TASK_BRIEF } from '../../src/orgrt/task-dag.js';
import { checklistFindings } from '../../src/orgrt/validate-checklist.js';
import { OrgDefSchema, type OrgDef, type OrgRole } from '../../src/orgrt/types.js';
import { expectGolden } from './support/golden-capture.js';
import {
  allCallbacks,
  captureVariantInDaemon,
  listServerTools,
  parseVariant,
  renderTools,
  type RoleCapture,
  sessionOpts,
  sha,
  summariseTools,
  VARIANTS,
} from './support/golden-variants.js';
import { normalizeString } from './support/normalize-golden.js';
import { runScripted, type ScriptedRun } from './support/golden-run.js';

const TMP = process.env.TMPDIR ?? '/var/tmp';
const MINIMAL_RAW = { name: 'tiny', roles: [{ id: 'a' }] };

describe('sections-off golden: tool lists and prompts', () => {
  const daemonVariants = VARIANTS.filter((v) => v.daemon !== false);
  const captured: Record<string, { captures: Record<string, RoleCapture>; root: string }> = {};
  beforeAll(async () => {
    for (const v of daemonVariants) captured[v.name] = await captureVariantInDaemon(v, TMP);
  }, 180_000);

  it('sections-off golden: tool list sha per definition variant and role', async () => {
    const session: Record<string, unknown> = {};
    for (const v of VARIANTS) {
      const def = parseVariant(v);
      for (const role of def.roles.filter((r) => r.kind !== 'endpoint'))
        session[`${v.name}/${role.id}`] = await renderTools(sessionOpts(def, role, { ...allCallbacks(), ...v.opts }));
    }
    const plain = parseVariant(VARIANTS[0]);
    for (const role of plain.roles) session[`no-callbacks/${role.id}`] = await renderTools(sessionOpts(plain, role));
    expectGolden('tool-lists-session', session);

    const daemon: Record<string, unknown> = {};
    for (const v of daemonVariants)
      for (const [role, c] of Object.entries(captured[v.name].captures)) daemon[`${v.name}/${role}`] = c.tools;
    expectGolden('tool-lists-daemon', daemon);
  }, 120_000);

  it('sections-off golden: provider tools follow the org tools, in order', async () => {
    const def = parseVariant(VARIANTS.find((v) => v.name === 'tool-providers')!);
    const out: Record<string, unknown> = {};
    for (const role of def.roles) {
      const bus = new OrgBus('acme', 'r', mkdtempSync(join(TMP, 'golden-provider-')));
      const mailbox = new Mailbox();
      mailbox.push('go');
      mailbox.close();
      let listed: unknown;
      const queryFn = ({ prompt, options }: any) =>
        (async function* () {
          listed = summariseTools(await listServerTools(options.mcpServers.org));
          for await (const _ of prompt) break;
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        })();
      await runAgentSession({
        org: 'acme',
        role,
        bus,
        policy: new PolicyEngine(role.id, {}, bus, '/work'),
        mailbox,
        cwd: '/work',
        def,
        deliver: async () => 'ok',
        queryFn: queryFn as any,
        buildProviderTools: async () => ({
          tools: [
            { name: 'fake_provider__echo', description: 'echo a line', schema: { text: z.string() }, handler: async () => ({ text: 'x' }) },
            { name: 'fake_provider__ping', description: 'ping', schema: {}, handler: async () => ({ text: 'pong' }) },
          ],
          close() {},
        }),
      } as any);
      out[role.id] = listed;
    }
    const names = (r: unknown) => (r as { names: string[] }).names;
    expect(names(out.boss).slice(-2)).toEqual(['fake_provider__echo', 'fake_provider__ping']);
    expectGolden('tool-lists-provider', out);
  });

  it('sections-off golden: system prompt sha per variant', async () => {
    const prompts: Record<string, Record<string, { sha: string; length: number }>> = {};
    for (const v of daemonVariants) {
      const { captures, root } = captured[v.name];
      prompts[v.name] = Object.fromEntries(
        Object.entries(captures).map(([role, c]) => {
          const text = normalizeString(c.systemPrompt, { roots: [root] });
          return [role, { sha: sha(text), length: text.length }];
        }),
      );
    }
    const { captures, root } = captured.plain;
    const plainText = Object.fromEntries(
      Object.entries(captures).map(([role, c]) => [role, normalizeString(c.systemPrompt, { roots: [root] })]),
    );
    const def = parseVariant(VARIANTS[0]);
    const [boss, dev] = def.roles as OrgRole[];
    const roster = ['boss', 'dev'];
    const direct = {
      coordinator: sha(buildRolePrompt(boss, def, roster, ['Widget', 'Gizmo'], undefined, ['- "hook" (endpoint)'])),
      worker: sha(buildRolePrompt(dev, def, roster, undefined, 'GUIDE')),
      bare: sha(buildRolePrompt(dev, def, roster)),
    };
    expectGolden('system-prompts', { prompts, plainText, direct });
  });
});

describe('sections-off golden: configuration', () => {
  const raws = [...VARIANTS.map((v) => [v.name, v.raw] as const), ['minimal', MINIMAL_RAW] as const];

  it('sections-off golden: OrgDefSchema defaults deep-equal', () => {
    expectGolden('defs-parsed', Object.fromEntries(raws.map(([n, raw]) => [n, OrgDefSchema.parse(raw)])));
  });

  it('sections-off golden: checklistFindings per fixture', () => {
    const findings: Record<string, unknown> = {};
    for (const [n, raw] of raws) findings[n] = checklistFindings(OrgDefSchema.parse(raw));
    const withKeys = (top: Record<string, unknown>, runConfig: Record<string, unknown> = {}) =>
      checklistFindings(OrgDefSchema.parse({ ...(VARIANTS[0].raw as object), ...top, run_config: { idle_minutes: 0, ...runConfig } }));
    const deferred: Record<string, unknown> = {
      sections: withKeys({ sections: { s1: {} } }),
      documents: withKeys({ documents: { d1: {} } }),
      loops: withKeys({ loops: [] }),
      requires: withKeys({ requires: { sections: 1 } }),
      'run_config.budget_usd': withKeys({}, { budget_usd: 5 }),
      'run_config.budget_mode': withKeys({}, { budget_mode: 'soft' }),
      'run_config.experimental': withKeys({}, { experimental: 'eval' }),
    };
    for (const [k, f] of Object.entries(deferred)) {
      const errors = (f as { errors: string[] }).errors;
      expect(errors.some((e) => e.includes('is not yet supported')), k).toBe(true);
    }
    expectGolden('checklist-findings', { variants: findings, deferred });
  });

  it('sections-off golden: signature digest of an unchanged definition', () => {
    expectGolden('signature-digests', Object.fromEntries(raws.map(([n, raw]) => [n, computeOrgDefHash(raw)])));
  });

  it('sections-off golden: constants, authority-file lists and defaults', () => {
    const plain = OrgDefSchema.parse(VARIANTS[0].raw) as OrgDef;
    expect(CHECKPOINT_VERSION).toBe(2);
    expectGolden('constants', {
      CHECKPOINT_VERSION,
      ORG_WORK_DIRS,
      DECISION_FILES,
      ORG_STATE_FILES,
      CONTROL_FILES,
      RUN_STATE_FILES,
      GIT_GUARD_DIR,
      MAX_TASK_BRIEF,
      leadWatchDefault: leadWatchConfig({}),
      leadWatchOff: leadWatchConfig({ lead_watch: false }),
      MAX_NOTICES,
      contextSurfaceOff: contextSurface(plain),
    });
  });
});

describe('sections-off golden: a scripted run', () => {
  let run: ScriptedRun;
  beforeAll(async () => {
    run = await runScripted(TMP);
  }, 120_000);

  it('sections-off golden: scripted run files and bus', () => {
    expect(run.currentCheckpointVersion).toBe(2);
    expect(run.checkpointVersion).toBe(2);
    expect(run.files.some((f) => f.includes('docs'))).toBe(false);
    expectGolden('run-bus', run.bus);
    // the role directories the bubblewrap mask creates up front are absent on a host without bubblewrap
    const maskDirs = /^alpha\/(\.mail|reports|runs|scratch|work|workspace)\/$/;
    expectGolden(
      'run-files',
      {
        files: run.files,
        runtimeKeys: run.runtimeKeys,
        checkpointKeys: run.checkpointKeys,
        checkpointVersion: run.checkpointVersion,
        sessionsKeys: run.sessionsKeys,
      },
      (v) => ({ ...v, files: v.files.filter((f: string) => !maskDirs.test(f)) }),
    );
  });

  it('sections-off golden: mailbox texts and receipts', () => {
    const mb = new Mailbox();
    for (let i = 0; i < 505; i++) mb.push(`m${i}`);
    const state = mb.serialize();
    expect([state.queue.length, state.queue[0], state.queue[499]]).toEqual([500, 'm5', 'm504']);

    // lead-watch notices, from the pure watch at fixed instants
    const task = [{ id: 'task-9', title: 'answer m9', since: 0 }];
    const base = { id: 'worker', lead: 'lead', started: false, lastActivity: 0, waiting: false, openTasks: task };
    const notStarted = new LeadWatch({ notStartedMs: 90_000, silentMs: 180_000 }).tick([base], 91_000).map((n) => n.text);
    const silentWatch = new LeadWatch({ notStartedMs: 90_000, silentMs: 180_000 });
    const silent = [182_000, 182_000 + 2 * 180_000 + 1_000, 182_000 + 2 * 180_000 + 1_000 + 4 * 180_000 + 1_000].flatMap(
      (t) => silentWatch.tick([{ ...base, started: true, lastActivity: 1_000 }], t).map((n) => n.text),
    );
    expectGolden('mailbox-texts', {
      received: run.received,
      receipts: run.receipts,
      eviction: { kept: state.queue.length, first: state.queue[0], last: state.queue[499] },
      leadWatchNotices: { notStarted, silent },
    });
  });
});

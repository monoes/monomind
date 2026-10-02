// The growth-like scenario kit (manifest growth-like.json): the Phase 0 growth org copy, built from
// the immutable Phase 0 snapshot (tests/eval/org/trials/prepare.mjs snapshot), with the same recording
// stubs for every outbound action. Both contenders run every role on the runner it has in the growth
// definition (two designers on codex and antigravity); only its Claude roles are pinned to Haiku.
//
// The snapshot is taken from production state once and lives outside the repository; point
// SMOKE_GROWTH_SNAPSHOT at it (default /var/tmp/mm-phase0/snapshot).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const id = 'growth-like';
const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = join(HERE, '../../../trials/stub-monoagent-mcp.mjs');
const snapshotDir = () => process.env.SMOKE_GROWTH_SNAPSHOT ?? '/var/tmp/mm-phase0/snapshot';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** Per-role USD soft stops for the nine Claude roles; the two designers run on unpriced runners and
 *  are capped by tokens, so their USD entry is 0. On the production profile prepare.mjs scales these by
 *  the model price ratio (PRICE_SCALE), so a cap keeps the same token room.
 *
 *  Declared change, 2026-10-02 (round 2, owner decision 2): the caps are doubled. In the pilot's one
 *  usable pair both arms ran roles out of their caps (5 and 7 closures) with total spend well under the
 *  sum of caps, so the per-role caps bound, not the total. A single org-wide stop of $12 per run
 *  (ORG_STOP_USD; the sum of caps may exceed it) keeps the worst case bounded, and the planning
 *  allocation is $12. Previous caps (round 1, kept on record): growth-lead 1.80, researcher 1.20,
 *  content-writer 1.20, site-seo 1.10, brand-reviewer 1.00, and 0.40 for each of analyst,
 *  community-manager, social-publisher, outreach-manager (sum $7.90). The Phase 0 caps before that:
 *  growth-lead 0.44, brand-reviewer 0.36, community-manager 0.65, social-publisher 0.60, researcher 0.40,
 *  site-seo 0.40, content-writer 0.40, analyst 0.30, outreach-manager 0.25. */
export const CAPS = {
  'growth-lead': 3.6,
  researcher: 2.4,
  'content-writer': 2.4,
  'site-seo': 2.2,
  'brand-reviewer': 2.0,
  analyst: 0.8,
  'community-manager': 0.8,
  'social-publisher': 0.8,
  'outreach-manager': 0.8,
  'visual-designer-codex': 0,
  'visual-designer-agy': 0,
};

export const ALLOCATION_USD = 12;
export const ORG_STOP_USD = 12;

/** The session cap counts cache reads (every model call re-reads the role's context), and the dry runs
 *  measured 100-370K counted tokens in one turn of a Haiku or codex role. Phase 0's growth roles carry
 *  19K-token prefixes and run longer turns, so 1M is about 3-6 such turns before a session rotates. */
export const SESSION_CAP = { tokens: 1_000_000 };

const TASK_BODY =
  'Produce, in this run, one public-facing content draft (a blog post or X thread), one research ' +
  'deliverable that supports the growth plan, and one listing or outreach packet ready to use. Save them ' +
  'in the workspace as deliverables/content/, deliverables/research/ and deliverables/listing/. Every claim ' +
  'about the product must be verifiable in the repository archive or marked unverified, and a deliverable ' +
  'must be new work, not a copy of a file already in the workspace. Outbound actions are recorded, not ' +
  'published; nothing may be published without review.';

/** Declared change, 2026-10-02 (round 2, owner decision 1): in every arm with several roles the lead
 *  coordinates and does not write deliverables itself. In the pilot the lead did the whole job in one arm
 *  of 2 of 3 pairs, which confounded them. The sentence about new work answers the round-1 review finding
 *  that deliverables were copies of existing workspace files. */
export const TASK = `${TASK_BODY} The lead coordinates and does not write deliverables itself: each deliverable is produced by the role that owns it and handed over to the lead.`;

/** The single-agent arm (the null hypothesis, spec R18): one role does the whole task alone. */
export const SOLO_TASK = `${TASK_BODY} You are the only agent in this run: do all of it yourself.`;

export async function buildInputs({ dir }) {
  const snap = snapshotDir();
  if (!existsSync(join(snap, 'manifest.json')))
    throw new Error(`no Phase 0 snapshot at ${snap} (set SMOKE_GROWTH_SNAPSHOT)`);
  mkdirSync(dir, { recursive: true });
  for (const f of ['org.json', 'tools.json', 'replay.json', 'manifest.json'])
    cpSync(join(snap, f), join(dir, f));
  for (const d of ['workspace', 'org-memory', 'repo'])
    cpSync(join(snap, d), join(dir, d), { recursive: true });
}

/** Replace every occurrence of `from` in every string of a JSON value. */
function rewrite(v, from, to) {
  if (typeof v === 'string') return v.split(from).join(to);
  if (Array.isArray(v)) return v.map((x) => rewrite(x, from, to));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x, from, to)]));
  return v;
}

export async function baseDef({ inputs, workspace, root, contender }) {
  const manifest = readJson(join(inputs, 'manifest.json'));
  const tools = readJson(join(inputs, 'tools.json'));
  const replay = readJson(join(inputs, 'replay.json'));
  // This trial's own org memory, seeded from the immutable snapshot.
  const memory = join(root, '.monomind/org-memory');
  cpSync(join(inputs, 'org-memory'), memory, { recursive: true });
  const stubDir = join(root, 'stubs');
  mkdirSync(stubDir, { recursive: true });
  const calls = join(root, 'stub-calls.jsonl');
  writeFileSync(calls, '');

  let def = readJson(join(inputs, 'org.json'));
  def = rewrite(def, manifest.workspace, workspace);
  def = rewrite(def, manifest.repo, join(inputs, 'repo'));
  def.run_config.memory_namespace = `org:${root.split('/').pop()}`;
  for (const role of def.roles) {
    for (const tp of role.tool_providers ?? []) {
      if (tp.name !== 'monoagent')
        throw new Error(`role ${role.id}: unexpected tool provider ${tp.name}`);
      const captured = tools[role.id];
      if (!captured) throw new Error(`role ${role.id}: no captured tool list`);
      const autos = role.automations ?? [];
      const config = {
        initialize: captured.initialize,
        tools: captured.tools,
        outbound: autos
          .filter((x) => x.tier === 'irreversible' && x.wait === false)
          .map((x) => `automation_${x.alias}`),
        async: autos.filter((x) => x.wait === false).map((x) => `automation_${x.alias}`),
        replay,
      };
      const cfgPath = join(stubDir, `${role.id}.json`);
      writeJson(cfgPath, config);
      tp.command = process.execPath;
      tp.args = [STUB, cfgPath, calls];
      delete tp.env;
    }
  }
  return {
    def,
    task: contender === 'single' ? SOLO_TASK : TASK,
    caps: CAPS,
    allocationUsd: ALLOCATION_USD,
    orgStopUsd: ORG_STOP_USD,
    sessionCap: SESSION_CAP,
    deadlineSeconds: 5400,
    // The production profile is never a trial's to write, and must be byte-identical afterwards.
    denyWrite: [manifest.source],
    extraGuard: [manifest.workspace, join(manifest.source, '.monomind/org-memory')],
  };
}

const DIRS = {
  'content-piece': 'deliverables/content',
  'research-deliverable': 'deliverables/research',
  'listing-packet': 'deliverables/listing',
};

/** Machine evidence only: a unit with files is handed to the blinded review (accepted: null), one without
 *  is not accepted. Recorded outbound calls are listed so the reviewer can check nothing was published. */
export async function check({ root, workspace }) {
  const { readdirSync } = await import('node:fs');
  const list = (rel) =>
    existsSync(join(workspace, rel))
      ? readdirSync(join(workspace, rel), { recursive: true }).map(String)
      : [];
  const callsFile = join(root, 'stub-calls.jsonl');
  const outbound = existsSync(callsFile)
    ? readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).length
    : 0;
  return Object.entries(DIRS).map(([unit, rel]) => {
    const files = list(rel);
    return {
      unit,
      accepted: files.length ? null : false,
      evidence: {
        dir: rel,
        files,
        needsReview: files.length > 0,
        recordedOutboundCalls: outbound,
        reason: files.length ? undefined : `nothing saved under ${rel}`,
      },
    };
  });
}

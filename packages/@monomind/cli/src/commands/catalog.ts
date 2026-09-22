/**
 * `monomind catalog <verb>` — the policy-governed skill catalog in
 * `.monomind/catalog/` (see doc/concepts/catalog.md). Verbs are dispatched
 * through `VERBS`; read-only verbs never create files.
 */
import {
  activate,
  approve,
  disable,
  type LifecycleOptions,
  type LifecycleResult,
  quarantine,
  release,
  revoke,
} from '../catalog/lifecycle.js';
import { buildSnapshot, type CatalogAsset, catalogAudit, eligible } from '../catalog/snapshot.js';
import { stage } from '../catalog/stage.js';
import { loadCatalogState } from '../catalog/state.js';
import { CatalogKindSchema, type CatalogTarget, CatalogTargetSchema } from '../catalog/types.js';
import { rankSkillMeta } from '../orgrt/skill-library.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult, ParsedFlags } from '../types.js';

export interface VerbContext {
  root: string;
  /** Positional arguments after the verb. */
  rest: string[];
  flags: ParsedFlags;
  json: boolean;
}
type Verb = (v: VerbContext) => CommandResult | Promise<CommandResult>;

const log = (text: string): void => {
  console.log(text);
};

export function print(payload: Record<string, unknown>, success = true): CommandResult {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return { success, data: payload, ...(success ? {} : { exitCode: 1 }) };
}

/** The CLI prints `message` for a failed result, so nothing is printed here. */
export function fail(message: string): CommandResult {
  return { success: false, exitCode: 1, message };
}

/** `--target` validated: `target: null` when absent, `error` when unknown. */
function targetFlag(flags: ParsedFlags): { target: CatalogTarget | null; error?: string } {
  const all = strings(flags, 'target');
  if (all.length === 0) return { target: null };
  if (all.length > 1) return { target: null, error: 'give at most one --target here' };
  const raw = all[0];
  const parsed = CatalogTargetSchema.safeParse(raw);
  return parsed.success
    ? { target: parsed.data }
    : {
        target: null,
        error: `unknown target "${String(raw)}" — use ${CatalogTargetSchema.options.join(', ')}`,
      };
}

/** Every value of a flag that may repeat (declared `array`), as strings. */
function strings(flags: ParsedFlags, key: string): string[] {
  const v = flags[key];
  if (v === undefined || v === false) return [];
  return (Array.isArray(v) ? v : [v]).map(String).filter(Boolean);
}

const str = (flags: ParsedFlags, key: string): string | undefined =>
  typeof flags[key] === 'string' && flags[key] !== '' ? (flags[key] as string) : undefined;

const line = (a: CatalogAsset): string =>
  `${output.highlight(a.id)} ${a.status}${a.eligible ? '' : ' (unverified)'} ` +
  `[${a.targets.join(', ') || 'no targets'}] — ${a.description.slice(0, 120)}`;

function selectAssets(root: string, target: CatalogTarget | null): CatalogAsset[] {
  const snap = buildSnapshot(root);
  return target ? eligible(snap, target) : snap.assets;
}

const list: Verb = ({ root, flags, json }) => {
  const { target, error } = targetFlag(flags);
  if (error) return fail(error);
  const assets = selectAssets(root, target);
  if (json) return print({ assets, diagnostics: buildSnapshot(root).diagnostics });
  for (const a of assets) log(line(a));
  for (const d of buildSnapshot(root).diagnostics) log(output.warning(`${d.id}: ${d.reason}`));
  log(output.info(`${assets.length} catalog entries`));
  return { success: true, data: assets };
};

const show: Verb = ({ root, rest, json }) => {
  const id = rest[0];
  const asset = buildSnapshot(root).assets.find((a) => a.id === id);
  const entry = loadCatalogState(root).entries.find((e) => e.id === id);
  if (!asset || !entry) return fail(`unknown catalog entry: ${id ?? '(none given)'}`);
  if (json) return print({ asset, entry });
  log(line(asset));
  log(`sha256: ${entry.sha256}  source: ${entry.source.kind} ${entry.source.path}`);
  log(
    `inspection: ${entry.inspection.verdict}  requested tools: ${asset.requestedTools.join(', ') || 'none'}`,
  );
  log(
    `granted tools: ${entry.grantedTools.join(', ') || 'none'}  replaces legacy: ${entry.replacesLegacy}`,
  );
  for (const h of entry.history)
    log(`  ${h.at} ${h.from ?? '—'} → ${h.to} by ${h.actor}${h.reason ? ` (${h.reason})` : ''}`);
  return { success: true, data: { asset, entry } };
};

const search: Verb = ({ root, rest, flags, json }) => {
  const query = rest.join(' ');
  if (!query) return fail('usage: monomind catalog search <text> [--target <t>]');
  const { target, error } = targetFlag(flags);
  if (error) return fail(error);
  const pool = selectAssets(root, target).filter((a) => a.status !== 'revoked');
  const limit = Number(flags.limit) || 10;
  const assets = rankSkillMeta(query, pool, { limit });
  if (json) return print({ assets });
  for (const a of assets) log(line(a));
  if (assets.length === 0) log(output.info('no matching catalog entries'));
  return { success: true, data: assets };
};

const audit: Verb = ({ root, json }) => {
  const report = catalogAudit(root);
  if (json) return print({ ...report }, report.ok);
  if (!report.configured) {
    log(output.info('catalog not configured (no .monomind/catalog/state.json)'));
    return { success: true, data: report };
  }
  if (report.error) log(output.error(report.error));
  for (const e of report.entries)
    log(
      `${e.problems.length ? output.warning(e.id) : e.id} ${e.status}${e.problems.length ? ` — ${e.problems.join('; ')}` : ''}`,
    );
  for (const c of report.legacyCollisions)
    log(
      output.info(
        `collision: ${c.name} (${c.legacyOrigin}) vs ${c.catalogId}${c.replacesLegacy ? ' — catalog wins' : ' — legacy wins'}`,
      ),
    );
  for (const s of report.stale)
    log(output.info(`stale: ${s.id} ${s.status} for ${s.ageDays} days`));
  log(
    report.ok
      ? output.success(`${report.active} active, ok`)
      : output.error(`${report.active} active, problems found`),
  );
  return { success: report.ok, data: report, ...(report.ok ? {} : { exitCode: 1 }) };
};

/** Who reads a target's content once an entry is active for it. */
const EXPOSURE: Record<CatalogTarget, string> = {
  org: 'Org skill library — roles that name it, org skills search, per-task suggestions',
  jev: 'the configured decision model may receive its name and ≤200-char description',
  'platform:claude':
    '.claude/skills, read by Claude Code; also enters .claude/helpers/skill-registry.json ' +
    '(per-prompt keyword router; Jev only with the jev target)',
  'platform:agents':
    '.agents/skills, read by Codex, Gemini, Kimi, OpenCode, Cursor, Copilot, VS Code, ' +
    'OpenClaw, Droid, Hermes, Antigravity, Zed',
};

function actorOf(flags: ParsedFlags): string | undefined {
  return str(flags, 'actor');
}

function report(r: LifecycleResult, json: boolean, extra: string[] = []): CommandResult {
  const payload = {
    id: r.id,
    before: r.before,
    after: r.after,
    sha256: r.entry.sha256,
    targets: r.entry.targets,
    grantedTools: r.entry.grantedTools,
  };
  if (json) return print(payload);
  log(`${output.highlight(r.id)} ${r.before} → ${r.after}`);
  log(`sha256: ${r.entry.sha256}`);
  log(
    `targets: ${r.entry.targets.join(', ') || 'none'}  grants: ${r.entry.grantedTools.join(', ') || 'none'}`,
  );
  for (const e of extra) log(e);
  return { success: true, data: payload };
}

const stageVerb: Verb = async ({ root, rest, flags, json }) => {
  const src = rest[0];
  const actor = actorOf(flags);
  if (!src || !actor)
    return fail(
      'usage: monomind catalog stage <owner/repo|git-url|path> --actor <name> [--only <name>] [--kind skill|archetype|blueprint]',
    );
  const kind = flags.kind === undefined ? undefined : CatalogKindSchema.safeParse(flags.kind);
  if (kind && !kind.success) return fail('--kind must be skill, archetype or blueprint');
  const r = await stage(root, src, { actor, only: str(flags, 'only'), kind: kind?.data });
  const before = r.entry.history.length > 1 ? r.entry.history.at(-1)?.from : null;
  const payload = {
    id: r.entry.id,
    before: r.unchanged ? r.entry.status : (before ?? null),
    after: r.entry.status,
    sha256: r.entry.sha256,
    unchanged: r.unchanged,
    dir: r.dir,
    inspection: r.entry.inspection,
  };
  if (json) return print(payload);
  log(
    `${output.highlight(r.entry.id)} ${payload.before ?? '—'} → ${r.entry.status}${r.unchanged ? ' (unchanged)' : ''}`,
  );
  log(`sha256: ${r.entry.sha256}  → ${r.dir}`);
  for (const x of r.entry.inspection.rejected)
    log(output.warning(`rejected ${x.path}: ${x.reason}`));
  log(
    `requested tools: ${r.entry.inspection.requestedTools.join(', ') || 'none'} (granted only at approve)`,
  );
  log(`scanner: ${r.entry.inspection.scanner.summary}`);
  return { success: true, data: payload };
};

const inspect: Verb = ({ root, rest, json }) => {
  const e = loadCatalogState(root).entries.find((x) => x.id === rest[0]);
  if (!e) return fail(`unknown catalog entry: ${rest[0] ?? '(none given)'}`);
  const payload = { id: e.id, status: e.status, sha256: e.sha256, inspection: e.inspection };
  if (json) return print(payload);
  const i = e.inspection;
  log(`${output.highlight(e.id)} ${e.status} — verdict ${i.verdict} (${i.at})`);
  log(`accepted: ${i.accepted.join(', ') || 'none'}`);
  for (const x of i.rejected) log(output.warning(`rejected ${x.path}: ${x.reason}`));
  log(`requested tools: ${i.requestedTools.join(', ') || 'none'}`);
  log(
    `scanner: ${i.scanner.ok ? 'ran' : 'did not run'}${i.scanner.blocked ? ', blocked' : ''} — ${i.scanner.summary}`,
  );
  if (i.override)
    log(output.info(`released by ${i.override.actor} at ${i.override.at}: ${i.override.reason}`));
  return { success: true, data: payload };
};

const approveVerb: Verb = ({ root, rest, flags, json }) => {
  const id = rest[0];
  const actor = actorOf(flags);
  if (!id || !actor)
    return fail(
      'usage: monomind catalog approve <id> --target <t> [--target <t>] [--grant-tool <tool>]... [--replaces-legacy] --actor <name>',
    );
  const r = approve(root, id, {
    actor,
    targets: strings(flags, 'target'),
    grant: strings(flags, 'grantTool'),
    replacesLegacy: flags.replacesLegacy === true,
  });
  const extra = r.entry.targets.map((t) => `  ${t} → ${EXPOSURE[t]}`);
  extra.unshift('exposure once active:');
  if (r.entry.targets.some((t) => t.startsWith('platform:')))
    extra.push('  other readers of a projected tree see it as ordinary platform content');
  const o = r.entry.inspection.override;
  if (o) extra.push(output.warning(`quarantine verdict overridden by ${o.actor}: ${o.reason}`));
  if (r.entry.replacesLegacy) extra.push('replaces a same-name legacy skill in the Org library');
  return report(r, json, extra);
};

type Move = (root: string, id: string, opts: LifecycleOptions) => LifecycleResult;

function lifecycleVerb(name: string, fn: Move, needsReason: boolean): Verb {
  return ({ root, rest, flags, json }) => {
    const id = rest[0];
    const actor = actorOf(flags);
    const reason = str(flags, 'reason');
    if (!id || !actor || (needsReason && !reason))
      return fail(
        `usage: monomind catalog ${name} <id> --actor <name> ${needsReason ? '--reason <text>' : '[--reason <text>]'}`,
      );
    return report(fn(root, id, { actor, reason }), json);
  };
}

const VERBS: Record<string, Verb> = {
  list,
  show,
  search,
  audit,
  stage: stageVerb,
  inspect,
  approve: approveVerb,
  activate: lifecycleVerb('activate', activate, false),
  disable: lifecycleVerb('disable', disable, false),
  quarantine: lifecycleVerb('quarantine', quarantine, true),
  release: lifecycleVerb('release', release, true),
  revoke: lifecycleVerb('revoke', revoke, true),
};

export async function catalogAction(ctx: CommandContext): Promise<CommandResult> {
  const [verb = 'list', ...rest] = ctx.args;
  const fn = Object.hasOwn(VERBS, verb) ? VERBS[verb] : undefined;
  if (!fn) return fail(`unknown verb "${verb}" — use ${Object.keys(VERBS).join(', ')}`);
  try {
    return await fn({
      root: ctx.cwd || process.cwd(),
      rest,
      flags: ctx.flags,
      json: ctx.flags.format === 'json',
    });
  } catch (e) {
    return fail((e as Error).message);
  }
}

export const catalogCommand: Command = {
  name: 'catalog',
  description:
    'Policy-governed skill catalog: stage, inspect, approve, activate, disable, quarantine, release, revoke, list, show, search, audit',
  options: [
    {
      name: 'target',
      description: 'org, jev, platform:claude or platform:agents (repeat for approve)',
      type: 'array',
    },
    { name: 'limit', description: 'Maximum search results', type: 'number' },
    {
      name: 'actor',
      description: 'Who is acting (self-asserted, recorded in history)',
      type: 'string',
    },
    {
      name: 'reason',
      description: 'Why (quarantine, release and revoke require it)',
      type: 'string',
    },
    {
      name: 'only',
      description: 'stage: the candidate name when a source has several',
      type: 'string',
    },
    { name: 'kind', description: 'stage: skill, archetype or blueprint', type: 'string' },
    {
      name: 'grant-tool',
      description: 'approve: grant one requested, grantable tool (repeatable)',
      type: 'array',
    },
    {
      name: 'replaces-legacy',
      description: 'approve: win over a same-name legacy skill',
      type: 'boolean',
    },
  ],
  examples: [
    { command: 'monomind catalog list --target org', description: 'Entries the org library sees' },
    { command: 'monomind catalog audit --format json', description: 'Verify every entry' },
    {
      command: 'monomind catalog stage ./skills-repo --only code-review --actor alice',
      description: 'Stage one skill through the quarantine gate',
    },
    {
      command: 'monomind catalog approve skill:code-review --target org --actor alice',
      description: 'Approve it for the Org library',
    },
  ],
  action: catalogAction,
};

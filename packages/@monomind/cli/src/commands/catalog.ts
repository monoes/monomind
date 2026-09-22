/**
 * `monomind catalog <verb>` — the policy-governed skill catalog in
 * `.monomind/catalog/` (see doc/concepts/catalog.md). Verbs are dispatched
 * through `VERBS`; read-only verbs never create files.
 */
import { buildSnapshot, type CatalogAsset, catalogAudit, eligible } from '../catalog/snapshot.js';
import { loadCatalogState } from '../catalog/state.js';
import { type CatalogTarget, CatalogTargetSchema } from '../catalog/types.js';
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
  const raw = flags.target;
  if (raw === undefined) return { target: null };
  const parsed = CatalogTargetSchema.safeParse(raw);
  return parsed.success
    ? { target: parsed.data }
    : {
        target: null,
        error: `unknown target "${String(raw)}" — use ${CatalogTargetSchema.options.join(', ')}`,
      };
}

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

const VERBS: Record<string, Verb> = { list, show, search, audit };

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
  description: 'Policy-governed skill catalog: list, show, search and audit catalog entries',
  options: [
    { name: 'target', description: 'org, jev, platform:claude or platform:agents', type: 'string' },
    { name: 'limit', description: 'Maximum search results', type: 'number' },
  ],
  examples: [
    { command: 'monomind catalog list --target org', description: 'Entries the org library sees' },
    { command: 'monomind catalog audit --format json', description: 'Verify every entry' },
  ],
  action: catalogAction,
};

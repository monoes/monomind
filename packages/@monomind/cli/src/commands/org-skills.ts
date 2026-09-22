/**
 * `monomind org skills <list|search|show|import>` — browse the org skill
 * library and bring skills in from other repositories (MIT/Apache-2.0 only).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rankOrgSkills } from '../decision/picks.js';
import { importRepo } from '../orgrt/skill-import.js';
import { getSkill, listSkills, searchSkills } from '../orgrt/skill-library.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';

const log = (text: string): void => {
  console.log(text);
};

const csv = (v: unknown): string[] | undefined =>
  typeof v === 'string' && v.trim()
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

/** How many keyword hits the decision model re-ranks. */
const JEV_SKILL_SHORTLIST = 30;

const line = (s: { name: string; tags: string[]; description: string }): string =>
  `${output.highlight(s.name)} ${s.tags.length ? `[${s.tags.join(', ')}] ` : ''}— ${s.description.slice(0, 140)}`;

export async function orgSkillsAction(ctx: CommandContext): Promise<CommandResult> {
  const [verb, ...rest] = ctx.args;
  const root = ctx.cwd || process.cwd();
  const tag = typeof ctx.flags.tag === 'string' ? ctx.flags.tag : undefined;
  const json = ctx.flags.format === 'json';

  if (verb === 'list' || verb === undefined) {
    const skills = listSkills(root).filter((s) => !tag || s.tags.includes(tag));
    if (json) return print({ skills });
    for (const s of skills) log(line(s));
    log(output.info(`${skills.length} skills`));
    return { success: true, data: skills };
  }

  if (verb === 'search') {
    const query = rest.join(' ');
    if (!query) return fail('usage: monomind org skills search <text> [--tag <tag>]');
    const limit =
      typeof ctx.flags.limit === 'number' ? ctx.flags.limit : Number(ctx.flags.limit) || 10;
    const found = searchSkills(query, root, { tag, limit: Math.max(limit, JEV_SKILL_SHORTLIST) });
    const { method, hits } = await rankOrgSkills(query, found, limit, {
      root,
      onError: (err) =>
        process.stderr.write(
          `[org skills] decision model "${err.provider}" unavailable (${err.message})\n`,
        ),
    });
    // Keyword results keep the legacy `{skills}` JSON shape byte-for-byte.
    if (json) return print(method === 'jev' ? { skills: hits, method } : { skills: hits });
    for (const s of hits) {
      log(
        line(s) +
          (s.probability !== undefined ? output.info(` (jev ${s.probability.toFixed(2)})`) : ''),
      );
    }
    if (hits.length === 0) log(output.info('no matching skills'));
    return { success: true, data: hits };
  }

  if (verb === 'show') {
    const s = rest[0] ? getSkill(rest[0], root) : null;
    if (!s) return fail(`unknown skill: ${rest[0] ?? '(none given)'}`);
    if (json) return print({ skill: s });
    log(line(s));
    log(
      `license: ${s.license ?? '?'}  source: ${s.source ?? '?'}${s.source_commit ? `@${s.source_commit.slice(0, 12)}` : ''}  (${s.origin})`,
    );
    if (s.tools.length) log(`tools: ${s.tools.join(', ')}`);
    if (s.files.length) log(`references: ${s.files.join(', ')}`);
    log(`\n${s.body}`);
    return { success: true, data: s };
  }

  if (verb === 'import') {
    const src = rest[0];
    if (!src)
      return fail(
        'usage: monomind org skills import <owner/repo | git-url | path> [--global] [--only a,b] [--tags x,y]',
      );
    const dest =
      typeof ctx.flags.into === 'string'
        ? ctx.flags.into
        : ctx.flags.global === true
          ? join(process.env.MONOMIND_HOME ?? join(homedir(), '.monomind'), 'org-skills')
          : join(root, '.monomind', 'org-skills');
    const results = importRepo(src, dest, {
      only: csv(ctx.flags.only),
      tags: csv(ctx.flags.tags),
      overwrite: ctx.flags.overwrite === true,
    });
    const ok = results.filter((r) => r.ok);
    if (json) return print({ dest, results });
    for (const r of results) {
      log(
        r.ok
          ? output.success(`+ ${r.name} (${r.license})`)
          : output.warning(`- ${r.name}: ${r.reason}`),
      );
    }
    log(output.info(`${ok.length} imported, ${results.length - ok.length} skipped → ${dest}`));
    return { success: true, data: results };
  }

  return fail(`unknown verb "${verb}" — use list, search, show or import`);
}

function print(payload: Record<string, unknown>): CommandResult {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return { success: true, data: payload };
}

function fail(message: string): CommandResult {
  log(output.error(message));
  return { success: false, message };
}

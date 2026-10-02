import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
// @ts-expect-error plain .mjs modules
import { CONTENDERS, MODEL } from '../../lib.mjs';
// @ts-expect-error plain .mjs modules
import { buildInputs, prepareTrial } from '../../prepare.mjs';
// @ts-expect-error plain .mjs modules
import * as kit from './kit.mjs';

let inputs: string;
const snap = (...p: string[]) => join(inputs, 'workspace', 'snapshot', ...p);

/** A real line of the snapshot: the first one in `file` matching `re`. */
function real(file: string, re: RegExp) {
  const lines = readFileSync(snap(file), 'utf8').split('\n');
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) throw new Error(`${file} has no line matching ${re}`);
  return { path: file, line: i + 1, quote: lines[i].trim(), claim: `claim about ${file}` };
}

const rows = () => [
  real('session-types.ts', /session_scope/),
  real('idle-watchdog.ts', /export (async )?function/),
  real('budget-closure.ts', /export (async )?function/),
  real('session-cap.ts', /export (async )?function/),
];

const cite = (r: { path: string; line: number }) => `${r.path}:${r.line}`;
const report = (rs: ReturnType<typeof rows>, names = kit.SUB_QUESTIONS as string[]) =>
  `# Report\n\n${names.map((n, i) => `## ${n}\n\nIt works this way (${rs[i] ? cite(rs[i]) : 'none'}).\n`).join('\n')}`;

function workspace(reportMd: string | undefined, ledger: unknown) {
  const ws = mkdtempSync(join(tmpdir(), 'rr-ws-'));
  if (reportMd !== undefined) writeFileSync(join(ws, 'report.md'), reportMd);
  if (ledger !== undefined)
    writeFileSync(
      join(ws, 'ledger.json'),
      typeof ledger === 'string' ? ledger : JSON.stringify(ledger),
    );
  return ws;
}

const run = async (ws: string) => {
  const [rep, led] = await kit.check({ root: ws, workspace: ws, inputs, trial: {} });
  return { rep, led };
};

beforeAll(async () => {
  inputs = mkdtempSync(join(tmpdir(), 'rr-in-'));
  inputs = join(inputs, 'x');
  mkdirSync(inputs);
  await kit.buildInputs({ dir: inputs });
});

describe('buildInputs', () => {
  it('snapshots only non-test orgrt sources at HEAD and records the commit', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(JSON.parse(readFileSync(join(inputs, 'meta.json'), 'utf8')).commit).toBe(head);
    const files = execFileSync('ls', [snap()], { encoding: 'utf8' }).trim().split('\n');
    expect(files).toContain('session-cap.ts');
    expect(files.every((f) => f.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(f))).toBe(true);
    const q = readFileSync(join(inputs, 'workspace/QUESTION.md'), 'utf8');
    expect(q).toContain(kit.QUESTION);
    for (const s of kit.SUB_QUESTIONS) expect(q).toContain(s);
    expect(q).toMatch(/ledger\.json/);
  });
});

describe('prepare, for both contenders', () => {
  it.each(CONTENDERS)(
    '%s yields a definition the runtime accepts, within 8 USD',
    async (contender) => {
      const base = mkdtempSync(join(tmpdir(), 'rr-base-'));
      await buildInputs({ scenario: 'research-report', base });
      const root = await prepareTrial({ scenario: 'research-report', base, contender, trial: '1' });
      const org = JSON.parse(
        readFileSync(
          join(root, `.monomind/orgs/smoke-research-report-${contender}-1.json`),
          'utf8',
        ),
      );
      const parsed = OrgDefSchema.parse(org);
      expect(checklistFindings(parsed).errors).toEqual([]);
      expect(org.roles.every((r: any) => r.adapter_config.model === MODEL)).toBe(true);
      expect(org.roles.reduce((a: number, r: any) => a + r.budget_usd, 0)).toBeLessThanOrEqual(8);
      const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
      expect(trial).toMatchObject({ allocationUsd: 8, deadlineSeconds: 2700 });
      expect(trial.task).toMatch(/report\.md/);
      expect(trial.task).toMatch(/ledger\.json/);
      if (contender === 'phase2')
        expect(org.run_config.context.session_cap).toEqual({ tokens: 60_000 });
    },
  );
});

describe('check', () => {
  it('accepts a good report and ledger built from real lines', async () => {
    const rs = rows();
    const { rep, led } = await run(workspace(report(rs), rs));
    expect(rep).toMatchObject({ unit: 'report', accepted: true, critical: [] });
    expect(rep.evidence.failures).toEqual([]);
    expect(rep.evidence.needsReview).toBe(true);
    expect(led).toMatchObject({ unit: 'source-ledger', accepted: true, critical: [] });
    expect(led.evidence).toMatchObject({ rows: 4, reportCitations: 4 });
  });

  it('tolerates surrounding whitespace in a quote, and a quote that is part of the line', async () => {
    const rs = rows();
    rs[0].quote = `  ${rs[0].quote.slice(0, 12)}  `;
    const { led } = await run(workspace(report(rs), rs));
    expect(led.accepted).toBe(true);
  });

  it('rejects a wrong line: the quote is not there (critical)', async () => {
    const rs = rows();
    const bad = rows();
    bad[1].line += 1;
    const { rep, led } = await run(workspace(report(bad), rs)); // report cites a shifted line
    expect(led.accepted).toBe(false); // equal counts, but the report cites a line the ledger lacks
    expect(led.evidence.failures.join()).toContain('report cites what the ledger lacks');
    const wrongLedger = await run(workspace(report(rs), bad));
    expect(wrongLedger.led.accepted).toBe(false);
    expect(wrongLedger.led.critical.join()).toContain('quote not at cited line');
    expect(wrongLedger.led.evidence.failures.join()).toContain('quote is not on');
    expect(rep.accepted).toBe(true); // the report's own citation still resolves
  });

  it('rejects a fabricated quote', async () => {
    const rs = rows();
    rs[2].quote = 'this text was never in the source';
    const { led } = await run(workspace(report(rows()), rs));
    expect(led.accepted).toBe(false);
    expect(led.critical).toEqual([expect.stringContaining('quote not at cited line')]);
  });

  it('rejects a citation to a missing file or a line out of range (critical, in report and ledger)', async () => {
    const rs = rows();
    const ghost = [...rs.slice(0, 3), { ...rs[3], path: 'no-such-file.ts' }];
    const far = [...rs.slice(0, 3), { ...rs[3], line: 999999 }];
    for (const bad of [ghost, far]) {
      const { rep, led } = await run(workspace(report(bad), bad));
      expect(rep.accepted).toBe(false);
      expect(rep.critical.join()).toContain('unresolvable citation in report');
      expect(led.accepted).toBe(false);
      expect(led.critical.join()).toContain('unresolvable citation in ledger');
    }
  });

  it('rejects a path that escapes the snapshot', async () => {
    const rs = rows();
    const bad = [...rs.slice(0, 3), { ...rs[3], path: '../QUESTION.md', line: 1 }];
    const { led } = await run(workspace(report(rs), bad));
    expect(led.accepted).toBe(false);
    expect(led.critical.join()).toContain('unresolvable citation in ledger');
  });

  it('rejects a report missing a sub-question section, naming it', async () => {
    const rs = rows();
    const names = kit.SUB_QUESTIONS.filter((n: string) => n !== 'idle exit');
    const { rep } = await run(workspace(report(rs, names), rs));
    expect(rep.accepted).toBe(false);
    expect(rep.evidence.failures).toContain('no section for sub-question "idle exit"');
  });

  it('rejects one heading answering two sub-questions', async () => {
    const rs = rows();
    const names = ['task-scope boundary and idle exit', 'budget stops', 'session cap'];
    const { rep } = await run(workspace(report(rs, names), rs));
    expect(rep.accepted).toBe(false);
    expect(rep.evidence.failures.join()).toContain('answers two sub-questions');
  });

  it('rejects a section that cites nothing', async () => {
    const rs = rows();
    const md = report(rs).replace(cite(rs[2]), 'somewhere');
    const { rep } = await run(
      workspace(
        md,
        rs.filter((_, i) => i !== 2),
      ),
    );
    expect(rep.accepted).toBe(false);
    expect(rep.evidence.failures).toContain('section for "budget stops" cites nothing');
  });

  it('rejects a ledger whose row count differs from the report citation count (padded or short)', async () => {
    const rs = rows();
    const padded = [...rs, real('session.ts', /export/)];
    const short = rs.slice(0, 3);
    for (const l of [padded, short]) {
      const { led } = await run(workspace(report(rs), l));
      expect(led.accepted).toBe(false);
      expect(led.evidence.failures.join()).toMatch(/ledger has \d rows but the report has 4/);
    }
  });

  it('rejects a repeated ledger row used to reach the count', async () => {
    const rs = rows();
    const md = report(rs).replace('# Report', `# Report\n\nSee ${cite(rs[0])} and ${cite(rs[0])}.`);
    const { led } = await run(workspace(md, [...rs.slice(0, 3), rs[0]]));
    expect(led.accepted).toBe(false);
    expect(led.evidence.failures.join()).toContain('repeats');
  });

  it('counts a citation repeated in the report once', async () => {
    const rs = rows();
    const md = `${report(rs)}\nAgain ${cite(rs[0])}.\n`;
    const { rep, led } = await run(workspace(md, rs));
    expect(rep.evidence.citations).toBe(4);
    expect(led.accepted).toBe(true);
  });

  it('rejects missing or malformed outputs without throwing', async () => {
    const none = await run(workspace(undefined, undefined));
    expect(none.rep.evidence.failures).toContain('report.md is missing');
    expect(none.led.evidence.failures).toContain('ledger.json is missing');
    expect(none.rep.accepted || none.led.accepted).toBe(false);
    const rs = rows();
    expect((await run(workspace(report(rs), '{not json'))).led.accepted).toBe(false);
    expect((await run(workspace(report(rs), { a: 1 }))).led.accepted).toBe(false);
    expect((await run(workspace(report(rs), [{ path: 'x.ts' }]))).led.accepted).toBe(false);
  });

  it('resolves against the immutable inputs, so an edited workspace snapshot cannot help', async () => {
    const rs = rows();
    const ws = workspace(report(rs), rs);
    mkdirSync(join(ws, 'snapshot'));
    writeFileSync(join(ws, 'snapshot', rs[0].path), 'forged\n');
    expect((await run(ws)).led.accepted).toBe(true);
  });
});

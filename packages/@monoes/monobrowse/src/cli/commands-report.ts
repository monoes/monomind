/**
 * `report` — one command that opens a page, runs the checks (console errors,
 * failed requests, Web Vitals against budgets, accessibility), writes an HTML
 * report and returns a pass/fail verdict.
 */

import { output } from './output.js';
import { ensureConnected, getBrowser, print, session } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const reportCommand: Command = {
  name: 'report',
  description:
    'Test a page and write one self-contained HTML report + sibling JSON. Usage: monomind browse report <url>',
  options: [
    { name: 'out', short: 'o', type: 'string', description: 'Output .html path, or a directory' },
    {
      name: 'budget',
      short: 'b',
      type: 'string',
      description: 'Budget JSON file path, or inline JSON',
    },
    {
      name: 'devices',
      short: 'd',
      type: 'string',
      description: 'Comma-separated device names for the screenshot matrix',
    },
    {
      name: 'wait',
      short: 'w',
      type: 'string',
      description: 'Extra settle step: a CSS selector to wait for, or milliseconds',
    },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    {
      name: 'full-page',
      type: 'boolean',
      description: 'Full-page screenshot (--no-full-page for viewport only)',
      default: true,
    },
    {
      name: 'vitals-wait',
      type: 'number',
      description: 'Milliseconds to let the web-vitals observers run',
      default: 2500,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Milliseconds to wait for the page to go network-idle',
      default: 20000,
    },
    {
      name: 'keep-open',
      type: 'boolean',
      description: 'Leave the browser running after the report',
      default: false,
    },
    {
      name: 'repeat',
      type: 'number',
      description: 'Run the URL N times and report per-check flake rates (RIG-14)',
    },
    {
      name: 'record',
      type: 'boolean',
      description: 'Record frames for the evidence timeline even when the run passes',
      default: false,
    },
    {
      name: 'history',
      type: 'boolean',
      description: 'Print the stored run history for this URL instead of running it',
      default: false,
    },
    {
      name: 'save',
      type: 'boolean',
      description: 'Save this run to the history store (--no-save to skip)',
      default: true,
    },
    {
      name: 'history-max',
      type: 'number',
      description: 'Runs kept per URL before the oldest are pruned (default 20)',
    },
    {
      name: 'trend-window',
      type: 'number',
      description: 'Prior runs charted in the trend section (default 10)',
    },
  ],
  examples: [
    { command: 'monomind browse report https://example.com', description: 'Report with defaults' },
    {
      command: 'monomind browse report https://example.com --repeat 5',
      description: 'Run five times and report flake rates',
    },
    {
      command: 'monomind browse report https://example.com --history',
      description: 'Show the stored run history for a URL',
    },
    {
      command: 'monomind browse report https://example.com --record',
      description: 'Attach a frame-by-frame evidence timeline',
    },
    {
      command: 'monomind browse report https://example.com --out ./reports/home.html',
      description: 'Choose the output path',
    },
    {
      command: 'monomind browse report https://example.com --budget \'{"lcp":4000}\'',
      description: 'Relax a budget inline',
    },
    {
      command: 'monomind browse report https://example.com --devices "iPhone 14,iPad"',
      description: 'Add a device screenshot matrix',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const url = ctx.args[0] as string;
    if (!url) throw new Error('URL required. Usage: monomind browse report <url>');

    // Imported lazily for the same reason getBrowser() is: this module loads
    // on every CLI invocation, and nothing but `report` needs the renderer.
    const { runReport, runReportRepeated, readHistory } = await import('../report/index.js');

    // --history is a read of the store, so it deliberately never launches a
    // browser — `report --history` must work offline and on a dead site.
    if (ctx.flags.history) {
      const { dir, runs } = await readHistory(url);
      if (ctx.flags.json) {
        print(JSON.stringify({ data: { dir, runs } }, null, 2));
      } else if (!runs.length) {
        output.printWarning(`No stored runs for ${url}`);
        print(`Looked in: ${dir}`);
      } else {
        print(`${runs.length} run(s) for ${url}`);
        print(`Stored in: ${dir}`);
        for (const run of runs) {
          const lcp = run.vitals.lcp === undefined ? '—' : `${Math.round(run.vitals.lcp)}ms`;
          print(
            `  ${run.capturedAt}  ${run.verdict.toUpperCase().padEnd(4)}  ` +
              `LCP ${lcp.padStart(7)}  ${run.counts.consoleErrors} console errors  ` +
              `${run.counts.failedRequests} failed requests  ${run.counts.a11yErrors} a11y errors`,
          );
        }
      }
      return { success: true, data: { dir, runs } };
    }

    const repeatRaw = ctx.flags.repeat as number | undefined;
    const repeat =
      typeof repeatRaw === 'number' && Number.isFinite(repeatRaw) && repeatRaw > 1
        ? Math.floor(repeatRaw)
        : undefined;

    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const rawDevices = ctx.flags.devices;
    const devices =
      typeof rawDevices === 'string'
        ? rawDevices
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
        : undefined;

    const runOptions = {
      url,
      out: ctx.flags.out as string | undefined,
      budget: ctx.flags.budget as string | undefined,
      devices,
      wait: ctx.flags.wait as string | undefined,
      vitalsWaitMs: ctx.flags['vitals-wait'] as number | undefined,
      loadTimeoutMs: ctx.flags.timeout as number | undefined,
      fullPage: ctx.flags['full-page'] !== false,
      cwd: ctx.cwd,
      // A failing run records its own evidence without being asked; --record
      // is for when you want the timeline from a run that passes.
      record: ctx.flags.record === true,
      history: ctx.flags.save !== false,
      historyMax: ctx.flags['history-max'] as number | undefined,
      trendWindow: ctx.flags['trend-window'] as number | undefined,
    };

    let result:
      | Awaited<ReturnType<typeof runReport>>
      | Awaited<ReturnType<typeof runReportRepeated>>;
    try {
      result = repeat
        ? await runReportRepeated(client, sessionId, { ...runOptions, repeat })
        : await runReport(client, sessionId, runOptions);
    } finally {
      // A report is a one-shot command — CI should not be left with an
      // orphan Chrome. Only close a browser THIS process launched: an
      // attached one belongs to the user's own `open`/`connect` session.
      if (!ctx.flags['keep-open'] && browser.getLaunchedPid(session.port) !== undefined) {
        browser.stopRequestCapture(sessionId);
        browser.teardownConsoleCapture(sessionId);
        try {
          await browser.closeBrowser(client, session.port);
        } catch {
          /* best-effort */
        }
        session.client = null;
        session.sessionId = '';
        session.targetId = '';
        session.refs = new Map();
        await browser.clearActivePort();
        await browser.clearRefCache();
      }
    }

    const { report, htmlPath, jsonPath, summary, historyDir } = result;
    const { flake } = result;
    // With --repeat the flake verdict governs: a check that failed 2 of 5
    // runs must not exit 0 just because the last run happened to be green.
    const passed = flake ? flake.verdict === 'pass' : report.verdict === 'pass';

    if (ctx.flags.json) {
      const { toJsonReport } = await import('../report/index.js');
      print(
        JSON.stringify(
          { data: { ...toJsonReport(report), flake, htmlPath, jsonPath, historyDir } },
          null,
          2,
        ),
      );
    } else {
      if (passed) output.printSuccess(summary);
      else output.printError(summary);
      if (flake) {
        print(`    ${flake.confidenceNote}`);
        for (const check of flake.checks.filter((c) => !c.stable)) {
          print(`    ${check.label}: failed ${check.failed} of ${check.runs} runs`);
        }
        for (const signal of flake.signals.slice(0, 5)) {
          print(
            `    ${signal.kind} "${signal.signature}" in ${signal.runs} of ${signal.total} runs`,
          );
        }
      }
      for (const failure of report.failures) {
        print(`    ${failure.budget}: expected ${failure.expected}, got ${failure.actual}`);
        if (failure.detail) print(`      ${failure.detail}`);
      }
      for (const headline of report.trend?.headlines ?? []) output.printWarning(headline);
      if (report.diff?.structure) {
        const d = report.diff.structure;
        print(
          `    vs previous run: ${d.gained.length} gained, ${d.lost.length} lost, ${d.renamed.length} renamed`,
        );
      }
      if (report.diff?.pixels?.comparable) {
        print(
          `    vs previous run: ${report.diff.pixels.changedPercent.toFixed(2)}% of pixels changed`,
        );
      }
      for (const note of report.notes) output.printWarning(note);
      print(`Report: ${htmlPath}`);
      print(`JSON:   ${jsonPath}`);
      if (historyDir) print(`History: ${historyDir}`);
    }

    // Non-zero exit is the point of RIG-06 — CI and agents gate on it.
    return {
      success: passed,
      exitCode: passed ? 0 : 1,
      data: { htmlPath, jsonPath, report, flake },
    };
  },
};

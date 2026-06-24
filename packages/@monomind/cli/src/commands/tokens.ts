/**
 * Monomind Tokens Command
 * Token usage tracking and visualization — powered by token-tracker.cjs
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

function getTrackerPath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // From dist/src/commands/ -> back to project root -> .claude/helpers/
  return join(__dirname, '..', '..', '..', '..', '..', '..', '.claude', 'helpers', 'token-tracker.cjs');
}

function loadTracker() {
  const require = createRequire(import.meta.url);
  return require(getTrackerPath());
}

const VALID_PERIODS = new Set(['today', 'week', '30days', 'month']);
function validatePeriod(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : 'today';
  return VALID_PERIODS.has(s) ? s : 'today';
}

const dashboardSubcommand: Command = {
  name: 'dashboard',
  description: 'Launch interactive token usage dashboard',
  options: [
    { name: 'period', short: 'p', type: 'string', description: 'Time period: today|week|30days|month', default: 'today' },
    { name: 'no-interactive', type: 'boolean', description: 'Render once and exit', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const period = validatePeriod(ctx.flags['period']);
    const noInteractive = ctx.flags['no-interactive'] as boolean;
    try {
      const tracker = loadTracker();
      if (noInteractive) {
        tracker.renderDashboard(period);
      } else {
        tracker.runInteractive();
      }
      return { success: true };
    } catch (err) {
      output.error('Token tracker not available: ' + (err instanceof Error ? err.message : String(err)));
      return { success: false, message: 'Token tracker unavailable' };
    }
  },
};

const summarySubcommand: Command = {
  name: 'summary',
  description: 'Show token usage summary for a period',
  options: [
    { name: 'period', short: 'p', type: 'string', description: 'Time period: today|week|30days|month', default: 'today' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const period = validatePeriod(ctx.flags['period']);
    const asJson = ctx.flags['json'] as boolean;
    try {
      const tracker = loadTracker();
      const range = tracker.getDateRange(period);
      const projects = tracker.parseAllSessions(range.start, range.end);

      if (asJson) {
        output.writeln(JSON.stringify(projects, null, 2));
        return { success: true, data: projects };
      }

      const totalCost = projects.reduce((s: number, p: { totalCost: number }) => s + p.totalCost, 0);
      const totalCalls = projects.reduce((s: number, p: { totalApiCalls: number }) => s + p.totalApiCalls, 0);

      output.writeln('');
      output.writeln(`Token Usage — ${period}`);
      output.writeln('─'.repeat(50));
      output.writeln(`Total Cost:  ${tracker.fmt$(totalCost)}`);
      output.writeln(`API Calls:   ${totalCalls}`);
      output.writeln(`Projects:    ${projects.length}`);
      output.writeln('');

      for (const p of projects.slice(0, 10) as Array<{ projectPath: string; totalCost: number; totalApiCalls: number }>) {
        const name = p.projectPath.split('/').pop() || p.projectPath;
        output.writeln(`  ${name.padEnd(30)} ${tracker.fmt$(p.totalCost).padStart(10)}  ${p.totalApiCalls} calls`);
      }
      output.writeln('');

      return { success: true, data: { totalCost, totalCalls, projects } };
    } catch (err) {
      output.error('Token tracker not available: ' + (err instanceof Error ? err.message : String(err)));
      return { success: false, message: 'Token tracker unavailable' };
    }
  },
};

const todaySubcommand: Command = {
  name: 'today',
  description: 'Quick today/month token usage summary',
  options: [],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    try {
      const tracker = loadTracker();
      const summary = tracker.quickSummary();
      output.writeln(summary || 'No token data available for today.');
      return { success: true };
    } catch (err) {
      output.error('Token tracker not available: ' + (err instanceof Error ? err.message : String(err)));
      return { success: false };
    }
  },
};

const leanDeltaSubcommand: Command = {
  name: 'lean-delta',
  description: 'Compare token cost: sessions with monolean active vs without',
  options: [],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    try {
      const { join: pathJoin, dirname: pathDirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const { readdirSync, readFileSync } = await import('fs');

      // Locate capture directory
      const __dirname = pathDirname(fileURLToPath(import.meta.url));
      const projectRoot = pathJoin(__dirname, '..', '..', '..', '..', '..', '..');
      const captureDir = pathJoin(projectRoot, '.monomind', 'capture');

      // Load all run capture logs
      let snapshots: Array<{ leanMode?: string; cost_usd?: number; tokens_in?: number; tokens_out?: number }> = [];
      try {
        const orgsDir = pathJoin(projectRoot, '.monomind', 'orgs');
        const orgEntries = readdirSync(orgsDir, { withFileTypes: true });
        for (const org of orgEntries) {
          if (!org.isDirectory()) continue;
          const runsDir = pathJoin(orgsDir, org.name, 'runs');
          try {
            const runFiles = readdirSync(runsDir).filter(f => f.endsWith('-captures.jsonl'));
            for (const rf of runFiles) {
              const lines = readFileSync(pathJoin(runsDir, rf), 'utf8').split('\n').filter(Boolean);
              for (const line of lines) {
                try { snapshots.push(JSON.parse(line)); } catch { /* skip */ }
              }
            }
          } catch { /* no runs dir */ }
        }
      } catch { /* no orgs dir */ }

      // Also check snap files in capture dir for leanMode field
      try {
        const snapFiles = readdirSync(captureDir).filter(f => f.startsWith('snap-') && f.endsWith('.json'));
        for (const sf of snapFiles) {
          try { snapshots.push(JSON.parse(readFileSync(pathJoin(captureDir, sf), 'utf8'))); } catch { /* skip */ }
        }
      } catch { /* no capture dir */ }

      const lean = snapshots.filter(s => s.leanMode && s.leanMode !== 'off' && s.cost_usd != null);
      const normal = snapshots.filter(s => (!s.leanMode || s.leanMode === 'off') && s.cost_usd != null);

      if (lean.length < 3 || normal.length < 3) {
        output.writeln('Not enough data yet. Need 3+ sessions in each group.');
        output.writeln(`Current: ${lean.length} lean sessions, ${normal.length} normal sessions.`);
        return { success: true };
      }

      const avg = (arr: typeof snapshots) => arr.reduce((s, x) => s + (x.cost_usd || 0), 0) / arr.length;
      const leanAvg = avg(lean);
      const normalAvg = avg(normal);
      const delta = ((leanAvg - normalAvg) / normalAvg * 100).toFixed(1);
      const sign = leanAvg <= normalAvg ? '' : '+';

      output.writeln('');
      output.writeln('Monolean Token Delta');
      output.writeln('─'.repeat(50));
      output.writeln(`Sessions with monolean: ${lean.length.toString().padStart(4)}   avg cost: $${leanAvg.toFixed(4)}`);
      output.writeln(`Sessions without:       ${normal.length.toString().padStart(4)}   avg cost: $${normalAvg.toFixed(4)}`);
      output.writeln(`delta: ${sign}${delta}%`);
      output.writeln('');

      return { success: true, data: { leanSessions: lean.length, normalSessions: normal.length, leanAvg, normalAvg, deltaPct: parseFloat(delta) } };
    } catch (err) {
      output.error('lean-delta error: ' + (err instanceof Error ? err.message : String(err)));
      return { success: false };
    }
  },
};

export const tokensCommand: Command = {
  name: 'tokens',
  description: 'Token usage tracking and cost visualization',
  subcommands: [dashboardSubcommand, summarySubcommand, todaySubcommand, leanDeltaSubcommand],
};

export default tokensCommand;

#!/usr/bin/env node
/**
 * metrics-db.mjs — Lightweight metrics aggregation helper.
 * Reads .monomind/metrics/*.json files and produces summary output.
 *
 * Commands:
 *   sync    — aggregate metrics files → JSON summary (default)
 *   status  — print current metrics status as JSON
 *   export  — export metrics to timestamped file
 *   (other) — print usage hint, exit 0
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const METRICS_DIR = path.join(CWD, '.monomind', 'metrics');

function safeRead(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function aggregate() {
  const recentEdits = safeRead(path.join(METRICS_DIR, 'recent-edits.json'));
  const toolCalls = safeRead(path.join(METRICS_DIR, 'tool-calls.json'));
  const hookLatency = safeRead(path.join(METRICS_DIR, 'hook-latency.json'));
  const tokenSummary = safeRead(path.join(METRICS_DIR, 'token-summary.json'));

  return {
    aggregatedAt: new Date().toISOString(),
    recentEdits: recentEdits ? (recentEdits.edits || []).length : 0,
    toolCalls: toolCalls ? Object.keys(toolCalls.calls || {}).length : 0,
    hookLatency: hookLatency ? Object.keys(hookLatency).filter(k => k !== 'lastUpdated').length : 0,
    tokenSummary: tokenSummary ? { todayCost: tokenSummary.todayCost, monthCost: tokenSummary.monthCost } : null,
  };
}

function cmdSync() {
  const summary = aggregate();
  process.stdout.write(JSON.stringify(summary) + '\n');
  process.exit(0);
}

function cmdStatus() {
  const summary = aggregate();
  process.stdout.write(JSON.stringify({ status: 'ok', metrics: summary }) + '\n');
  process.exit(0);
}

function cmdExport() {
  const summary = aggregate();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const exportPath = path.join(METRICS_DIR, `export-${ts}.json`);
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.writeFileSync(exportPath, JSON.stringify(summary, null, 2));
    process.stdout.write(`Exported metrics to ${exportPath}\n`);
  } catch (e) {
    process.stdout.write(`Exported metrics (in-memory only): ${JSON.stringify(summary)}\n`);
  }
  process.exit(0);
}

function cmdUsage(unknownCmd) {
  process.stdout.write(
    `Usage: metrics-db.mjs [sync|status|export]\n` +
    (unknownCmd ? `  Unknown command: ${unknownCmd}\n` : '')
  );
  process.exit(0);
}

// ── main ──────────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'sync';

switch (cmd) {
  case 'sync':    cmdSync();   break;
  case 'status':  cmdStatus(); break;
  case 'export':  cmdExport(); break;
  default:        cmdUsage(cmd); break;
}

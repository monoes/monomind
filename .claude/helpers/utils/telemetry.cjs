'use strict';
// Extracted from hook-handler.cjs — session-scoped telemetry helpers.
// All functions are stateless and read/write .monomind/metrics/*.json files.

const path = require('path');
const fs = require('fs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function _recordRecentEdit(filePath) {
  if (!filePath) return;
  try {
    var relPath = path.isAbsolute(filePath) ? path.relative(CWD, filePath) : filePath;
    var f = path.join(CWD, '.monomind', 'metrics', 'recent-edits.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    var d = { edits: [] };
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (_) {}
    if (!Array.isArray(d.edits)) d.edits = [];
    d.edits = d.edits.filter(function(e) { return e.file !== relPath; });
    d.edits.unshift({ file: relPath, editedAt: Date.now() });
    if (d.edits.length > 10) d.edits = d.edits.slice(0, 10);
    fs.writeFileSync(f, JSON.stringify(d));
  } catch (e) { /* non-fatal */ }
}

function _getRecentEdits() {
  try {
    var f = path.join(CWD, '.monomind', 'metrics', 'recent-edits.json');
    if (!fs.existsSync(f)) return [];
    var d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (!Array.isArray(d.edits)) return [];
    var cutoff = Date.now() - 2 * 60 * 60 * 1000;
    return d.edits.filter(function(e) { return e.editedAt > cutoff; });
  } catch (e) { return []; }
}

function _recordToolCall(signature) {
  try {
    var f = path.join(CWD, '.monomind', 'metrics', 'tool-calls.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (_) {}
    if (typeof d !== 'object' || d === null) d = {};
    if (!d.startedAt || (Date.now() - d.startedAt) > 4 * 60 * 60 * 1000) {
      d = { startedAt: Date.now(), calls: {} };
    }
    d.calls[signature] = (d.calls[signature] || 0) + 1;
    fs.writeFileSync(f, JSON.stringify(d));
    return d.calls[signature];
  } catch (e) { return 0; }
}

function _getBudgetStatus() {
  try {
    var budgetFile = path.join(CWD, '.monomind', 'budget.json');
    var summaryFile = path.join(CWD, '.monomind', 'metrics', 'token-summary.json');
    if (!fs.existsSync(summaryFile)) return null;
    var summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    var todayCost = summary.todayCost || (summary.today && summary.today.cost) || 0;
    var monthCost = summary.monthCost || (summary.month && summary.month.cost) || 0;

    var dailyLimit, monthlyLimit, autoTuned = false;
    if (fs.existsSync(budgetFile)) {
      try {
        var b = JSON.parse(fs.readFileSync(budgetFile, 'utf-8'));
        dailyLimit = b.dailyLimit;
        monthlyLimit = b.monthlyLimit;
      } catch (_) {}
    }

    if (!dailyLimit || !monthlyLimit) {
      var now = new Date();
      var daysIntoMonth = now.getUTCDate();
      var dailyAvg = daysIntoMonth >= 1 ? monthCost / daysIntoMonth : 0;
      if (dailyAvg > 5 && daysIntoMonth >= 7) {
        dailyLimit  = Math.max(dailyLimit  || 0, Math.ceil(dailyAvg * 1.5));
        monthlyLimit = Math.max(monthlyLimit || 0, Math.ceil(dailyAvg * 1.5 * 30));
        autoTuned = true;
        try {
          fs.mkdirSync(path.dirname(budgetFile), { recursive: true });
          fs.writeFileSync(budgetFile, JSON.stringify({
            dailyLimit: dailyLimit, monthlyLimit: monthlyLimit,
            autoTuned: true, tunedAt: now.toISOString(),
            basis: 'rolling avg $' + dailyAvg.toFixed(2) + '/day × 1.5',
            note: 'Edit these values to set a hard ceiling. Delete the file to re-tune.',
          }, null, 2));
        } catch (_) {}
      } else {
        dailyLimit = dailyLimit || 50;
        monthlyLimit = monthlyLimit || 1500;
      }
    }

    var dailyPct = Math.round((todayCost / dailyLimit) * 100);
    var monthlyPct = Math.round((monthCost / monthlyLimit) * 100);
    var rollingDaily = (new Date()).getUTCDate() >= 1 ? monthCost / (new Date()).getUTCDate() : 0;
    var spike = rollingDaily > 0 && todayCost > rollingDaily * 2.0 && todayCost > 5;

    return {
      todayCost, monthCost, dailyLimit, monthlyLimit,
      dailyPct, monthlyPct, autoTuned, spike,
      alert: dailyPct >= 80 || monthlyPct >= 80 || spike,
      breached: dailyPct >= 100 || monthlyPct >= 100,
    };
  } catch (e) { return null; }
}

function _recordHookLatency(handlerName, durationMs) {
  try {
    var f = path.join(CWD, '.monomind', 'metrics', 'hook-latency.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (_) {}
    if (typeof d !== 'object' || d === null) d = {};
    var entry = d[handlerName] || { count: 0, total: 0, max: 0 };
    entry.count++;
    entry.total += durationMs;
    entry.max = Math.max(entry.max, durationMs);
    entry.mean = Math.round(entry.total / entry.count);
    d[handlerName] = entry;
    d.lastUpdated = Date.now();
    fs.writeFileSync(f, JSON.stringify(d));
  } catch (e) {}
}

function _recordDecisionMarkers(promptText) {
  if (!promptText || typeof promptText !== 'string') return;
  var markers = /\b(let's go with|we (?:chose|decided|picked|will go with)|decision[:\s]|choosing|going with|prefer to|let's use)\b[^\.\n]{0,200}/gi;
  var matches = promptText.match(markers);
  if (!matches || matches.length === 0) return;
  try {
    var f = path.join(CWD, '.monomind', 'decisions.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    var entry = JSON.stringify({ ts: Date.now(), excerpts: matches.slice(0, 3), prompt: promptText.slice(0, 400) });
    fs.appendFileSync(f, entry + '\n');
  } catch (e) {}
}

module.exports = {
  _recordRecentEdit,
  _getRecentEdits,
  _recordToolCall,
  _getBudgetStatus,
  _recordHookLatency,
  _recordDecisionMarkers,
};

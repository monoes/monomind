#!/usr/bin/env node
'use strict';
/**
 * Token Tracker — Monobrain port of codeburn
 * Parses ~/.claude/projects/**\/*.jsonl to aggregate token usage and costs.
 * Pure Node.js built-ins only (fs, os, path).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Pricing (mirrored from codeburn models.ts) ────────────────────────────────
const WEB_SEARCH_COST = 0.01;

const FALLBACK_PRICING = {
  'claude-opus-4-6':  { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6,  fast: 6 },
  'claude-opus-4-5':  { in: 5e-6, out: 25e-6, cw: 6.25e-6, cr: 0.5e-6,  fast: 1 },
  'claude-opus-4-1':  { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6, fast: 1 },
  'claude-opus-4':    { in: 15e-6, out: 75e-6, cw: 18.75e-6, cr: 1.5e-6, fast: 1 },
  'claude-sonnet-4-6':{ in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6,  fast: 1 },
  'claude-sonnet-4-5':{ in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6,  fast: 1 },
  'claude-sonnet-4':  { in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6,  fast: 1 },
  'claude-3-7-sonnet':{ in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6,  fast: 1 },
  'claude-3-5-sonnet':{ in: 3e-6, out: 15e-6, cw: 3.75e-6, cr: 0.3e-6,  fast: 1 },
  'claude-haiku-4-5': { in: 1e-6, out: 5e-6,  cw: 1.25e-6, cr: 0.1e-6,  fast: 1 },
  'claude-3-5-haiku': { in: 0.8e-6, out: 4e-6, cw: 1e-6,   cr: 0.08e-6, fast: 1 },
  'gpt-4o':           { in: 2.5e-6, out: 10e-6, cw: 2.5e-6, cr: 1.25e-6, fast: 1 },
  'gpt-4o-mini':      { in: 0.15e-6, out: 0.6e-6, cw: 0.15e-6, cr: 0.075e-6, fast: 1 },
  'gemini-2.5-pro':   { in: 1.25e-6, out: 10e-6, cw: 1.25e-6, cr: 0.315e-6, fast: 1 },
  'gpt-5':            { in: 2.5e-6, out: 10e-6, cw: 2.5e-6, cr: 1.25e-6, fast: 1 },
};

const SHORT_MODEL_NAMES = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5': 'Opus 4.5',
  'claude-opus-4-1': 'Opus 4.1',
  'claude-opus-4':   'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4':   'Sonnet 4',
  'claude-3-7-sonnet': 'Sonnet 3.7',
  'claude-3-5-sonnet': 'Sonnet 3.5',
  'claude-haiku-4-5':  'Haiku 4.5',
  'claude-3-5-haiku':  'Haiku 3.5',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4o':      'GPT-4o',
  'gpt-5':       'GPT-5',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
};

function getCanonical(model) {
  return model.replace(/@.*$/, '').replace(/-\d{8}$/, '');
}

function getModelCosts(model) {
  var canonical = getCanonical(model);
  // Exact match
  if (FALLBACK_PRICING[canonical]) return FALLBACK_PRICING[canonical];
  // Prefix match
  for (var key in FALLBACK_PRICING) {
    if (canonical.startsWith(key)) return FALLBACK_PRICING[key];
  }
  // Suffix match (model contains key)
  for (var key in FALLBACK_PRICING) {
    if (canonical.indexOf(key) !== -1) return FALLBACK_PRICING[key];
  }
  return null;
}

function getShortModelName(model) {
  var canonical = getCanonical(model);
  for (var key in SHORT_MODEL_NAMES) {
    if (canonical === key || canonical.startsWith(key)) return SHORT_MODEL_NAMES[key];
  }
  return canonical;
}

function calculateCost(model, inputTokens, outputTokens, cacheWrite, cacheRead, webSearch, speed) {
  var costs = getModelCosts(model);
  if (!costs) return 0;
  var multiplier = (speed === 'fast') ? costs.fast : 1;
  return multiplier * (
    inputTokens * costs.in +
    outputTokens * costs.out +
    cacheWrite * costs.cw +
    cacheRead * costs.cr +
    (webSearch || 0) * WEB_SEARCH_COST
  );
}

// ── Classifier (ported from codeburn classifier.ts) ──────────────────────────
var TEST_RE   = /\b(test|pytest|vitest|jest|mocha|spec|coverage|npm\s+test|npx\s+vitest|npx\s+jest)\b/i;
var GIT_RE    = /\bgit\s+(push|pull|commit|merge|rebase|checkout|branch|stash|log|diff|status|add|reset|cherry-pick|tag)\b/i;
var BUILD_RE  = /\b(npm\s+run\s+build|npm\s+publish|pip\s+install|docker|deploy|make\s+build|npm\s+run\s+dev|npm\s+start|pm2|systemctl|brew|cargo\s+build)\b/i;
var INSTALL_RE = /\b(npm\s+install|pip\s+install|brew\s+install|apt\s+install|cargo\s+add)\b/i;

var DEBUG_RE   = /\b(fix|bug|error|broken|failing|crash|issue|debug|traceback|exception|stack\s*trace|not\s+working|wrong|unexpected)\b/i;
var FEATURE_RE = /\b(add|create|implement|new|build|feature|introduce|set\s*up|scaffold|generate)\b/i;
var REFACTOR_RE = /\b(refactor|clean\s*up|rename|reorganize|simplify|extract|restructure|move|migrate|split)\b/i;
var BRAINSTORM_RE = /\b(brainstorm|idea|what\s+if|explore|think\s+about|approach|strategy|design|consider|how\s+should|what\s+would|opinion|suggest|recommend)\b/i;
var RESEARCH_RE = /\b(research|investigate|look\s+into|find\s+out|check|search|analyze|review|understand|explain|how\s+does|what\s+is|show\s+me|list|compare)\b/i;

var EDIT_TOOLS = new Set(['Edit', 'Write', 'FileEditTool', 'FileWriteTool', 'NotebookEdit', 'MultiEdit']);
var BASH_TOOLS = new Set(['Bash', 'BashTool', 'PowerShellTool']);
var READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'FileReadTool', 'GrepTool', 'GlobTool']);
var TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TodoWrite']);
var SEARCH_TOOLS = new Set(['WebSearch', 'WebFetch', 'ToolSearch']);

function classifyTurn(turn) {
  var tools = [];
  for (var i = 0; i < turn.calls.length; i++) {
    for (var j = 0; j < turn.calls[i].tools.length; j++) {
      tools.push(turn.calls[i].tools[j]);
    }
  }

  var hasPlan = turn.calls.some(function(c) { return c.hasPlanMode; });
  var hasAgent = turn.calls.some(function(c) { return c.hasAgentSpawn; });
  var hasEdit = tools.some(function(t) { return EDIT_TOOLS.has(t); });
  var hasBash = tools.some(function(t) { return BASH_TOOLS.has(t); });
  var hasRead = tools.some(function(t) { return READ_TOOLS.has(t); });
  var hasTask = tools.some(function(t) { return TASK_TOOLS.has(t); });
  var hasSearch = tools.some(function(t) { return SEARCH_TOOLS.has(t); });
  var hasMcp = tools.some(function(t) { return t.startsWith('mcp__'); });
  var hasSkill = tools.some(function(t) { return t === 'Skill'; });
  var msg = turn.userMessage || '';

  if (tools.length === 0) {
    if (BRAINSTORM_RE.test(msg)) return 'brainstorming';
    if (RESEARCH_RE.test(msg)) return 'exploration';
    if (DEBUG_RE.test(msg)) return 'debugging';
    if (FEATURE_RE.test(msg)) return 'feature';
    return 'conversation';
  }

  if (hasPlan) return 'planning';
  if (hasAgent) return 'delegation';

  if (hasBash && !hasEdit) {
    if (TEST_RE.test(msg)) return 'testing';
    if (GIT_RE.test(msg)) return 'git';
    if (BUILD_RE.test(msg)) return 'build/deploy';
    if (INSTALL_RE.test(msg)) return 'build/deploy';
  }

  if (hasEdit) {
    if (DEBUG_RE.test(msg)) return 'debugging';
    if (REFACTOR_RE.test(msg)) return 'refactoring';
    if (FEATURE_RE.test(msg)) return 'feature';
    return 'coding';
  }

  if (hasBash && hasRead) return 'exploration';
  if (hasBash) return 'coding';
  if (hasSearch || hasMcp) return 'exploration';
  if (hasRead && !hasEdit) return 'exploration';
  if (hasTask && !hasEdit) return 'planning';
  if (hasSkill) return 'general';

  if (BRAINSTORM_RE.test(msg)) return 'brainstorming';
  if (RESEARCH_RE.test(msg)) return 'exploration';
  return 'general';
}

// ── JSONL Parser ──────────────────────────────────────────────────────────────
function parseJsonlLine(line) {
  try { return JSON.parse(line); } catch (e) { return null; }
}

function extractToolNames(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter(function(b) { return b && b.type === 'tool_use'; })
    .map(function(b) { return b.name || ''; });
}

function getUserText(message) {
  if (!message || message.role !== 'user') return '';
  var c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter(function(b) { return b && b.type === 'text'; })
            .map(function(b) { return b.text || ''; })
            .join(' ');
  }
  return '';
}

function parseApiCall(entry) {
  if (entry.type !== 'assistant') return null;
  var msg = entry.message;
  if (!msg || !msg.usage || !msg.model) return null;
  var u = msg.usage;
  var tools = extractToolNames(msg.content || []);
  var inputTokens = u.input_tokens || 0;
  var outputTokens = u.output_tokens || 0;
  var cacheWrite = u.cache_creation_input_tokens || 0;
  var cacheRead = u.cache_read_input_tokens || 0;
  var webSearch = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  var speed = u.speed || 'standard';
  var cost = calculateCost(msg.model, inputTokens, outputTokens, cacheWrite, cacheRead, webSearch, speed);
  return {
    model: msg.model,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    cacheWrite: cacheWrite,
    cacheRead: cacheRead,
    webSearch: webSearch,
    cost: cost,
    tools: tools,
    hasAgentSpawn: tools.indexOf('Agent') !== -1,
    hasPlanMode: tools.indexOf('EnterPlanMode') !== -1,
    speed: speed,
    timestamp: entry.timestamp || '',
    msgId: (msg.id || null),
  };
}

function groupAndClassify(entries, seenMsgIds) {
  var turns = [];
  var curMsg = '';
  var curCalls = [];
  var curTs = '';

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.type === 'user') {
      var text = getUserText(e.message);
      if (text.trim()) {
        if (curCalls.length > 0) {
          turns.push({ userMessage: curMsg, calls: curCalls, timestamp: curTs });
        }
        curMsg = text;
        curCalls = [];
        curTs = e.timestamp || '';
      }
    } else if (e.type === 'assistant') {
      var id = e.message && e.message.id;
      if (id && seenMsgIds.has(id)) continue;
      if (id) seenMsgIds.add(id);
      var call = parseApiCall(e);
      if (call) curCalls.push(call);
    }
  }
  if (curCalls.length > 0) {
    turns.push({ userMessage: curMsg, calls: curCalls, timestamp: curTs });
  }

  return turns.map(function(t) {
    return Object.assign({}, t, { category: classifyTurn(t) });
  });
}

function parseSessionFile(filePath, project, seenMsgIds, dateStart, dateEnd) {
  var content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch (e) { return null; }
  var lines = content.split('\n').filter(function(l) { return l.trim(); });
  var entries = [];
  for (var i = 0; i < lines.length; i++) {
    var e = parseJsonlLine(lines[i]);
    if (e) {
      if (dateStart || dateEnd) {
        if (e.timestamp) {
          var ts = new Date(e.timestamp);
          if (dateStart && ts < dateStart) continue;
          if (dateEnd && ts > dateEnd) continue;
        } else if (e.type === 'assistant') {
          continue; // skip undated assistant entries when filtering
        }
      }
      entries.push(e);
    }
  }
  if (entries.length === 0) return null;

  var turns = groupAndClassify(entries, seenMsgIds);
  if (turns.length === 0) return null;

  // Build summary
  var totalCost = 0, totalIn = 0, totalOut = 0, totalCR = 0, totalCW = 0, totalCalls = 0;
  var modelBreakdown = {}, categoryBreakdown = {}, toolBreakdown = {}, mcpBreakdown = {};
  var firstTs = '', lastTs = '';

  for (var i = 0; i < turns.length; i++) {
    var t = turns[i];
    if (!categoryBreakdown[t.category]) categoryBreakdown[t.category] = { turns: 0, cost: 0 };
    categoryBreakdown[t.category].turns++;
    for (var j = 0; j < t.calls.length; j++) {
      var c = t.calls[j];
      totalCost += c.cost;
      totalIn += c.inputTokens;
      totalOut += c.outputTokens;
      totalCR += c.cacheRead;
      totalCW += c.cacheWrite;
      totalCalls++;
      categoryBreakdown[t.category].cost += c.cost;
      var mn = getShortModelName(c.model);
      if (!modelBreakdown[mn]) modelBreakdown[mn] = { calls: 0, cost: 0, tokens: 0 };
      modelBreakdown[mn].calls++;
      modelBreakdown[mn].cost += c.cost;
      modelBreakdown[mn].tokens += c.inputTokens + c.outputTokens;
      for (var k = 0; k < c.tools.length; k++) {
        var tool = c.tools[k];
        if (tool.startsWith('mcp__')) {
          var srv = tool.split('__')[1] || tool;
          if (!mcpBreakdown[srv]) mcpBreakdown[srv] = { calls: 0 };
          mcpBreakdown[srv].calls++;
        } else {
          if (!toolBreakdown[tool]) toolBreakdown[tool] = { calls: 0 };
          toolBreakdown[tool].calls++;
        }
      }
      if (!firstTs || c.timestamp < firstTs) firstTs = c.timestamp;
      if (!lastTs || c.timestamp > lastTs) lastTs = c.timestamp;
    }
  }

  if (totalCalls === 0) return null;

  return {
    sessionId: path.basename(filePath, '.jsonl'),
    project: project,
    firstTimestamp: firstTs || (turns[0] && turns[0].timestamp) || '',
    lastTimestamp: lastTs || '',
    totalCost: totalCost,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    totalCacheRead: totalCR,
    totalCacheWrite: totalCW,
    apiCalls: totalCalls,
    turns: turns,
    modelBreakdown: modelBreakdown,
    categoryBreakdown: categoryBreakdown,
    toolBreakdown: toolBreakdown,
    mcpBreakdown: mcpBreakdown,
  };
}

// ── Directory scanning ────────────────────────────────────────────────────────
function collectJsonlFiles(dirPath) {
  var files = [];
  var entries;
  try { entries = fs.readdirSync(dirPath); } catch (e) { return files; }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.endsWith('.jsonl')) {
      files.push(path.join(dirPath, e));
    } else {
      // Check subagents
      var subDir = path.join(dirPath, e, 'subagents');
      var subFiles;
      try { subFiles = fs.readdirSync(subDir); } catch (_) { continue; }
      for (var j = 0; j < subFiles.length; j++) {
        if (subFiles[j].endsWith('.jsonl')) {
          files.push(path.join(subDir, subFiles[j]));
        }
      }
    }
  }
  return files;
}

function getClaudeProjectsDir() {
  var base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function unsanitize(name) {
  return name.replace(/-/g, '/');
}

/**
 * Scan all Claude Code projects and return aggregated data.
 * @param {Date|null} dateStart
 * @param {Date|null} dateEnd
 * @returns {Object[]} Array of project summaries
 */
function parseAllSessions(dateStart, dateEnd) {
  var projectsDir = getClaudeProjectsDir();
  var projectDirs;
  try { projectDirs = fs.readdirSync(projectsDir); } catch (e) { return []; }

  var seenMsgIds = new Set();
  var projectMap = {};

  for (var i = 0; i < projectDirs.length; i++) {
    var dirName = projectDirs[i];
    var dirPath = path.join(projectsDir, dirName);
    var stat;
    try { stat = fs.statSync(dirPath); } catch (e) { continue; }
    if (!stat.isDirectory()) continue;

    var jsonlFiles = collectJsonlFiles(dirPath);
    for (var j = 0; j < jsonlFiles.length; j++) {
      var session = parseSessionFile(jsonlFiles[j], dirName, seenMsgIds, dateStart, dateEnd);
      if (session && session.apiCalls > 0) {
        if (!projectMap[dirName]) {
          projectMap[dirName] = {
            project: dirName,
            projectPath: unsanitize(dirName),
            sessions: [],
            totalCost: 0,
            totalApiCalls: 0,
          };
        }
        projectMap[dirName].sessions.push(session);
        projectMap[dirName].totalCost += session.totalCost;
        projectMap[dirName].totalApiCalls += session.apiCalls;
      }
    }
  }

  return Object.values(projectMap).sort(function(a, b) { return b.totalCost - a.totalCost; });
}

// ── Aggregation helpers ───────────────────────────────────────────────────────
function getDateRange(period) {
  var now = new Date();
  // Use UTC to match JSONL timestamps (which are stored in UTC ISO strings)
  var y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  var end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  var start;
  if (period === 'today') {
    start = new Date(Date.UTC(y, m, d));
  } else if (period === 'week') {
    start = new Date(Date.UTC(y, m, d - 6));
  } else if (period === '30days') {
    start = new Date(Date.UTC(y, m, d - 29));
  } else { // month
    start = new Date(Date.UTC(y, m, 1));
  }
  return { start: start, end: end };
}

function aggregateProjects(projects) {
  var totalCost = 0, totalIn = 0, totalOut = 0, totalCR = 0, totalCW = 0, totalCalls = 0;
  var modelBreakdown = {}, categoryBreakdown = {}, toolBreakdown = {}, mcpBreakdown = {};
  var dailyCosts = {};

  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    totalCost += p.totalCost;
    totalApiCalls += p.totalApiCalls;
    for (var j = 0; j < p.sessions.length; j++) {
      var s = p.sessions[j];
      totalIn += s.totalInputTokens;
      totalOut += s.totalOutputTokens;
      totalCR += s.totalCacheRead;
      totalCW += s.totalCacheWrite;
      totalCalls += s.apiCalls;
      for (var mn in s.modelBreakdown) {
        if (!modelBreakdown[mn]) modelBreakdown[mn] = { calls: 0, cost: 0, tokens: 0 };
        modelBreakdown[mn].calls += s.modelBreakdown[mn].calls;
        modelBreakdown[mn].cost += s.modelBreakdown[mn].cost;
        modelBreakdown[mn].tokens += s.modelBreakdown[mn].tokens;
      }
      for (var cat in s.categoryBreakdown) {
        if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { turns: 0, cost: 0 };
        categoryBreakdown[cat].turns += s.categoryBreakdown[cat].turns;
        categoryBreakdown[cat].cost += s.categoryBreakdown[cat].cost;
      }
      for (var tool in s.toolBreakdown) {
        if (!toolBreakdown[tool]) toolBreakdown[tool] = { calls: 0 };
        toolBreakdown[tool].calls += s.toolBreakdown[tool].calls;
      }
      for (var srv in s.mcpBreakdown) {
        if (!mcpBreakdown[srv]) mcpBreakdown[srv] = { calls: 0 };
        mcpBreakdown[srv].calls += s.mcpBreakdown[srv].calls;
      }
      // Daily costs
      for (var t = 0; t < s.turns.length; t++) {
        var turn = s.turns[t];
        var day = (turn.timestamp || '').slice(0, 10);
        if (!day) continue;
        if (!dailyCosts[day]) dailyCosts[day] = { cost: 0, calls: 0 };
        for (var c = 0; c < turn.calls.length; c++) {
          dailyCosts[day].cost += turn.calls[c].cost;
          dailyCosts[day].calls++;
        }
      }
    }
  }

  return { totalCost, totalIn, totalOut, totalCR, totalCW, totalCalls, modelBreakdown, categoryBreakdown, toolBreakdown, mcpBreakdown, dailyCosts };
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmt$(n) {
  if (n >= 100) return '$' + n.toFixed(2);
  if (n >= 1) return '$' + n.toFixed(3);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(5);
}

function fmtK(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

// ── Quick summary (for session-restore hook) ──────────────────────────────────
/**
 * Returns a one-line token usage summary for the current day and month.
 * Called at session-restore. Limits scan to last 30 days for speed.
 */
function quickSummary() {
  var now = new Date();
  // Derive UTC date strings directly from current time to match JSONL timestamp format
  var nowIso = now.toISOString(); // e.g. "2026-04-15T07:49:45.506Z"
  var todayStr = nowIso.slice(0, 10);  // "2026-04-15"
  var monthStr = nowIso.slice(0, 7);   // "2026-04"

  // Scan only within current UTC month to bound scan time
  var y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  var monthStart = new Date(Date.UTC(y, m, 1));
  var end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));

  var projects;
  try { projects = parseAllSessions(monthStart, end); } catch (e) { return null; }
  if (!projects || projects.length === 0) return null;

  var todayCost = 0, todayCalls = 0, monthCost = 0, monthCalls = 0;

  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    for (var j = 0; j < p.sessions.length; j++) {
      var s = p.sessions[j];
      for (var t = 0; t < s.turns.length; t++) {
        var turn = s.turns[t];
        var ts = turn.timestamp || '';
        if (!ts) continue;
        for (var c = 0; c < turn.calls.length; c++) {
          var cost = turn.calls[c].cost;
          if (ts.slice(0, 7) === monthStr) { monthCost += cost; monthCalls++; }
          if (ts.slice(0, 10) === todayStr) { todayCost += cost; todayCalls++; }
        }
      }
    }
  }

  if (monthCalls === 0) return null;
  return '[TOKEN_USAGE] Today: ' + fmt$(todayCost) + ' (' + todayCalls + ' calls)  |  Month: ' + fmt$(monthCost) + ' (' + monthCalls + ' calls)';
}

/**
 * Same computation as quickSummary() but returns raw numbers for caching.
 * Used by hook-handler to write .monobrain/metrics/token-summary.json
 */
function quickSummaryData() {
  var now = new Date();
  var nowIso = now.toISOString();
  var todayStr = nowIso.slice(0, 10);
  var monthStr = nowIso.slice(0, 7);
  var y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  var monthStart = new Date(Date.UTC(y, m, 1));
  var end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));

  var projects;
  try { projects = parseAllSessions(monthStart, end); } catch (e) { return null; }
  if (!projects || projects.length === 0) return null;

  var todayCost = 0, todayCalls = 0, monthCost = 0, monthCalls = 0;
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    for (var j = 0; j < p.sessions.length; j++) {
      var s = p.sessions[j];
      for (var t = 0; t < s.turns.length; t++) {
        var turn = s.turns[t];
        var ts = turn.timestamp || '';
        if (!ts) continue;
        for (var c = 0; c < turn.calls.length; c++) {
          var cost = turn.calls[c].cost;
          if (ts.slice(0, 7) === monthStr) { monthCost += cost; monthCalls++; }
          if (ts.slice(0, 10) === todayStr) { todayCost += cost; todayCalls++; }
        }
      }
    }
  }
  if (monthCalls === 0) return null;
  return { todayCost: todayCost, todayCalls: todayCalls, monthCost: monthCost, monthCalls: monthCalls };
}

// ── ANSI Dashboard ────────────────────────────────────────────────────────────
var RESET = '\x1b[0m';
var BOLD  = '\x1b[1m';
var DIM   = '\x1b[2m';

function rgb(r, g, b) { return '\x1b[38;2;' + r + ';' + g + ';' + b + 'm'; }
function bgRgb(r, g, b) { return '\x1b[48;2;' + r + ';' + g + ';' + b + 'm'; }

var ORANGE = rgb(255, 140, 66);
var GOLD   = rgb(255, 215, 0);
var CYAN   = rgb(91, 158, 245);
var GREEN  = rgb(91, 245, 160);
var PURPLE = rgb(224, 91, 245);
var YELLOW = rgb(245, 200, 91);
var TEAL   = rgb(91, 245, 224);
var WHITE  = rgb(220, 220, 220);

function gradColor(pct) {
  function lerp(a, b, t) { return Math.round(a + t * (b - a)); }
  if (pct <= 0.33) {
    var t = pct / 0.33;
    return rgb(lerp(91, 245, t), lerp(158, 200, t), lerp(245, 91, t));
  }
  if (pct <= 0.66) {
    var t = (pct - 0.33) / 0.33;
    return rgb(lerp(245, 255, t), lerp(200, 140, t), lerp(91, 66, t));
  }
  var t = (pct - 0.66) / 0.34;
  return rgb(lerp(255, 245, t), lerp(140, 91, t), lerp(66, 91, t));
}

var CATEGORY_COLORS = {
  coding: CYAN, debugging: rgb(245, 91, 91), feature: GREEN,
  refactoring: YELLOW, testing: PURPLE, exploration: TEAL,
  planning: rgb(123, 158, 245), delegation: rgb(245, 200, 91),
  git: rgb(204, 204, 204), 'build/deploy': GREEN,
  conversation: rgb(136, 136, 136), brainstorming: rgb(245, 91, 224),
  general: rgb(102, 102, 102),
};

function hbar(value, max, width, color) {
  if (max === 0) return DIM + '░'.repeat(width) + RESET;
  var filled = Math.round((value / max) * width);
  var empty = width - filled;
  var bar = '';
  for (var i = 0; i < filled; i++) {
    var pct = (i + 1) / width;
    bar += (color || gradColor(pct)) + '█';
  }
  bar += DIM + '░'.repeat(Math.max(0, empty)) + RESET;
  return bar;
}

function pad(s, n, right) {
  var str = String(s);
  if (str.length >= n) return str.slice(0, n);
  var pad = ' '.repeat(n - str.length);
  return right ? pad + str : str + pad;
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function padAnsi(s, n, right) {
  var vis = stripAnsi(String(s));
  var needed = n - vis.length;
  if (needed <= 0) return s;
  var p = ' '.repeat(needed);
  return right ? p + s : s + p;
}

function box(title, lines, color, width) {
  var c = color || ORANGE;
  var innerW = width - 2;
  var top = c + '┌' + '─'.repeat(innerW) + '┐' + RESET;
  var titleLine = c + '│' + RESET + ' ' + BOLD + title + RESET + ' '.repeat(Math.max(0, innerW - 2 - stripAnsi(title).length)) + c + '│' + RESET;
  var sep = c + '├' + '─'.repeat(innerW) + '┤' + RESET;
  var body = lines.map(function(l) {
    var vis = stripAnsi(l);
    var pad = Math.max(0, innerW - 2 - vis.length);
    return c + '│' + RESET + ' ' + l + ' '.repeat(pad) + ' ' + c + '│' + RESET;
  });
  var bot = c + '└' + '─'.repeat(innerW) + '┘' + RESET;
  return [top, titleLine, sep].concat(body).concat([bot]).join('\n');
}

/**
 * Render a full ANSI dashboard to stdout.
 * @param {string} period  'today'|'week'|'30days'|'month'
 */
function renderDashboard(period) {
  var range = getDateRange(period || 'today');
  var projects;
  try { projects = parseAllSessions(range.start, range.end); } catch (e) {
    process.stdout.write('Error reading sessions: ' + e.message + '\n');
    return;
  }

  var W = Math.min(160, process.stdout.columns || 80);
  var HALF = Math.floor(W / 2);
  var BAR_W = Math.max(6, Math.min(12, HALF - 35));
  var wide = W >= 90;

  // ── aggregate ──────────────────────────────────────────────────────────────
  var totalCost = 0, totalIn = 0, totalOut = 0, totalCR = 0, totalCW = 0, totalCalls = 0;
  var modelBreakdown = {}, categoryBreakdown = {}, toolBreakdown = {}, mcpBreakdown = {};
  var dailyCosts = {};

  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    totalCost += p.totalCost;
    totalCalls += p.totalApiCalls;
    for (var j = 0; j < p.sessions.length; j++) {
      var s = p.sessions[j];
      totalIn += s.totalInputTokens;
      totalOut += s.totalOutputTokens;
      totalCR += s.totalCacheRead;
      totalCW += s.totalCacheWrite;
      for (var mn in s.modelBreakdown) {
        if (!modelBreakdown[mn]) modelBreakdown[mn] = { calls: 0, cost: 0, tokens: 0 };
        modelBreakdown[mn].calls += s.modelBreakdown[mn].calls;
        modelBreakdown[mn].cost += s.modelBreakdown[mn].cost;
        modelBreakdown[mn].tokens += s.modelBreakdown[mn].tokens;
      }
      for (var cat in s.categoryBreakdown) {
        if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { turns: 0, cost: 0 };
        categoryBreakdown[cat].turns += s.categoryBreakdown[cat].turns;
        categoryBreakdown[cat].cost += s.categoryBreakdown[cat].cost;
      }
      for (var tool in s.toolBreakdown) {
        if (!toolBreakdown[tool]) toolBreakdown[tool] = { calls: 0 };
        toolBreakdown[tool].calls += s.toolBreakdown[tool].calls;
      }
      for (var srv in s.mcpBreakdown) {
        if (!mcpBreakdown[srv]) mcpBreakdown[srv] = { calls: 0 };
        mcpBreakdown[srv].calls += s.mcpBreakdown[srv].calls;
      }
      for (var t = 0; t < s.turns.length; t++) {
        var turn = s.turns[t];
        var day = (turn.timestamp || '').slice(0, 10);
        if (!day) continue;
        if (!dailyCosts[day]) dailyCosts[day] = { cost: 0, calls: 0 };
        for (var c = 0; c < turn.calls.length; c++) {
          dailyCosts[day].cost += turn.calls[c].cost;
          dailyCosts[day].calls++;
        }
      }
    }
  }

  var lines = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  var PERIOD_LABELS = { today: 'Today', week: '7 Days', '30days': '30 Days', month: 'This Month' };
  var periodLabel = PERIOD_LABELS[period] || period;
  lines.push('');
  lines.push(ORANGE + BOLD + '  Monobrain Token Usage — ' + periodLabel + RESET);
  lines.push(DIM + '  ' + range.start.toISOString().slice(0, 10) + ' → ' + range.end.toISOString().slice(0, 10) + RESET);
  lines.push('');

  // ── Overview ────────────────────────────────────────────────────────────────
  var overviewLines = [
    GOLD + BOLD + fmt$(totalCost) + RESET + DIM + '  total cost' + RESET,
    WHITE + fmtK(totalIn) + RESET + DIM + ' in  ' + RESET + WHITE + fmtK(totalOut) + RESET + DIM + ' out  ' + RESET + CYAN + fmtK(totalCR) + RESET + DIM + ' cached' + RESET,
    DIM + totalCalls + ' API calls across ' + projects.length + ' project' + (projects.length !== 1 ? 's' : '') + RESET,
    DIM + 'Cache efficiency: ' + RESET + TEAL + (totalIn + totalCR > 0 ? Math.round(totalCR / (totalIn + totalCR) * 100) : 0) + '%' + RESET,
  ];
  lines.push(box('Overview', overviewLines, ORANGE, W));

  // ── Projects ────────────────────────────────────────────────────────────────
  var maxProjCost = projects.reduce(function(m, p) { return Math.max(m, p.totalCost); }, 0);
  var projLines = projects.slice(0, 10).map(function(p) {
    var name = p.projectPath.split('/').pop() || p.project;
    if (name.length > 24) name = name.slice(0, 21) + '…';
    var bar = hbar(p.totalCost, maxProjCost, BAR_W, null);
    return padAnsi(GREEN + name + RESET, 26) + ' ' + bar + ' ' + padAnsi(GOLD + fmt$(p.totalCost) + RESET, 12, true) + DIM + ' ' + p.totalApiCalls + ' calls' + RESET;
  });
  if (projLines.length === 0) projLines = [DIM + 'No data for this period' + RESET];
  lines.push(box('Projects', projLines, GREEN, W));

  // ── Models + Activities (side by side on wide) ───────────────────────────────
  var modelEntries = Object.entries(modelBreakdown).sort(function(a, b) { return b[1].cost - a[1].cost; });
  var maxMCost = modelEntries.reduce(function(m, e) { return Math.max(m, e[1].cost); }, 0);
  var modelLines = modelEntries.slice(0, 8).map(function(e) {
    var mn = e[0]; var data = e[1];
    if (mn.length > 14) mn = mn.slice(0, 12) + '…';
    var bar = hbar(data.cost, maxMCost, BAR_W, PURPLE);
    return padAnsi(PURPLE + mn + RESET, 16) + ' ' + bar + ' ' + padAnsi(GOLD + fmt$(data.cost) + RESET, 12, true) + DIM + ' ' + data.calls + 'x' + RESET;
  });
  if (modelLines.length === 0) modelLines = [DIM + 'No data' + RESET];

  var catEntries = Object.entries(categoryBreakdown).sort(function(a, b) { return b[1].turns - a[1].turns; });
  var maxCat = catEntries.reduce(function(m, e) { return Math.max(m, e[1].turns); }, 0);
  var catLines = catEntries.slice(0, 8).map(function(e) {
    var cat = e[0]; var data = e[1];
    var col = CATEGORY_COLORS[cat] || WHITE;
    var label = cat.charAt(0).toUpperCase() + cat.slice(1);
    if (label.length > 13) label = label.slice(0, 11) + '…';
    var bar = hbar(data.turns, maxCat, BAR_W, col);
    return padAnsi(col + label + RESET, 15) + ' ' + bar + ' ' + padAnsi(DIM + data.turns + ' turns' + RESET, 12, true);
  });
  if (catLines.length === 0) catLines = [DIM + 'No data' + RESET];

  if (wide) {
    var mBox = box('Models', modelLines, PURPLE, HALF - 1);
    var aBox = box('Activity', catLines, YELLOW, W - HALF);
    var mBoxLines = mBox.split('\n');
    var aBoxLines = aBox.split('\n');
    var len = Math.max(mBoxLines.length, aBoxLines.length);
    for (var r = 0; r < len; r++) {
      var ml = mBoxLines[r] || '';
      var al = aBoxLines[r] || '';
      var mlVis = stripAnsi(ml);
      var mlPad = ml + ' '.repeat(Math.max(0, HALF - 1 - mlVis.length));
      lines.push(mlPad + ' ' + al);
    }
  } else {
    lines.push(box('Models', modelLines, PURPLE, W));
    lines.push(box('Activity', catLines, YELLOW, W));
  }

  // ── Daily Chart ─────────────────────────────────────────────────────────────
  var days = Object.keys(dailyCosts).sort().slice(-14);
  var maxDayCost = days.reduce(function(m, d) { return Math.max(m, dailyCosts[d].cost); }, 0);
  var dailyLines = [];
  if (days.length > 0) {
    var CHART_H = 5;
    var chartW = Math.min(days.length * 4, W - 8);
    var colW = Math.max(3, Math.floor(chartW / days.length));

    // Render chart rows top-down
    for (var row = CHART_H; row >= 1; row--) {
      var rowStr = DIM + '  ';
      for (var d = 0; d < days.length; d++) {
        var pct = maxDayCost > 0 ? dailyCosts[days[d]].cost / maxDayCost : 0;
        var colFill = Math.round(pct * CHART_H);
        var ch = colFill >= row ? gradColor(pct) + '▓' : DIM + '░';
        rowStr += ch + ' '.repeat(Math.max(0, colW - 1));
      }
      rowStr += RESET;
      dailyLines.push(rowStr);
    }
    // X-axis labels (just last dates)
    var labelRow = DIM + '  ';
    for (var d = 0; d < days.length; d++) {
      var lbl = days[d].slice(8); // day digits
      labelRow += lbl + ' '.repeat(Math.max(0, colW - lbl.length));
    }
    dailyLines.push(labelRow + RESET);
    dailyLines.push('');
    // Cost row
    dailyLines.push(DIM + '  max: ' + GOLD + fmt$(maxDayCost) + RESET + DIM + ' per day' + RESET);
  } else {
    dailyLines = [DIM + 'No daily data' + RESET];
  }
  lines.push(box('Daily Spend', dailyLines, CYAN, W));

  // ── Top Tools + MCP ────────────────────────────────────────────────────────
  var toolEntries = Object.entries(toolBreakdown).sort(function(a, b) { return b[1].calls - a[1].calls; }).slice(0, 8);
  var maxTool = toolEntries.reduce(function(m, e) { return Math.max(m, e[1].calls); }, 0);
  var toolLines = toolEntries.map(function(e) {
    var name = e[0];
    if (name.length > 16) name = name.slice(0, 14) + '…';
    var bar = hbar(e[1].calls, maxTool, BAR_W, TEAL);
    return padAnsi(TEAL + name + RESET, 18) + ' ' + bar + ' ' + padAnsi(DIM + e[1].calls + 'x' + RESET, 8, true);
  });
  if (toolLines.length === 0) toolLines = [DIM + 'No data' + RESET];

  var mcpEntries = Object.entries(mcpBreakdown).sort(function(a, b) { return b[1].calls - a[1].calls; }).slice(0, 8);
  var maxMcp = mcpEntries.reduce(function(m, e) { return Math.max(m, e[1].calls); }, 0);
  var mcpLines = mcpEntries.map(function(e) {
    var name = e[0];
    if (name.length > 16) name = name.slice(0, 14) + '…';
    var bar = hbar(e[1].calls, maxMcp, BAR_W, rgb(245, 91, 224));
    return padAnsi(rgb(245, 91, 224) + name + RESET, 18) + ' ' + bar + ' ' + padAnsi(DIM + e[1].calls + 'x' + RESET, 8, true);
  });
  if (mcpLines.length === 0) mcpLines = [DIM + 'No MCP calls' + RESET];

  if (wide) {
    var tBox = box('Top Tools', toolLines, TEAL, HALF - 1);
    var mBox2 = box('MCP Servers', mcpLines, rgb(245, 91, 224), W - HALF);
    var tLines = tBox.split('\n');
    var mLines = mBox2.split('\n');
    var len2 = Math.max(tLines.length, mLines.length);
    for (var r = 0; r < len2; r++) {
      var tl = tLines[r] || '';
      var ml2 = mLines[r] || '';
      var tlVis = stripAnsi(tl);
      var tlPad = tl + ' '.repeat(Math.max(0, HALF - 1 - tlVis.length));
      lines.push(tlPad + ' ' + ml2);
    }
  } else {
    lines.push(box('Top Tools', toolLines, TEAL, W));
    lines.push(box('MCP Servers', mcpLines, rgb(245, 91, 224), W));
  }

  lines.push('');
  lines.push(DIM + '  Press q to quit. Refresh with r.' + RESET);
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Run interactive dashboard with keyboard controls.
 */
function runInteractive() {
  var period = 'today';
  var periods = ['today', 'week', '30days', 'month'];

  function draw() {
    process.stdout.write('\x1b[2J\x1b[H'); // clear + home
    renderDashboard(period);
    process.stdout.write(
      '\n' + DIM + '  [1] Today  [2] Week  [3] 30 Days  [4] Month  [p] Prev  [n] Next  [r] Refresh  [q] Quit' + RESET + '\n'
    );
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function(key) {
      if (key === 'q' || key === '\u0003') { // q or Ctrl+C
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(0);
      } else if (key === '1') { period = 'today'; draw(); }
      else if (key === '2') { period = 'week'; draw(); }
      else if (key === '3') { period = '30days'; draw(); }
      else if (key === '4') { period = 'month'; draw(); }
      else if (key === 'r') { draw(); }
      else if (key === 'p') {
        var idx = periods.indexOf(period);
        period = periods[Math.max(0, idx - 1)];
        draw();
      } else if (key === 'n') {
        var idx = periods.indexOf(period);
        period = periods[Math.min(periods.length - 1, idx + 1)];
        draw();
      }
    });
  }

  draw();
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  parseAllSessions: parseAllSessions,
  quickSummary: quickSummary,
  quickSummaryData: quickSummaryData,
  renderDashboard: renderDashboard,
  runInteractive: runInteractive,
  getDateRange: getDateRange,
  fmt$: fmt$,
  fmtK: fmtK,
};

// Allow direct execution
if (require.main === module) {
  var args = process.argv.slice(2);
  var cmd = args[0] || 'dashboard';
  if (cmd === 'summary') {
    var s = quickSummary();
    process.stdout.write((s || 'No token data available') + '\n');
  } else if (cmd === 'report') {
    // Non-interactive one-shot dashboard — safe to pipe, safe inside Claude Code
    var period = args[1] || 'today';
    renderDashboard(period);
  } else if (cmd === 'json') {
    var period = args[1] || 'today';
    var range = getDateRange(period);
    var projects = parseAllSessions(range.start, range.end);
    process.stdout.write(JSON.stringify(projects, null, 2) + '\n');
  } else {
    var period = args[0] && periods && periods.indexOf(args[0]) !== -1 ? args[0] : (args[1] || 'today');
    runInteractive();
  }
}

'use strict';
/**
 * Pick learning loop: aggregates what happened after each pick into
 * .monomind/pick-stats.json, and turns it into a bounded ranking prior.
 *
 * Sources (all written by the hooks, all JSONL):
 *   route-outcomes.jsonl   UserPromptSubmit: one record per routed prompt
 *                          (shown = a [PICK] line reached Claude)
 *   pick-adherence.jsonl   PreToolUse Task|Agent: recommended vs actual agent
 *   routing-feedback.jsonl SubagentStop: the agent that ran and whether it
 *                          succeeded (intelligenceFeedback), followed or not
 *
 * Each source is read incrementally: a cursor stores the byte offset, inode
 * and file head. When the file was rotated or rewritten (joinOutcome rewrites
 * route-outcomes in place) the tail is re-read backwards, bounded, and only
 * records newer than the cursor's timestamp watermark count, plus those at the
 * watermark beyond the ones already counted there. Nothing here
 * throws to a hook: update() returns null on any failure.
 *
 * Adherence is a route's, not a spawn's: a route counts as followed once, at
 * its first spawn of the picked agent (an override counted for an earlier
 * spawn of that route is taken back), and as overridden once otherwise.
 * Slash-command routes are not picks. When .monomind/registry.json is
 * readable only its agents are tracked (other subagent_types, e.g. "issue-337",
 * never enter the stats, and stored ones are dropped).
 *
 * The prior: an agent with >= MIN_OBS observations gets a factor in
 * [1 - SPAN, 1 + SPAN] from Beta(1,1)-smoothed success and adoption rates. It
 * multiplies a keyword score, so a zero-overlap item stays at zero, and the
 * largest possible swing (1.15 / 0.85 = 1.35) is below the 1.5 lead a keyword
 * pick needs to be shown, so a confident relevance gap is never flipped.
 */

const fs = require('fs');
const path = require('path');

var STATS_FILE = 'pick-stats.json';
var SOURCES = {
  routes: 'route-outcomes.jsonl',
  adherence: 'pick-adherence.jsonl',
  feedback: 'routing-feedback.jsonl',
};
var MAX_READ_BYTES = 1024 * 1024;
var CHUNK_BYTES = 64 * 1024;
var HEAD_BYTES = 64;
var MAX_STATS_BYTES = 256 * 1024;
var MAX_ENTRIES = 300;
var MAX_EDGE_KEYS = 50;
var MIN_OBS = 5;
var SPAN = 0.15;
// Routes whose adherence is remembered (followed / overridden / a command).
var MAX_ROUTE_STATES = 500;
// A prompt that is a slash command (the route hook's rule): not a pick.
var COMMAND_PROMPT = /^\/[a-z0-9_-]+(:[a-z0-9_-]+)*(\s|$)/i;

function emptyStats() {
  return {
    version: 1,
    updatedAt: null,
    cursors: {},
    totals: {
      routes: 0,
      shown: 0,
      spawns: 0,
      unpicked: 0,
      followed: 0,
      overridden: 0,
      followedSuccess: 0,
      followedFailure: 0,
      overriddenSuccess: 0,
      overriddenFailure: 0,
    },
    agents: {},
    skills: {},
    routeStates: {},
  };
}

function normName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function statsPath(root) {
  return path.join(root, '.monomind', STATS_FILE);
}

var AGENT_COUNTS = ['recommended', 'followed', 'overridden', 'chosen', 'success', 'failure'];

/** A stored count as a finite non-negative integer (anything else is 0). */
function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The stored stats, or empty stats when missing, oversized or corrupt. The
 *  file is not trusted: every count is sanitized, malformed entries dropped. */
function load(root) {
  try {
    var file = statsPath(root);
    if (fs.statSync(file).size > MAX_STATS_BYTES) return emptyStats();
    var s = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!isObject(s) || s.version !== 1 || !isObject(s.totals)) return emptyStats();
    var out = emptyStats();
    out.updatedAt = typeof s.updatedAt === 'string' ? s.updatedAt : null;
    out.cursors = isObject(s.cursors) ? s.cursors : {};
    Object.keys(out.totals).forEach(function (k) { out.totals[k] = count(s.totals[k]); });
    if (isObject(s.agents)) {
      Object.keys(s.agents).forEach(function (k) {
        var a = s.agents[k];
        if (!isObject(a)) return;
        var entry = { name: String(typeof a.name === 'string' ? a.name : k).slice(0, 128) };
        AGENT_COUNTS.forEach(function (c) { entry[c] = count(a[c]); });
        out.agents[k] = entry;
      });
    }
    if (isObject(s.skills)) {
      Object.keys(s.skills).forEach(function (k) {
        if (isObject(s.skills[k])) out.skills[k] = { recommended: count(s.skills[k].recommended) };
      });
    }
    if (isObject(s.routeStates)) {
      Object.keys(s.routeStates).slice(-MAX_ROUTE_STATES).forEach(function (k) {
        var r = s.routeStates[k];
        if (!isObject(r)) return;
        var st = {};
        if (r.c === 1) st.c = 1;
        if (r.f === 1) st.f = 1;
        if (typeof r.o === 'string') st.o = r.o.slice(0, 128);
        out.routeStates[String(k).slice(0, 128)] = st;
      });
    }
    return out;
  } catch (e) {
    return emptyStats();
  }
}

// ── Incremental JSONL reading ───────────────────────────────────────────────

function readRange(fd, start, end) {
  var buf = Buffer.alloc(Math.max(0, end - start));
  if (buf.length) fs.readSync(fd, buf, 0, buf.length, start);
  return buf;
}

function tsOf(rec) {
  if (typeof rec.ts === 'number' && Number.isFinite(rec.ts)) return rec.ts;
  var t = Date.parse(rec.timestamp);
  return Number.isFinite(t) ? t : 0;
}

/** Identity of a record at the watermark timestamp (stable across joins).
 *  Records with equal keys are told apart by count (see readNew). */
function keyOf(rec) {
  return [tsOf(rec), rec.routeId || '', rec.actual || rec.actualAgent || '', rec.sessionId || '', rec.agentId || ''].join('|');
}

function parseLines(buf) {
  var out = [];
  buf.toString('utf-8').split('\n').forEach(function (line) {
    if (!line.trim()) return;
    try {
      var rec = JSON.parse(line);
      if (rec && typeof rec === 'object' && !Array.isArray(rec)) out.push(rec);
    } catch (e) { /* corrupt line: skip */ }
  });
  return out;
}

/** Complete lines in [start, size), at most MAX_READ_BYTES of the newest. */
function readForward(fd, start, size) {
  var skipPartial = false;
  if (size - start > MAX_READ_BYTES) { start = size - MAX_READ_BYTES; skipPartial = true; }
  var buf = readRange(fd, start, size);
  var from = 0;
  if (skipPartial) from = buf.indexOf(0x0a) + 1;
  var lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < from) return { records: [], offset: start };
  return { records: parseLines(buf.subarray(from, lastNl + 1)), offset: start + lastNl + 1 };
}

/** Rotated/rewritten file: walk back from the end in chunks until a record at
 *  or before `lastTs` is reached (or MAX_READ_BYTES), keeping complete lines. */
function readBackward(fd, size, lastTs) {
  var pos = size;
  var acc = Buffer.alloc(0);
  while (pos > 0 && acc.length < MAX_READ_BYTES) {
    var start = Math.max(0, pos - CHUNK_BYTES);
    acc = Buffer.concat([readRange(fd, start, pos), acc]);
    pos = start;
    if (pos === 0) break;
    var nl = acc.indexOf(0x0a);
    if (nl < 0) continue;
    var next = acc.indexOf(0x0a, nl + 1);
    if (next < 0) continue;
    var first = parseLines(acc.subarray(nl + 1, next + 1))[0];
    if (first && tsOf(first) <= lastTs) break;
  }
  var from = pos === 0 ? 0 : acc.indexOf(0x0a) + 1;
  var lastNl = acc.lastIndexOf(0x0a);
  if (lastNl < from) return { records: [], offset: pos + Math.max(0, from) };
  return { records: parseLines(acc.subarray(from, lastNl + 1)), offset: pos + lastNl + 1 };
}

/** New records of `file` since `cursor`, and the cursor to store next. */
function readNew(file, cursor) {
  var fd;
  try {
    var st = fs.statSync(file);
    fd = fs.openSync(file, 'r');
    var head = readRange(fd, 0, Math.min(HEAD_BYTES, st.size)).toString('base64');
    var same = !!cursor && cursor.ino === st.ino && cursor.head === head && st.size >= cursor.offset;
    var lastTs = cursor && Number.isFinite(cursor.lastTs) ? cursor.lastTs : -1;
    var edge = cursor && Array.isArray(cursor.edge) ? cursor.edge : [];
    var got = same
      ? readForward(fd, cursor.offset, st.size)
      : cursor
        ? readBackward(fd, st.size, lastTs)
        : readForward(fd, 0, st.size);
    var records = got.records;
    if (!same && cursor) {
      // The edge is a multiset: each stored key skips one re-read record, so
      // two identical records at the watermark still count twice.
      var seen = new Map();
      edge.forEach(function (k) { seen.set(k, (seen.get(k) || 0) + 1); });
      records = records.filter(function (r) {
        var t = tsOf(r);
        if (t > lastTs) return true;
        if (t < lastTs) return false;
        var k = keyOf(r);
        var left = seen.get(k) || 0;
        if (left > 0) { seen.set(k, left - 1); return false; }
        return true;
      });
    }
    var maxTs = lastTs;
    records.forEach(function (r) { maxTs = Math.max(maxTs, tsOf(r)); });
    var nextEdge = records.filter(function (r) { return tsOf(r) === maxTs; }).map(keyOf);
    if (maxTs === lastTs) nextEdge = edge.concat(nextEdge);
    return {
      records: records,
      cursor: { ino: st.ino, head: head, offset: got.offset, lastTs: maxTs, edge: nextEdge.slice(-MAX_EDGE_KEYS) },
    };
  } catch (e) {
    return { records: [], cursor: cursor || null };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* closed */ }
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/** normName()s of every agent name and slug in .monomind/registry.json, or
 *  null when it cannot be read (then nothing is filtered). */
function registryNames(root) {
  try {
    var file = path.join(root, '.monomind', 'registry.json');
    if (fs.statSync(file).size > 5 * 1024 * 1024) return null;
    var reg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!reg || !Array.isArray(reg.agents)) return null;
    var names = new Set();
    reg.agents.forEach(function (a) {
      if (!a) return;
      if (typeof a.name === 'string') names.add(normName(a.name));
      if (typeof a.slug === 'string') names.add(normName(a.slug));
    });
    return names;
  } catch (e) {
    return null;
  }
}

function agentEntry(stats, name) {
  var key = normName(name);
  if (!key) return null;
  if (stats._known && !stats._known.has(key)) return null;
  if (!stats.agents[key]) {
    stats.agents[key] = { name: String(name).slice(0, 128), recommended: 0, followed: 0, overridden: 0, chosen: 0, success: 0, failure: 0 };
  }
  return stats.agents[key];
}

function skillEntry(stats, invoke) {
  var key = String(invoke || '').slice(0, 200);
  if (!key) return null;
  if (!stats.skills[key]) stats.skills[key] = { recommended: 0 };
  return stats.skills[key];
}

/** This route's remembered adherence (created on demand; oldest dropped). */
function routeState(stats, routeId) {
  var id = String(routeId).slice(0, 128);
  var st = stats.routeStates[id];
  if (st) return st;
  st = stats.routeStates[id] = {};
  var ids = Object.keys(stats.routeStates);
  for (var i = 0; i < ids.length - MAX_ROUTE_STATES; i++) delete stats.routeStates[ids[i]];
  return st;
}

function dec(obj, key) {
  if (obj && obj[key] > 0) obj[key]--;
}

function addRoute(stats, rec) {
  if (COMMAND_PROMPT.test(String(rec.promptPreview || rec.task || '').trim())) {
    if (rec.routeId) routeState(stats, rec.routeId).c = 1;
    return;
  }
  stats.totals.routes++;
  if (!rec.shown) return;
  stats.totals.shown++;
  var a = rec.agentName ? agentEntry(stats, rec.agentName) : null;
  if (a) a.recommended++;
  var s = rec.skill ? skillEntry(stats, rec.skill) : null;
  if (s) s.recommended++;
}

function addAdherence(stats, rec) {
  stats.totals.spawns++;
  var st = rec.routeId ? routeState(stats, rec.routeId) : null;
  if (!rec.recommended || (st && st.c)) { stats.totals.unpicked++; return; }
  var rec1 = agentEntry(stats, rec.recommended);
  if (rec.followed === true) {
    if (st && st.f) return;
    if (st && st.o !== undefined) {
      // An earlier spawn of this route was counted as an override: the
      // route was followed after all.
      dec(stats.totals, 'overridden');
      dec(rec1, 'overridden');
      if (st.o) dec(stats.agents[st.o], 'chosen');
      delete st.o;
    }
    stats.totals.followed++;
    if (rec1) rec1.followed++;
    if (st) st.f = 1;
  } else if (rec.followed === false) {
    if (st && (st.f || st.o !== undefined)) return;
    stats.totals.overridden++;
    if (rec1) rec1.overridden++;
    var actual = rec.actual ? agentEntry(stats, rec.actual) : null;
    var chosen = actual && actual !== rec1;
    if (chosen) actual.chosen++;
    if (st) st.o = chosen ? normName(rec.actual) : '';
  }
}

function addFeedback(stats, rec) {
  if (!rec.actualAgent || typeof rec.intelligenceFeedback !== 'boolean') return;
  var a = agentEntry(stats, rec.actualAgent);
  if (!a) return;
  var ok = rec.intelligenceFeedback;
  if (ok) a.success++; else a.failure++;
  if (rec.followed === true) stats.totals[ok ? 'followedSuccess' : 'followedFailure']++;
  else if (rec.followed === false) stats.totals[ok ? 'overriddenSuccess' : 'overriddenFailure']++;
}

function evidence(a) {
  return (a.success || 0) + (a.failure || 0) + (a.followed || 0) + (a.overridden || 0) + (a.chosen || 0) + (a.recommended || 0);
}

function capMap(map, weight) {
  var keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return map;
  var out = {};
  keys.sort(function (x, y) { return weight(map[y]) - weight(map[x]); })
    .slice(0, MAX_ENTRIES)
    .forEach(function (k) { out[k] = map[k]; });
  return out;
}

/** Fold every source's new lines into the stats. `persist: false` computes
 *  without writing (read-only callers such as doctor). Returns the stats, or
 *  null when something failed (hooks ignore it). */
function update(root, opts) {
  try {
    var persist = !opts || opts.persist !== false;
    var stats = load(root);
    var dir = path.join(root, '.monomind');
    var known = registryNames(root);
    Object.defineProperty(stats, '_known', { value: known, enumerable: false });
    if (known) {
      Object.keys(stats.agents).forEach(function (k) {
        if (!known.has(k)) delete stats.agents[k];
      });
    }
    var adders = { routes: addRoute, adherence: addAdherence, feedback: addFeedback };
    Object.keys(SOURCES).forEach(function (src) {
      var got = readNew(path.join(dir, SOURCES[src]), stats.cursors[src]);
      got.records.forEach(function (r) { adders[src](stats, r); });
      if (got.cursor) stats.cursors[src] = got.cursor;
    });
    stats.agents = capMap(stats.agents, evidence);
    stats.skills = capMap(stats.skills, function (s) { return s.recommended || 0; });
    stats.updatedAt = new Date().toISOString();
    if (persist) {
      fs.mkdirSync(dir, { recursive: true });
      var file = statsPath(root);
      var tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(stats), 'utf-8');
      fs.renameSync(tmp, file);
    }
    return stats;
  } catch (e) {
    return null;
  }
}

// ── Prior ───────────────────────────────────────────────────────────────────

/** Ranking factor in [1 - SPAN, 1 + SPAN]; 1 with fewer than MIN_OBS
 *  observations. Success: (1+s)/(2+s+f). Adoption: picked-and-followed or
 *  chosen over the pick, against overridden, same smoothing. */
function priorFactor(entry) {
  if (!isObject(entry)) return 1;
  var s = count(entry.success);
  var f = count(entry.failure);
  var a = count(entry.followed) + count(entry.chosen);
  var o = count(entry.overridden);
  if (s + f + a + o < MIN_OBS) return 1;
  var signal = ((1 + s) / (2 + s + f) - 0.5 + (1 + a) / (2 + a + o) - 0.5) / 2;
  var factor = 1 + 2 * SPAN * signal;
  if (!Number.isFinite(factor)) return 1;
  return Math.round(Math.min(1 + SPAN, Math.max(1 - SPAN, factor)) * 1000) / 1000;
}

function entryFor(stats, item) {
  if (!stats || !stats.agents || !item) return null;
  return stats.agents[normName(item.name)] || stats.agents[normName(item.id)] || null;
}

/** Ranked copies re-ordered by score × prior. Each keeps `baseScore` (the
 *  keyword relevance) and `prior`; score 0 stays 0 (never promoted). Equal
 *  adjusted scores keep the incoming order. */
function applyPriors(ranked, stats) {
  return (ranked || [])
    .map(function (r, i) {
      var base = Number.isFinite(r.score) ? r.score : 0;
      var prior = base > 0 ? priorFactor(entryFor(stats, r)) : 1;
      return { r: Object.assign({}, r, { baseScore: base, prior: prior, score: Math.round(base * prior * 1000) / 1000 }), i: i };
    })
    .sort(function (x, y) { return y.r.score - x.r.score || x.i - y.i; })
    .map(function (x) { return x.r; });
}

function rate(num, den) {
  return den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
}

/** The doctor-facing summary (src/decision/pick-stats.ts readPickStats). */
function summarize(stats) {
  stats = stats || emptyStats();
  var t = stats.totals;
  var topAgents = Object.keys(stats.agents)
    .map(function (k) { return stats.agents[k]; })
    .sort(function (x, y) { return evidence(y) - evidence(x); })
    .slice(0, 10)
    .map(function (a) {
      return {
        name: a.name,
        recommended: a.recommended || 0,
        followed: a.followed || 0,
        overridden: a.overridden || 0,
        chosen: a.chosen || 0,
        success: a.success || 0,
        failure: a.failure || 0,
        successRate: rate(a.success || 0, (a.success || 0) + (a.failure || 0)),
        prior: priorFactor(a),
      };
    });
  return {
    routes: t.routes,
    shown: t.shown,
    spawns: t.spawns,
    adherenceRate: rate(t.followed, t.followed + t.overridden),
    followedSuccessRate: rate(t.followedSuccess, t.followedSuccess + t.followedFailure),
    notFollowedSuccessRate: rate(t.overriddenSuccess, t.overriddenSuccess + t.overriddenFailure),
    topAgents: topAgents,
    updatedAt: stats.updatedAt || null,
  };
}

module.exports = {
  MIN_OBS: MIN_OBS,
  SPAN: SPAN,
  MAX_ENTRIES: MAX_ENTRIES,
  MAX_READ_BYTES: MAX_READ_BYTES,
  load: load,
  readNew: readNew,
  update: update,
  priorFactor: priorFactor,
  applyPriors: applyPriors,
  summarize: summarize,
};

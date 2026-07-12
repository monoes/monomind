'use strict';
/**
 * Intelligence context module for hook-handler.cjs
 * Provides context injection, trajectory logging, feedback recording,
 * edit tracking, consolidation, and stats.
 *
 * Data directory: $CLAUDE_PROJECT_DIR/.monomind/data/
 *   auto-memory-store.json      — persisted memory entries
 *   ranked-context.json         — ranked view written by init()
 *   pending-insights.jsonl      — pending entries to consolidate
 *   intelligence-outcomes.jsonl — feedback records
 */

const path = require('path');
const fs = require('fs');

// Resolve base dir at require-time so tests can inject CLAUDE_PROJECT_DIR
// per fresh require() call.
const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DATA_DIR = path.join(CWD, '.monomind', 'data');
const STORE_FILE = path.join(DATA_DIR, 'auto-memory-store.json');
const RANKED_FILE = path.join(DATA_DIR, 'ranked-context.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending-insights.jsonl');
const OUTCOMES_FILE = path.join(DATA_DIR, 'intelligence-outcomes.jsonl');
const RECENT_EDITS_FILE = path.join(DATA_DIR, 'recent-edits.jsonl');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB guard
const RING_BUFFER_MAX = 50;

var _entries = [];        // deduplicated memory entries loaded from store
var _recentEdits = [];    // ring buffer of recently edited paths (in-memory, may be empty across subprocesses)
var _lastContext = null;  // last non-null context returned by getContext()

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

// ── multi-process-safe store flush (P1-14) ──────────────────────────────────
// STORE_FILE (auto-memory-store.json) is read once into `_entries` at init()
// and can be written by more than one code path — consolidate() and
// bootstrapFromDb() — each of which may be running in a *different* process
// (e.g. the long-lived MCP server process and a short-lived CJS hook
// subprocess launched concurrently). Without a lock + re-read-before-write,
// whichever process flushes last silently erases whatever the other process
// added since its own load. mergeAndWriteStore() re-reads the current
// on-disk file immediately before writing, merges the caller's updates in by
// `id` (keeping whichever record has the newer `ts`), and writes atomically
// via tmp+rename, guarded by a short advisory lock.

const STORE_LOCK_FILE = STORE_FILE + '.lock';
const STORE_LOCK_STALE_MS = 10 * 1000; // single JSON write — 10s is generous

// Mirrors the stale-lock-breaking pattern in .claude/helpers/control-start.cjs
// (claimSpawnLock/releaseSpawnLock): wx-flag write to claim, break the lock
// if its holder is dead or the lock is older than the stale threshold, retry
// once, then give up and proceed unlocked (best-effort — a missed lock still
// merges via the re-read, it just narrows a tiny TOCTOU window further).
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

function claimStoreLock() {
  try { fs.mkdirSync(path.dirname(STORE_LOCK_FILE), { recursive: true }); } catch (_) {}
  try {
    fs.writeFileSync(STORE_LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch (_) {
    try {
      var stat = fs.statSync(STORE_LOCK_FILE);
      var holder = Number(fs.readFileSync(STORE_LOCK_FILE, 'utf-8'));
      if (Date.now() - stat.mtimeMs < STORE_LOCK_STALE_MS && isPidAlive(holder)) return false;
      fs.unlinkSync(STORE_LOCK_FILE);
      fs.writeFileSync(STORE_LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch (_) {
      return false;
    }
  }
}

function releaseStoreLock() {
  try {
    if (Number(fs.readFileSync(STORE_LOCK_FILE, 'utf-8')) === process.pid) fs.unlinkSync(STORE_LOCK_FILE);
  } catch (_) { /* ignore */ }
}

/**
 * Merge `updates` (new or changed entries) into the on-disk store and write
 * the result atomically. Re-reads STORE_FILE immediately before writing so a
 * concurrent flush from another process is merged, not clobbered. When both
 * sides have an entry with the same `id`, the one with the newer `ts` wins.
 */
function mergeAndWriteStore(updates, capTo) {
  var acquired = claimStoreLock();
  if (!acquired) acquired = claimStoreLock(); // one retry — lock is short-lived

  try {
    var diskRaw = safeReadJson(STORE_FILE);
    var diskEntries = Array.isArray(diskRaw) ? diskRaw : [];
    var merged = new Map();
    for (var i = 0; i < diskEntries.length; i++) {
      var d = diskEntries[i];
      if (d && d.id) merged.set(String(d.id), d);
    }
    for (var j = 0; j < (updates || []).length; j++) {
      var u = updates[j];
      if (!u || !u.id) continue;
      var key = String(u.id);
      var existing = merged.get(key);
      if (!existing || (u.ts || 0) >= (existing.ts || 0)) {
        merged.set(key, u);
      }
    }
    var result = Array.from(merged.values());
    if (capTo && result.length > capTo) {
      result.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
      result = result.slice(0, capTo);
    }
    var tmpPath = STORE_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2), 'utf-8');
    fs.renameSync(tmpPath, STORE_FILE);
    return result;
  } finally {
    if (acquired) releaseStoreLock();
  }
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    var st = fs.statSync(filePath);
    if (st.size > MAX_FILE_SIZE) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) { return null; }
}

function safeReadLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    var st = fs.statSync(filePath);
    if (st.size > MAX_FILE_SIZE) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(function(l) { return l.trim().length > 0; });
  } catch (_) { return []; }
}

// ── init ───────────────────────────────────────────────────────────────────────

function init() {
  ensureDataDir();

  // Load entries from store, deduplicate by id
  var raw = safeReadJson(STORE_FILE);
  var arr = Array.isArray(raw) ? raw : [];
  var seen = new Set();
  _entries = arr.filter(function(e) {
    var key = e && e.id ? String(e.id) : null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Bootstrap from monograph when store is sparse — called externally via bootstrapFromDb(db)

  // Write ranked-context.json (sorted by confidence desc) with version envelope
  var ranked = _entries.slice().sort(function(a, b) {
    return (b.confidence || 0) - (a.confidence || 0);
  });
  try {
    fs.writeFileSync(RANKED_FILE, JSON.stringify({ version: 1, entries: ranked }, null, 2), 'utf-8');
  } catch (_) {}

  return { nodes: _entries.length, edges: 0 };
}

// ── getContext ─────────────────────────────────────────────────────────────────

function getContext(prompt) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') return null;
  if (_entries.length === 0) return null;

  var promptWords = prompt.toLowerCase().split(/\W+/).filter(function(w) { return w.length >= 3; });
  var promptSet = new Set(promptWords);
  if (promptSet.size < 2) return null; // need at least 2 meaningful words

  var scored = [];
  for (var i = 0; i < _entries.length; i++) {
    var e = _entries[i];
    var content = ((e.content || '') + ' ' + (e.summary || '')).toLowerCase();
    var words = content.split(/\W+/).filter(function(w) { return w.length >= 3; });
    var hits = 0;
    for (var j = 0; j < words.length; j++) {
      if (promptSet.has(words[j])) hits++;
    }
    // Require at least 2 distinct word matches to reduce false positives
    if (hits >= 2) {
      scored.push({ entry: e, hits: hits });
    }
  }

  if (scored.length === 0) return null;

  // Sort by hit count descending, then by confidence
  scored.sort(function(a, b) {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return (b.entry.confidence || 0) - (a.entry.confidence || 0);
  });

  var top = scored[0].entry;
  var result = '[INTELLIGENCE] ' + (top.summary || top.content || top.id || 'context match');
  _lastContext = result;
  return result;
}

// ── recordEdit ────────────────────────────────────────────────────────────────

function recordEdit(filePath) {
  var entry = { path: String(filePath || ''), ts: Date.now() };
  _recentEdits.push(entry);
  if (_recentEdits.length > RING_BUFFER_MAX) {
    _recentEdits = _recentEdits.slice(-RING_BUFFER_MAX);
  }
  // Persist to disk so other subprocesses (e.g. feedback()) can read edits
  ensureDataDir();
  try { fs.appendFileSync(RECENT_EDITS_FILE, JSON.stringify(entry) + '\n', 'utf-8'); } catch (_) {}
}

// ── consolidate ───────────────────────────────────────────────────────────────

function consolidate() {
  ensureDataDir();
  var lines = safeReadLines(PENDING_FILE);
  var count = lines.length;

  // Clear the pending file
  try { fs.writeFileSync(PENDING_FILE, '', 'utf-8'); } catch (_) {}

  // Read accumulated session edits (not yet consumed by feedback)
  var sessionEdits = [];
  var editLines = safeReadLines(RECENT_EDITS_FILE);
  for (var ei = 0; ei < editLines.length; ei++) {
    try { sessionEdits.push(JSON.parse(editLines[ei])); } catch (_) {}
  }
  // Clear recent-edits after consolidation (session boundary)
  try { fs.writeFileSync(RECENT_EDITS_FILE, '', 'utf-8'); } catch (_) {}

  // Load session episodes (written by session-handler.cjs into the same
  // .monomind dir) so patterns can carry real semantic content — the user's
  // prompt snippet and commit subjects — instead of just file basenames.
  var episodes = [];
  var episodeLines = safeReadLines(path.join(CWD, '.monomind', 'episodic', 'episodes.jsonl'));
  for (var epi = 0; epi < episodeLines.length; epi++) {
    try { episodes.push(JSON.parse(episodeLines[epi])); } catch (_) {}
  }

  // Build-noise artifacts that say nothing about what the task actually was.
  function isNoisePath(p) {
    var base = path.basename(p);
    if (base === 'tsconfig.tsbuildinfo' || base === 'coverage.json') return true;
    if (/\.map$/.test(base)) return true;
    if (/(^|\/)dist\//.test(p)) return true;
    return false;
  }

  // Nearest episode whose end time is within 30 minutes of the outcome.
  function findEpisodeNear(ts) {
    var best = null;
    var bestDelta = 30 * 60 * 1000;
    for (var ki = 0; ki < episodes.length; ki++) {
      var cand = episodes[ki];
      var delta = Math.abs((cand.endedAt || 0) - ts);
      if (delta <= bestDelta) { bestDelta = delta; best = cand; }
    }
    return best;
  }

  // Synthesize successful patterns from outcomes into auto-memory-store.json
  var outcomeLines = safeReadLines(OUTCOMES_FILE);
  var newStoreEntries = [];
  for (var i = 0; i < outcomeLines.length; i++) {
    try {
      var outcome = JSON.parse(outcomeLines[i]);
      if (!outcome.success) continue;
      // Use outcome's own edits if present, otherwise use session-level edits
      var edits = (Array.isArray(outcome.recentEdits) && outcome.recentEdits.length > 0)
        ? outcome.recentEdits
        : sessionEdits;
      if (edits.length === 0) continue;
      var editPaths = edits.map(function(e) {
        // e is either { path: '...', ts: ... } or a raw string
        if (typeof e === 'string') return e;
        // Use e.path if it's a non-empty string; skip objects without a valid path
        return (e && typeof e.path === 'string' && e.path.length > 0) ? e.path : null;
      }).filter(function(p) { return p !== null; });
      // Deduplicate paths, dropping build-noise artifacts (tsbuildinfo,
      // sourcemaps, coverage output, dist/ bundles) so the pattern describes
      // real source work.
      var uniquePaths = [];
      var pathSeen = {};
      for (var pi = 0; pi < editPaths.length; pi++) {
        var p = String(editPaths[pi]);
        if (isNoisePath(p)) continue;
        if (!pathSeen[p]) { pathSeen[p] = true; uniquePaths.push(p); }
      }
      if (uniquePaths.length === 0) continue;
      var baseNames = uniquePaths.slice(0, 5).map(function(bp) { return path.basename(bp); });

      // Prefer real semantic content for the summary: outcome.context (rare —
      // only set when getContext matched in the same process), else the
      // matching episode's prompt snippet + first commit subject.
      var summary = outcome.context || null;
      var hasCommits = false;
      var ep = findEpisodeNear(outcome.ts || Date.now());
      if (ep && ep.summary) {
        // Episode summaries are newline-joined parts written by
        // session-handler: prompt snippet, "Commits: ...", "Modified: ...",
        // "Outcome: ...".
        var epParts = String(ep.summary).split('\n');
        var promptSnippet = '';
        var commitSubject = '';
        for (var si = 0; si < epParts.length; si++) {
          var part = epParts[si].trim();
          if (!part) continue;
          if (part.indexOf('Commits: ') === 0) {
            if (!commitSubject) commitSubject = part.slice(9).split(';')[0].trim();
          } else if (part.indexOf('Modified: ') !== 0 && part.indexOf('Outcome: ') !== 0 && !promptSnippet) {
            promptSnippet = part.slice(0, 160);
          }
        }
        hasCommits = commitSubject.length > 0;
        if (!summary) {
          var bits = [];
          if (promptSnippet) bits.push(promptSnippet);
          if (commitSubject) bits.push('commit: ' + commitSubject);
          if (bits.length > 0) summary = bits.join(' — ') + ' (files: ' + baseNames.join(', ') + ')';
        }
      }
      if (!summary) summary = 'Successful task editing ' + uniquePaths.length + ' files: ' + baseNames.join(', ');

      // Confidence from evidence rather than a hardcoded constant:
      //   0.5 base for any successful outcome
      //   +0.2 when commits back the session (strongest success signal)
      //   +0.1 when test files were part of the edit set
      var confidence = 0.5;
      if (hasCommits) confidence += 0.2;
      var touchedTests = uniquePaths.some(function(tp) {
        return /(^|\/)(tests?|__tests__)\//.test(tp) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(tp);
      });
      if (touchedTests) confidence += 0.1;
      confidence = Math.round(confidence * 100) / 100; // avoid FP artifacts like 0.7999…

      newStoreEntries.push({
        id: 'auto-' + (outcome.ts || Date.now()) + '-' + i,
        type: 'pattern',
        content: 'Successful edit pattern: ' + uniquePaths.map(function(cp) { return path.basename(cp); }).join(', '),
        summary: summary,
        confidence: confidence,
        files: uniquePaths,
        ts: outcome.ts || Date.now(),
      });
    } catch (_) {}
  }

  if (newStoreEntries.length > 0) {
    // Decide which of newStoreEntries are worth adding, based on a read of
    // the store as of "now". The actual write below re-reads immediately
    // before flushing (mergeAndWriteStore), so a concurrent process's writes
    // in between are merged rather than clobbered — this initial read is
    // only used for the near-duplicate decision, not as the write's base.
    var existing = safeReadJson(STORE_FILE);
    var store = Array.isArray(existing) ? existing : [];
    var existingIds = new Set(store.map(function(e) { return e && e.id; }));
    // Skip near-identical patterns: same summary text or same file set as an
    // entry already in the store (or one added earlier in this batch).
    var fileSetKey = function(e) { return (e.files || []).slice().sort().join('|'); };
    var seenSummaries = new Set(store.map(function(e) { return e && e.summary; }));
    var seenFileSets = new Set(store.filter(function(e) { return e && Array.isArray(e.files) && e.files.length > 0; }).map(fileSetKey));
    var toAdd = [];
    var addedCount = 0;
    for (var j = 0; j < newStoreEntries.length; j++) {
      var ne = newStoreEntries[j];
      if (existingIds.has(ne.id)) continue;
      if (seenSummaries.has(ne.summary)) continue;
      if (ne.files && ne.files.length > 0 && seenFileSets.has(fileSetKey(ne))) continue;
      toAdd.push(ne);
      seenSummaries.add(ne.summary);
      if (ne.files && ne.files.length > 0) seenFileSets.add(fileSetKey(ne));
      addedCount++;
    }
    if (toAdd.length > 0) {
      try {
        mergeAndWriteStore(toAdd, 200);
      } catch (_) {}
    }
    count += addedCount;
  }

  // Rotate outcomes: keep last 500 lines to prevent unbounded growth
  if (outcomeLines.length > 500) {
    try {
      fs.writeFileSync(OUTCOMES_FILE, outcomeLines.slice(-500).join('\n') + '\n', 'utf-8');
    } catch (_) {}
  }

  return { entries: count, edges: 0, newEntries: addedCount || 0 };
}

// ── feedback ──────────────────────────────────────────────────────────────────

function feedback(success) {
  ensureDataDir();
  // Read persisted edits from disk (survives subprocess boundaries).
  // We intentionally do NOT clear recent-edits.jsonl here — that is done by
  // consolidate() at session-end. This prevents post-task (subagent completion)
  // from clearing edits that belong to the broader session's work.
  var diskEdits = [];
  var diskLines = safeReadLines(RECENT_EDITS_FILE);
  for (var i = 0; i < diskLines.length; i++) {
    try { diskEdits.push(JSON.parse(diskLines[i])); } catch (_) {}
  }
  // Use disk edits if available, fall back to in-memory buffer
  var edits = diskEdits.length > 0 ? diskEdits.slice(-RING_BUFFER_MAX) : _recentEdits.slice();
  var record = JSON.stringify({
    ts: Date.now(),
    success: !!success,
    context: _lastContext,
    recentEdits: edits,
  }) + '\n';
  try { fs.appendFileSync(OUTCOMES_FILE, record, 'utf-8'); } catch (_) {}
}

// ── stats ─────────────────────────────────────────────────────────────────────

function stats(asJson) {
  var result = {
    entries: _entries.length,
    recentEdits: _recentEdits.length,
    pending: safeReadLines(PENDING_FILE).length,
  };
  if (asJson) return JSON.stringify(result);
  return result;
}

// ── legacy ────────────────────────────────────────────────────────────────────

function logTrajectory(step) {
  // no-op stub for backward compatibility
  void step;
}

function storePattern(pattern) {
  // no-op stub for backward compatibility
  void pattern;
}

// ── AutoMem bridges — lazy-load the compiled intelligence module and expose ──
// ── its pattern-recall/decision-recording helpers to the .cjs hook handlers ──

var _intelligenceMod = null;

async function _loadIntelligenceMod() {
  if (_intelligenceMod) return _intelligenceMod;
  try {
    _intelligenceMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/memory/intelligence.js'));
  } catch (_) {
    _intelligenceMod = null;
  }
  return _intelligenceMod;
}

async function findSimilarPatterns(query, options) {
  var mod = await _loadIntelligenceMod();
  if (mod && mod.findSimilarPatterns) return mod.findSimilarPatterns(query, options);
  return [];
}

async function recordMemoryDecision(input) {
  var mod = await _loadIntelligenceMod();
  if (mod && mod.recordMemoryDecision) return mod.recordMemoryDecision(input);
}

// Bootstrap intelligence store from an already-open monograph DB handle.
// Called from route-handler on first prompt when store is sparse.
function bootstrapFromDb(db) {
  if (!db || _entries.length >= 5) return 0;
  try {
    var hubs = db.prepare(
      "SELECT n.name, n.label, n.file_path AS file, COUNT(e.id) AS deg " +
      "FROM nodes n JOIN edges e ON (e.source_id = n.id OR e.target_id = n.id) " +
      "WHERE n.label IN ('File','Function','Class') AND n.file_path NOT LIKE '%node_modules%' AND n.file_path NOT LIKE '%dist/%' " +
      "GROUP BY n.id ORDER BY deg DESC LIMIT 10"
    ).all();
    if (hubs.length === 0) return 0;
    var existingIds = new Set(_entries.map(function(e) { return e.id; }));
    var newHubEntries = [];
    var added = 0;
    for (var hi = 0; hi < hubs.length; hi++) {
      var h = hubs[hi];
      var bId = 'bootstrap-hub-' + hi;
      if (existingIds.has(bId)) continue;
      var hubEntry = {
        id: bId,
        type: 'hub',
        content: h.name + ' (' + h.label + ') — ' + (h.file || '').replace(CWD + '/', '') + ' (' + h.deg + ' connections)',
        summary: 'Key codebase hub: ' + h.name + ' with ' + h.deg + ' dependencies',
        confidence: 0.4,
        files: h.file ? [h.file] : [],
        ts: Date.now(),
      };
      _entries.push(hubEntry);
      newHubEntries.push(hubEntry);
      added++;
    }
    if (added > 0) {
      ensureDataDir();
      // mergeAndWriteStore re-reads STORE_FILE immediately before writing, so
      // this only ever adds these hub entries into whatever is currently on
      // disk — it never overwrites entries a concurrent process added.
      try { mergeAndWriteStore(newHubEntries, 200); } catch (_) {}
    }
    return added;
  } catch (_) { return 0; }
}

module.exports = { init, getContext, recordEdit, consolidate, feedback, stats, logTrajectory, storePattern, findSimilarPatterns, recordMemoryDecision, bootstrapFromDb };

'use strict';
/**
 * memory-palace.cjs — MemPalace-inspired cross-session memory for Monobrain
 *
 * Architecture (Wing → Room → Hall namespace hierarchy):
 *   Drawers   verbatim 800-char chunks with 100-char overlap  → drawers.jsonl
 *   Closets   regex topic-pointer index (no AI calls)          → closets.jsonl
 *   KG        temporal knowledge graph (SQLite-free triples)   → kg.json
 *
 * Memory stack:
 *   L0  identity     identity.md — static, user-maintained
 *   L1  essential    top-scored recent drawers → injected on session-restore
 *   L2  on-demand    recall(wing, room) — explicit namespace pull
 *   L3  deep search  search(query)      — Okapi BM25 across all drawers
 *
 * Wire points in hook-handler.cjs:
 *   session-restore  → wakeUp(CWD)         injects L0 + L1 into session context
 *   post-task        → storeVerbatim(...)   files the verbatim task chunks
 */

const fs = require('fs');
const path = require('path');

// ── constants ─────────────────────────────────────────────────────────────────
const DRAWER_SIZE = 800;   // chars per verbatim chunk
const OVERLAP     = 100;   // overlap between consecutive chunks
const L1_LIMIT    = 5;     // max drawers surfaced in essential story
const L1_DAYS     = 30;    // look-back window for L1 drawers (days)
const BM25_K1     = 1.5;   // term-frequency saturation
const BM25_B      = 0.75;  // length normalisation

// ── filesystem helpers ────────────────────────────────────────────────────────
function palaceDir(cwd) {
  return path.join(cwd, '.monobrain', 'palace');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(function(line) { return JSON.parse(line); });
  } catch (e) {
    return [];
  }
}

function appendJsonl(filePath, record) {
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Okapi BM25 ────────────────────────────────────────────────────────────────
function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * bm25(query, docs) → [{ id, score }, …] sorted descending
 * docs: array of { id, text }
 */
function bm25(query, docs) {
  if (!docs || docs.length === 0) return [];
  var qTerms = tokenize(query);
  if (qTerms.length === 0) return docs.map(function(d) { return { id: d.id, score: 0 }; });

  // Pre-tokenize every document
  var tokenized = docs.map(function(d) {
    return { id: d.id, tokens: tokenize(d.text || '') };
  });
  var N    = tokenized.length;
  var avgdl = tokenized.reduce(function(s, d) { return s + d.tokens.length; }, 0) / (N || 1);

  // Document frequency per term
  var df = {};
  tokenized.forEach(function(d) {
    var seen = {};
    d.tokens.forEach(function(t) { seen[t] = true; });
    Object.keys(seen).forEach(function(t) { df[t] = (df[t] || 0) + 1; });
  });

  // Score each document
  return tokenized.map(function(d) {
    var tf = {};
    d.tokens.forEach(function(t) { tf[t] = (tf[t] || 0) + 1; });
    var dl    = d.tokens.length;
    var score = 0;
    qTerms.forEach(function(term) {
      var f = tf[term] || 0;
      if (f === 0) return;
      var dfTerm = df[term] || 0;
      var idf    = Math.log((N - dfTerm + 0.5) / (dfTerm + 0.5) + 1);
      score += idf * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl));
    });
    return { id: d.id, score: score };
  }).sort(function(a, b) { return b.score - a.score; });
}

// ── closet extraction (no AI, regex only) ─────────────────────────────────────
/**
 * buildClosets(content, drawerId) → [closet record, …]
 * Extracts: section headers, action phrases, proper nouns, quoted passages.
 */
function buildClosets(content, drawerId) {
  var results = [];
  var ts = new Date().toISOString();
  var m;

  // Section headers (Markdown)
  var headerRe = /^#{1,3}\s+(.+)$/gm;
  while ((m = headerRe.exec(content)) !== null) {
    results.push({ drawerId: drawerId, term: m[1].trim(), type: 'header', ts: ts });
  }

  // Action phrases: "verb Object"
  var actionRe = /\b(built|fixed|added|implemented|created|removed|updated|refactored|deployed|configured|enabled|disabled|migrated|merged|published|released|optimized|rewrote|designed|analyzed|reviewed)\s+([A-Za-z][A-Za-z0-9_/.-]{1,50})/g;
  while ((m = actionRe.exec(content)) !== null) {
    results.push({ drawerId: drawerId, term: m[1] + ' ' + m[2], type: 'action', ts: ts });
  }

  // Proper nouns: consecutive Title Case words
  var properRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  var properSeen = {};
  while ((m = properRe.exec(content)) !== null) {
    if (!properSeen[m[1]]) {
      properSeen[m[1]] = true;
      results.push({ drawerId: drawerId, term: m[1], type: 'proper', ts: ts });
    }
  }

  // Quoted passages (3–60 chars)
  var quotedRe = /"([^"]{3,60})"|`([^`]{3,60})`/g;
  while ((m = quotedRe.exec(content)) !== null) {
    var phrase = (m[1] || m[2]).trim();
    results.push({ drawerId: drawerId, term: phrase, type: 'quoted', ts: ts });
  }

  return results;
}

// ── storeVerbatim ─────────────────────────────────────────────────────────────
/**
 * storeVerbatim(cwd, content, { wing, room, hall })
 * Chunks content into DRAWER_SIZE-char segments (with OVERLAP), stores each
 * as a drawer and extracts closet topics from each chunk.
 */
function storeVerbatim(cwd, content, meta) {
  if (!content || typeof content !== 'string' || content.trim().length < 20) return;
  var pDir = palaceDir(cwd);
  ensureDir(pDir);

  var wing = (meta && meta.wing) || 'general';
  var room = (meta && meta.room) || 'default';
  var hall = (meta && meta.hall) || '';
  var ts   = new Date().toISOString();

  var drawersFile = path.join(pDir, 'drawers.jsonl');
  var closetsFile = path.join(pDir, 'closets.jsonl');

  var step = DRAWER_SIZE - OVERLAP;
  var i = 0;
  while (i < content.length) {
    var chunk = content.slice(i, i + DRAWER_SIZE);
    if (chunk.trim().length >= 20) {
      var id     = uid();
      var drawer = { id: id, content: chunk, wing: wing, room: room, hall: hall, score: 1.0, ts: ts };
      appendJsonl(drawersFile, drawer);
      var closets = buildClosets(chunk, id);
      closets.forEach(function(c) { appendJsonl(closetsFile, c); });
    }
    if (i + DRAWER_SIZE >= content.length) break;
    i += step;
  }
}

// ── score persistence ─────────────────────────────────────────────────────────
/**
 * _bumpScores(drawersFile, ids)
 * Rewrite drawers.jsonl with score += 1 for the given drawer ids.
 * Called after search/recall so frequently-retrieved drawers rise to L1.
 */
function _bumpScores(drawersFile, ids) {
  if (!ids || ids.length === 0) return;
  var idSet = {};
  ids.forEach(function(id) { idSet[id] = true; });
  try {
    var drawers = readJsonl(drawersFile);
    var changed = false;
    drawers.forEach(function(d) {
      if (idSet[d.id]) { d.score = (d.score || 1.0) + 1; changed = true; }
    });
    if (changed) {
      fs.writeFileSync(drawersFile, drawers.map(function(d) { return JSON.stringify(d); }).join('\n') + '\n', 'utf-8');
    }
  } catch (e) { /* non-fatal */ }
}

// ── search (L3 deep) ──────────────────────────────────────────────────────────
/**
 * search(cwd, query, { wing, room, limit }) → drawer[]
 * BM25 across all drawers + closet-topic boost, filtered by wing/room.
 * Bumps score on retrieved drawers so L1 surfaces actually-used content.
 */
function search(cwd, query, opts) {
  opts = opts || {};
  var limit       = opts.limit || 5;
  var pDir        = palaceDir(cwd);
  var drawersFile = path.join(pDir, 'drawers.jsonl');
  var drawers     = readJsonl(drawersFile);

  if (opts.wing) drawers = drawers.filter(function(d) { return d.wing === opts.wing; });
  if (opts.room) drawers = drawers.filter(function(d) { return d.room === opts.room; });
  if (drawers.length === 0) return [];

  // BM25 baseline
  var docs   = drawers.map(function(d) { return { id: d.id, text: d.content }; });
  var ranked = bm25(query, docs);

  // Closet boost: drawers whose topic terms match query words get +0.5
  try {
    var closets     = readJsonl(path.join(pDir, 'closets.jsonl'));
    var qWords      = tokenize(query);
    var closetBoost = {};
    closets.forEach(function(c) {
      var termWords = tokenize(c.term);
      var hit = termWords.some(function(w) { return qWords.indexOf(w) !== -1; });
      if (hit) closetBoost[c.drawerId] = (closetBoost[c.drawerId] || 0) + 0.5;
    });
    if (Object.keys(closetBoost).length > 0) {
      ranked.forEach(function(r) { r.score += (closetBoost[r.id] || 0); });
      ranked.sort(function(a, b) { return b.score - a.score; });
    }
  } catch (e) { /* non-fatal */ }

  var topIds = ranked.slice(0, limit).map(function(r) { return r.id; });
  _bumpScores(drawersFile, topIds);

  var drawerMap = {};
  drawers.forEach(function(d) { drawerMap[d.id] = d; });
  return topIds.map(function(id) { return drawerMap[id]; }).filter(Boolean);
}

// ── recall (L2 on-demand) ─────────────────────────────────────────────────────
/**
 * recall(cwd, { wing, room, limit }) → drawer[]
 * Returns drawers matching the namespace, sorted by score desc.
 * Bumps score on returned drawers.
 */
function recall(cwd, opts) {
  opts = opts || {};
  var limit       = opts.limit || 10;
  var drawersFile = path.join(palaceDir(cwd), 'drawers.jsonl');
  var drawers     = readJsonl(drawersFile);
  if (opts.wing) drawers = drawers.filter(function(d) { return d.wing === opts.wing; });
  if (opts.room) drawers = drawers.filter(function(d) { return d.room === opts.room; });
  var top = drawers
    .sort(function(a, b) { return (b.score || 0) - (a.score || 0); })
    .slice(0, limit);
  _bumpScores(drawersFile, top.map(function(d) { return d.id; }));
  return top;
}

// ── knowledge graph ───────────────────────────────────────────────────────────
/**
 * kgAdd(cwd, subject, predicate, object, validFrom, confidence, sourceId)
 * Appends a temporal triple. validFrom defaults to now; valid_to = null (open).
 */
function kgAdd(cwd, subject, predicate, object, validFrom, confidence, sourceId) {
  var pDir = palaceDir(cwd);
  ensureDir(pDir);
  var kgFile = path.join(pDir, 'kg.json');
  var kg     = readJson(kgFile, []);
  kg.push({
    id:         uid(),
    subject:    String(subject),
    predicate:  String(predicate),
    object:     String(object),
    valid_from: validFrom || new Date().toISOString(),
    valid_to:   null,
    confidence: typeof confidence === 'number' ? confidence : 1.0,
    source_id:  sourceId || null,
    created_at: new Date().toISOString(),
  });
  writeJson(kgFile, kg);
}

/**
 * kgQuery(cwd, entity, asOf) → triple[]
 * Triples where subject = entity, valid at the given time (defaults to now).
 */
function kgQuery(cwd, entity, asOf) {
  var kgFile = path.join(palaceDir(cwd), 'kg.json');
  var kg     = readJson(kgFile, []);
  var t      = asOf ? new Date(asOf).getTime() : Date.now();
  return kg.filter(function(triple) {
    if (triple.subject !== entity) return false;
    var from = triple.valid_from ? new Date(triple.valid_from).getTime() : 0;
    var to   = triple.valid_to   ? new Date(triple.valid_to).getTime()   : Infinity;
    return t >= from && t <= to;
  });
}

/**
 * kgTimeline(cwd, entity) → triple[] (chronological)
 * Full history of facts about entity, sorted by valid_from.
 */
function kgTimeline(cwd, entity) {
  var kgFile = path.join(palaceDir(cwd), 'kg.json');
  var kg     = readJson(kgFile, []);
  return kg
    .filter(function(t) { return t.subject === entity; })
    .sort(function(a, b) {
      return new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime();
    });
}

// ── wakeUp (L0 + L1 injection) ───────────────────────────────────────────────
/**
 * wakeUp(cwd) → string
 * Loads L0 identity context + generates L1 essential story from top-scored
 * recent drawers. Returns a string for console.log injection into session.
 */
function wakeUp(cwd) {
  var pDir  = palaceDir(cwd);
  var lines = [];

  // L0 — identity.md (user-maintained, static)
  var identityFile = path.join(pDir, 'identity.md');
  if (fs.existsSync(identityFile)) {
    try {
      var identity = fs.readFileSync(identityFile, 'utf-8').trim();
      if (identity) {
        lines.push('[MEMORY_PALACE_L0] Identity:');
        lines.push(identity);
      }
    } catch (e) { /* non-fatal */ }
  }

  // L1 — essential story: top-scored drawers from last L1_DAYS days
  var drawersFile = path.join(pDir, 'drawers.jsonl');
  if (fs.existsSync(drawersFile)) {
    try {
      var drawers = readJsonl(drawersFile);
      var cutoff  = Date.now() - L1_DAYS * 24 * 60 * 60 * 1000;
      var recent  = drawers.filter(function(d) {
        return d.ts && new Date(d.ts).getTime() > cutoff;
      });
      var top = recent
        .sort(function(a, b) { return (b.score || 0) - (a.score || 0); })
        .slice(0, L1_LIMIT);

      if (top.length > 0) {
        lines.push('[MEMORY_PALACE_L1] Essential story (' + top.length + ' drawer' + (top.length !== 1 ? 's' : '') + '):');
        top.forEach(function(d) {
          var ns      = d.wing + '/' + d.room + (d.hall ? '/' + d.hall : '');
          var dateStr = d.ts ? d.ts.slice(0, 10) : '?';
          var snippet = d.content.slice(0, 300).replace(/\n/g, ' ');
          lines.push('[' + ns + ' ' + dateStr + '] ' + snippet);
        });
      }
    } catch (e) { /* non-fatal */ }
  }

  return lines.join('\n');
}

// ── exports ───────────────────────────────────────────────────────────────────
module.exports = {
  wakeUp,
  storeVerbatim,
  buildClosets,
  search,
  recall,
  bm25,
  kgAdd,
  kgQuery,
  kgTimeline,
};

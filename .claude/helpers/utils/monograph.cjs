'use strict';
// Extracted from hook-handler.cjs — monograph graph helpers.
// All functions are stateless except for the module-level DB cache.

const path = require('path');
const fs = require('fs');

const { _getRecentEdits } = require('./telemetry.cjs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function _requireMonograph() {
  var candidates = [
    path.join(CWD, 'node_modules/.pnpm/node_modules/@monoes/monograph'),
    path.join(CWD, 'packages/node_modules/.pnpm/node_modules/@monoes/monograph'),
    path.join(CWD, 'node_modules/@monoes/monograph'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    try { if (fs.existsSync(candidates[i])) return require(candidates[i]); } catch(e) {}
  }
  try { return require('@monoes/monograph'); } catch(e) {}
  return null;
}

// Memoized at module scope — opening monograph.db can take 7-10s.
// Callers MUST NOT close the returned handle.
var _cachedMonographDb = undefined;
function _openMonographDb() {
  if (_cachedMonographDb !== undefined) return _cachedMonographDb;
  try {
    var dbPath = path.join(CWD, '.monomind', 'monograph.db');
    if (!fs.existsSync(dbPath)) { _cachedMonographDb = null; return null; }
    var mod = _requireMonograph();
    if (!mod || !mod.openDb) { _cachedMonographDb = null; return null; }
    _cachedMonographDb = mod.openDb(dbPath);
    return _cachedMonographDb;
  } catch (e) { _cachedMonographDb = null; return null; }
}

function getMonographSuggestions(taskText, limit) {
  if (!taskText || typeof taskText !== 'string') return [];
  var db = _openMonographDb();
  if (!db) return [];
  try {
    var words = String(taskText).toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [];
    var stop = { 'this':1,'that':1,'with':1,'from':1,'have':1,'into':1,'their':1,'what':1,'when':1,'where':1,'which':1,'should':1,'would':1,'could':1,'make':1,'just':1,'also':1,'them':1,'they':1,'will':1,'been':1,'were':1,'because':1,'about':1,'does':1,'work':1,'else':1,'more':1,'some':1,'like':1,'need':1,'want':1,'used':1,'using':1,'please':1,'thanks':1,'good':1,'great':1,'nice':1,'thing':1,'things':1,'better':1,'again':1,'first':1,'then':1,'only':1,'even':1 };
    var uniq = {};
    for (var i = 0; i < words.length; i++) if (!stop[words[i]]) uniq[words[i]] = 1;
    var keys = Object.keys(uniq).slice(0, 8);
    var isSymbolLookup = taskText.length <= 30 && /^[a-zA-Z0-9_\-./:]+$/.test(taskText.trim());
    if (keys.length === 0) return [];
    if (keys.length < 2 && !isSymbolLookup) return [];

    var ftsQuery = keys.map(function(k){ return '"' + k.replace(/"/g, '') + '"'; }).join(' OR ');
    var lim = Math.max(1, limit || 5);
    var rows = [];
    try {
      rows = db.prepare(
        'SELECT n.id, n.name, n.label, n.file_path AS file, ' +
        'bm25(nodes_fts) AS bm25_score, ' +
        '(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg, ' +
        'CASE n.label WHEN \'File\' THEN 3 WHEN \'Function\' THEN 3 WHEN \'Class\' THEN 3 ' +
        '             WHEN \'Method\' THEN 2 WHEN \'Interface\' THEN 2 ELSE 1 END AS label_rank ' +
        'FROM nodes_fts f JOIN nodes n ON f.rowid = n.rowid ' +
        'WHERE nodes_fts MATCH ? AND n.file_path IS NOT NULL AND n.file_path != \'\' ' +
        'AND n.label NOT IN (\'Concept\') ' +
        'AND n.name NOT LIKE \'(%\' AND n.name NOT LIKE \'%=>%\' AND n.name != \'function\' ' +
        'AND length(n.name) >= 3 ' +
        'ORDER BY label_rank DESC, bm25_score ASC, deg DESC LIMIT ?'
      ).all(ftsQuery, lim);
    } catch (e) {
      var likeFrag = keys.map(function(){ return 'lower(n.name) LIKE ?'; }).join(' OR ');
      var likeArgs = keys.map(function(k){ return '%' + k + '%'; });
      var stmt = db.prepare(
        'SELECT n.id, n.name, n.label, n.file_path AS file, ' +
        '(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg ' +
        'FROM nodes n WHERE (' + likeFrag + ') AND n.file_path IS NOT NULL AND n.file_path != \'\' ' +
        'AND n.label NOT IN (\'Concept\') ' +
        'ORDER BY deg DESC LIMIT ?'
      );
      rows = stmt.all.apply(stmt, likeArgs.concat([lim]));
    }
    return rows || [];
  } catch (e) { return []; }
  finally { /* db is shared/cached; do not close */ }
}

function getMonographNeighbors(filePath) {
  if (!filePath) return null;
  var db = _openMonographDb();
  if (!db) return null;
  try {
    var rel = filePath;
    if (filePath.indexOf(CWD) === 0) rel = filePath.slice(CWD.length + 1);
    var node = db.prepare(
      'SELECT id, name FROM nodes WHERE label=\'File\' AND (file_path=? OR file_path=? OR name=? OR name=?) LIMIT 1'
    ).get(filePath, rel, filePath, rel);
    if (!node) return null;

    var imports = db.prepare(
      'SELECT DISTINCT n.name FROM edges e JOIN nodes n ON e.target_id = n.id ' +
      'WHERE e.source_id=? AND e.relation IN (\'IMPORTS\',\'CALLS\',\'DEPENDS_ON\',\'CONTAINS\',\'DEFINES\') ' +
      'AND n.file_path IS NOT NULL AND n.file_path != \'\' LIMIT 6'
    ).all(node.id).map(function(r){ return r.name; });
    var importedBy = db.prepare(
      'SELECT DISTINCT n.name FROM edges e JOIN nodes n ON e.source_id = n.id ' +
      'WHERE e.target_id=? AND e.relation IN (\'IMPORTS\',\'CALLS\',\'DEPENDS_ON\',\'CONTAINS\',\'DEFINES\') ' +
      'AND n.file_path IS NOT NULL AND n.file_path != \'\' LIMIT 6'
    ).all(node.id).map(function(r){ return r.name; });

    return { imports: imports, importedBy: importedBy };
  } catch (e) { return null; }
  finally { /* db is shared/cached; do not close */ }
}

var _TOKEN_PER_EVENT = {
  monograph_call:  300,
  grep_call:      2000,
  glob_call:       800,
  bash_grep_call: 2000,
  bash_find_call:  800,
};
var _DOLLAR_PER_1M_TOKENS = 3.0;

function _recordGraphTelemetry(event) {
  try {
    var metricsDir = path.join(CWD, '.monomind', 'metrics');
    var f = path.join(metricsDir, 'graph-usage.json');
    fs.mkdirSync(metricsDir, { recursive: true });
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) {}
    if (typeof d !== 'object' || d === null) d = {};
    d[event] = (d[event] || 0) + 1;
    if (event === 'monograph_call') {
      var saved = (_TOKEN_PER_EVENT.grep_call - _TOKEN_PER_EVENT.monograph_call);
      d.tokens_saved = (d.tokens_saved || 0) + saved;
      d.dollars_saved = ((d.tokens_saved / 1000000) * _DOLLAR_PER_1M_TOKENS);
    }
    if (event === 'grep_call' || event === 'bash_grep_call') {
      var wasted = (_TOKEN_PER_EVENT.grep_call - _TOKEN_PER_EVENT.monograph_call);
      d.tokens_wasted = (d.tokens_wasted || 0) + wasted;
    }
    d.lastUpdated = Date.now();
    fs.writeFileSync(f, JSON.stringify(d));
  } catch (e) { /* non-fatal */ }
}

function _injectCompactGraphMap() {
  try {
    var db = _openMonographDb();
    if (!db) return;
    try {
      var nodeC = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
      var anchors = [];
      var seenPaths = {};

      var recentEdits = _getRecentEdits();
      for (var ri = 0; ri < Math.min(recentEdits.length, 5); ri++) {
        var rfile = recentEdits[ri].file;
        var rrel = (rfile.indexOf(CWD) === 0) ? rfile.slice(CWD.length + 1) : rfile;
        try {
          var rnode = db.prepare(
            'SELECT n.name, n.label, n.file_path, ' +
            '(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg ' +
            'FROM nodes n WHERE n.label=\'File\' AND (n.file_path=? OR n.file_path=?) LIMIT 1'
          ).get(rfile, rrel);
          if (rnode && !seenPaths[rnode.file_path]) {
            seenPaths[rnode.file_path] = 1;
            anchors.push({ name: rnode.name, label: rnode.label, file_path: rnode.file_path, deg: rnode.deg, tag: '✎' });
          }
        } catch (e) { /* ignore */ }
      }

      if (anchors.length < 8) {
        var gods = db.prepare(
          'SELECT n.name, n.label, n.file_path, ' +
          '(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg ' +
          'FROM nodes n ' +
          'WHERE n.label NOT IN (\'Concept\') AND n.file_path IS NOT NULL AND n.file_path != \'\' ' +
          'AND n.file_path NOT LIKE \'%/node_modules/%\' AND n.file_path NOT LIKE \'%node_modules%\' ' +
          'AND n.name NOT LIKE \'(%\' AND n.name NOT LIKE \'%=>%\' AND length(n.name) >= 3 ' +
          'ORDER BY deg DESC LIMIT 15'
        ).all();
        for (var gi = 0; gi < gods.length && anchors.length < 8; gi++) {
          if (!seenPaths[gods[gi].file_path]) {
            seenPaths[gods[gi].file_path] = 1;
            anchors.push({ name: gods[gi].name, label: gods[gi].label, file_path: gods[gi].file_path, deg: gods[gi].deg, tag: '' });
          }
        }
      }

      if (anchors.length > 0) {
        console.log('[COMPACT_GRAPH] ' + nodeC + ' nodes. Session context (✎ = recently edited):');
        for (var ci = 0; ci < anchors.length; ci++) {
          var g = anchors[ci];
          console.log('  ' + (g.tag || ' ') + ' ' + g.name + ' [' + g.label + '] — ' + g.file_path + ' (deg ' + g.deg + ')');
        }
        console.log('  Use mcp__monomind__monograph_suggest first when navigating.');
      }
    } finally { /* db is shared/cached; do not close */ }
  } catch (e) {}
}

function _findAffectedTests(filePath) {
  if (!filePath) return [];
  var db = _openMonographDb();
  if (!db) return [];
  try {
    var rel = filePath;
    if (filePath.indexOf(CWD) === 0) rel = filePath.slice(CWD.length + 1);
    var rows = db.prepare(
      'SELECT DISTINCT src.file_path FROM edges e ' +
      'JOIN nodes src ON e.source_id = src.id ' +
      'JOIN nodes tgt ON e.target_id = tgt.id ' +
      'WHERE e.relation IN (\'IMPORTS\',\'CALLS\',\'DEPENDS_ON\') ' +
      'AND (tgt.file_path = ? OR tgt.file_path = ?) ' +
      'AND src.file_path IS NOT NULL AND src.file_path != \'\' ' +
      'AND (src.file_path LIKE \'%test%\' OR src.file_path LIKE \'%.spec.%\' OR src.file_path LIKE \'%__tests__%\') ' +
      'AND src.file_path NOT LIKE \'%.worktrees%\' ' +
      'LIMIT 5'
    ).all(filePath, rel);
    return rows.map(function(r) { return r.file_path; });
  } catch (e) { return []; }
  finally { /* db is shared/cached; do not close */ }
}

function _maybeRebuildMonograph() {
  try {
    var metricsDir = path.join(CWD, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    var f = path.join(metricsDir, 'graph-rebuild.json');
    var d = {};
    try { d = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (_) {}
    if (typeof d !== 'object' || d === null) d = {};
    d.writesSinceRebuild = (d.writesSinceRebuild || 0) + 1;
    d.lastWriteAt = Date.now();
    var THRESHOLD = 20;
    var MIN_INTERVAL_MS = 5 * 60 * 1000;
    var dueByCount = d.writesSinceRebuild >= THRESHOLD;
    var dueByTime  = !d.lastRebuildAt || (Date.now() - d.lastRebuildAt) > MIN_INTERVAL_MS;
    if (dueByCount && dueByTime) {
      d.writesSinceRebuild = 0;
      d.lastRebuildAt = Date.now();
      fs.writeFileSync(f, JSON.stringify(d));
      try {
        var freshenScript = path.join(CWD, '.claude', 'helpers', 'graphify-freshen.cjs');
        if (fs.existsSync(freshenScript)) {
          var spawn = require('child_process').spawn;
          var child = spawn(process.execPath, [freshenScript], {
            detached: true,
            stdio: 'ignore',
            cwd: CWD,
          });
          child.unref();
        }
      } catch (_) {}
    } else {
      fs.writeFileSync(f, JSON.stringify(d));
    }
  } catch (e) { /* non-fatal */ }
}

// Inject god-node context at session-restore time: logs MONOGRAPH_CONTEXT,
// writes the god-node chunk into knowledge/chunks.jsonl for semantic recall.
// Shared between session-restore-handler and any other caller that needs it.
function injectGodNodesContext(CWD) {
  try {
    var mgDbPath = path.join(CWD, '.monomind', 'monograph.db');
    if (!fs.existsSync(mgDbPath)) return;
    var db = _openMonographDb();
    if (!db) return;
    try {
      var nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
      var edgeCount = db.prepare('SELECT COUNT(*) AS c FROM edges').get().c;
      var godNodes = db.prepare(
        "SELECT n.name, n.label, n.file_path, " +
        "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg " +
        "FROM nodes n " +
        "WHERE n.label NOT IN ('Concept') " +
        "AND n.file_path IS NOT NULL AND n.file_path != '' " +
        "AND n.file_path NOT LIKE '%/node_modules/%' AND n.file_path NOT LIKE '%node_modules%' " +
        "ORDER BY deg DESC LIMIT 12"
      ).all();

      // Staleness indicator: compare stored commit hash with current HEAD.
      var staleIndicator = '';
      try {
        var lastCommitRow = null;
        try { lastCommitRow = db.prepare("SELECT value FROM index_meta WHERE key='ua_last_commit'").get(); } catch (_) {}
        if (lastCommitRow && lastCommitRow.value) {
          var { execFileSync: execSync } = require('child_process');
          var currentHead = '';
          try { currentHead = execSync('git', ['rev-parse', 'HEAD'], { cwd: CWD, encoding: 'utf-8' }).trim(); } catch (_) {}
          if (currentHead && currentHead !== lastCommitRow.value) {
            var commitsBehind = 0;
            try {
              var revList = execSync('git', ['rev-list', '--count', lastCommitRow.value + '..' + currentHead], { cwd: CWD, encoding: 'utf-8' }).trim();
              commitsBehind = parseInt(revList, 10) || 0;
            } catch (_) {}
            if (commitsBehind > 0) {
              staleIndicator = ' [⚡ graph ' + commitsBehind + ' commit' + (commitsBehind === 1 ? '' : 's') + ' behind — run: npx monomind monograph build]';
            }
          }
        }
      } catch (_) {}

      if (godNodes.length > 0) {
        var godStr = godNodes.slice(0, 8).map(function(n) {
          return n.name + ' (' + n.label + ', ' + n.deg + ' links)';
        }).join(', ');
        console.log('[MONOGRAPH_CONTEXT] ' + nodeCount + ' nodes · ' + edgeCount + ' edges. Key nodes: ' + godStr + staleIndicator);

        // Write god nodes into knowledge/chunks.jsonl so semantic search finds them.
        var knowledgeDir = path.join(CWD, '.monomind', 'knowledge');
        var chunksFile = path.join(knowledgeDir, 'chunks.jsonl');
        try {
          fs.mkdirSync(knowledgeDir, { recursive: true });
          var godChunk = JSON.stringify({
            id: 'monograph-god-nodes',
            text: 'Codebase architecture — high-centrality nodes (most depended-on): ' + godNodes.map(function(n) {
              return n.name + ' [' + n.label + '] at ' + (n.file_path || '') + ' (' + n.deg + ' connections)';
            }).join('; '),
            namespace: 'knowledge:monograph',
            metadata: { label: 'monograph-god-nodes', nodes: nodeCount, edges: edgeCount }
          });
          var existing = [];
          try { existing = fs.readFileSync(chunksFile, 'utf-8').trim().split('\n').filter(Boolean); } catch(e) {}
          existing = existing.filter(function(line) {
            try { return JSON.parse(line).id !== 'monograph-god-nodes'; } catch(e) { return true; }
          });
          existing.push(godChunk);
          fs.writeFileSync(chunksFile, existing.join('\n') + '\n');
        } catch(e) {}
      }
    } catch(e) { /* non-fatal */ }
  } catch(e) { /* non-fatal */ }
}

module.exports = {
  _requireMonograph,
  _openMonographDb,
  getMonographSuggestions,
  getMonographNeighbors,
  _recordGraphTelemetry,
  _injectCompactGraphMap,
  _findAffectedTests,
  _maybeRebuildMonograph,
  injectGodNodesContext,
};

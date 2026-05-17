'use strict';
// Extracted from hook-handler.cjs — micro-agent trigger scanner and knowledge base helpers.

const path = require('path');
const fs = require('fs');

const { _openMonographDb } = require('./monograph.cjs');

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function safeRequire(modulePath) {
  try {
    if (fs.existsSync(modulePath)) {
      const origLog = console.log;
      const origError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        const mod = require(modulePath);
        return mod;
      } finally {
        console.log = origLog;
        console.error = origError;
      }
    }
  } catch (e) { /* silently fail */ }
  return null;
}

// ── MicroAgent Trigger Scanner ────────────────────────────────────────────────

function _triggerExtractYamlValue(raw) {
  var v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1).replace(/\\\\/g, '\\');
  } else if (v.startsWith("'") && v.endsWith("'")) {
    v = v.slice(1, -1);
  }
  return v;
}

function _triggerFinalize(partial, agentSlug) {
  return { pattern: partial.pattern, mode: partial.mode || 'inject', priority: partial.priority || 0, agentSlug: agentSlug };
}

function _triggerExtractFromFrontmatter(content, agentSlug) {
  var fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return [];
  var block = fmMatch[1];
  var triggers = [];
  var lines = block.split('\n');
  var inTriggers = false;
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    var indent = line.length - line.trimStart().length;
    if (trimmed === 'triggers:' || trimmed.startsWith('triggers:')) { inTriggers = true; continue; }
    if (inTriggers && indent === 0 && /^[a-zA-Z]/.test(trimmed)) {
      inTriggers = false;
      if (cur && cur.pattern) triggers.push(_triggerFinalize(cur, agentSlug));
      cur = null; continue;
    }
    if (!inTriggers) continue;
    if (trimmed.startsWith('- pattern:')) {
      if (cur && cur.pattern) triggers.push(_triggerFinalize(cur, agentSlug));
      cur = { pattern: _triggerExtractYamlValue(trimmed.replace(/^- pattern:\s*/, '')), agentSlug: agentSlug };
    } else if (cur && trimmed.startsWith('mode:')) {
      var mv = _triggerExtractYamlValue(trimmed.replace(/^mode:\s*/, ''));
      if (mv === 'inject' || mv === 'takeover') cur.mode = mv;
    } else if (cur && trimmed.startsWith('priority:')) {
      var pv = parseInt(trimmed.replace(/^priority:\s*/, ''), 10);
      if (!isNaN(pv)) cur.priority = pv;
    }
  }
  if (cur && cur.pattern) triggers.push(_triggerFinalize(cur, agentSlug));
  return triggers;
}

function _triggerCollectMdFiles(dir) {
  var results = [];
  try {
    var entries = fs.readdirSync(dir);
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(dir, entries[i]);
      try {
        var st = fs.lstatSync(full);
        if (st.isDirectory()) results = results.concat(_triggerCollectMdFiles(full));
        else if (entries[i].endsWith('.md')) results.push(full);
      } catch (e) {}
    }
  } catch (e) {}
  return results;
}

function _triggerBuildIndex(agentDir) {
  var patterns = [];
  var files = _triggerCollectMdFiles(agentDir);
  for (var i = 0; i < files.length; i++) {
    var content;
    try { content = fs.readFileSync(files[i], 'utf-8'); } catch (e) { continue; }
    var slug = files[i].split('/').pop().replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    patterns = patterns.concat(_triggerExtractFromFrontmatter(content, slug));
  }
  return patterns;
}

function scanMicroAgentTriggers(prompt) {
  if (!prompt || typeof prompt !== 'string') return { matches: [], injectAgents: [] };
  var indexPath = path.join(CWD, '.monomind', 'trigger-index.json');
  var agentDir = path.join(CWD, '.claude', 'agents');
  var patterns = [];
  var cacheLoaded = false;

  try {
    if (fs.existsSync(indexPath)) {
      var idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      var age = Date.now() - new Date(idx.builtAt || 0).getTime();
      if (age < 3600000 && Array.isArray(idx.patterns)) {
        patterns = idx.patterns;
        cacheLoaded = true;
      }
    }
  } catch (e) {}

  if (!cacheLoaded) {
    patterns = _triggerBuildIndex(agentDir);
    try {
      fs.mkdirSync(path.join(CWD, '.monomind'), { recursive: true });
      fs.writeFileSync(indexPath, JSON.stringify({ patterns: patterns, builtAt: new Date().toISOString(), totalAgentsScanned: patterns.length }));
    } catch (e) {}
  }

  patterns.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });

  var matches = [];
  var seen = {};
  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i];
    if (p.mode !== 'inject' && p.mode !== 'takeover') continue;
    if (seen[p.agentSlug]) continue;
    try {
      var re = new RegExp(p.pattern, 'i');
      var m = re.exec(prompt);
      if (m) {
        seen[p.agentSlug] = true;
        matches.push({ agentSlug: p.agentSlug, mode: p.mode, matchedText: m[0] });
        if (p.mode === 'takeover') {
          return { matches: matches, takeoverAgent: p.agentSlug, injectAgents: [] };
        }
      }
    } catch (e) {}
  }
  return { matches: matches, injectAgents: matches.map(function(m) { return m.agentSlug; }) };
}

// ── Knowledge Base ────────────────────────────────────────────────────────────

var _KNOWLEDGE_STOPWORDS = new Set(['the','and','or','but','if','in','on','to','is','it','be','do','of','for','not','at','by','as','we','us','an','a','i']);

function _buildKnowledgeSearchFn(knowledgeDir) {
  return async function(query, opts) {
    var chunksFile = path.join(knowledgeDir, 'chunks.jsonl');
    if (!fs.existsSync(chunksFile)) return [];
    var lines;
    try {
      lines = fs.readFileSync(chunksFile, 'utf-8').trim().split('\n').filter(Boolean);
    } catch (e) { return []; }

    var ns = (opts && opts.namespace) || null;
    var limit = (opts && opts.limit) || 10;
    var minScore = (opts && opts.minScore != null) ? opts.minScore : 0.3;
    var queryTerms = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length >= 2 && !_KNOWLEDGE_STOPWORDS.has(t); });
    if (queryTerms.length === 0) return [];

    var results = [];
    for (var i = 0; i < lines.length; i++) {
      try {
        var chunk = JSON.parse(lines[i]);
        if (ns && chunk.namespace !== ns) continue;
        var textLower = (chunk.text || '').toLowerCase();
        var matchCount = queryTerms.filter(function(t) { return textLower.includes(t); }).length;
        var score = matchCount / queryTerms.length;
        if (score >= minScore) {
          results.push({ key: chunk.chunkId, value: chunk.text, score: score, metadata: chunk.metadata || {} });
        }
      } catch (e) {}
    }
    results.sort(function(a, b) { return b.score - a.score; });
    return results.slice(0, limit);
  };
}

function _autoIndexKnowledge(knowledgeDir) {
  var crypto = require('crypto');
  var sources = [
    { filePath: path.join(CWD, 'CLAUDE.md'), label: 'project-instructions' },
    { filePath: path.join(CWD, 'docs/todo.md'), label: 'project-todo' },
    { filePath: path.join(CWD, 'CLAUDE.local.md'), label: 'local-instructions' },
  ];

  var hashInput = '';
  for (var i = 0; i < sources.length; i++) {
    try {
      if (fs.existsSync(sources[i].filePath)) {
        var st = fs.statSync(sources[i].filePath);
        hashInput += sources[i].filePath + ':' + st.size + ':' + st.mtimeMs + ';';
      }
    } catch (e) {}
  }
  try {
    var statsForHash = JSON.parse(fs.readFileSync(path.join(CWD, '.monomind', 'graph', 'stats.json'), 'utf-8'));
    hashInput += 'monograph:' + (statsForHash.builtAt || 0) + ';';
  } catch(e) {}

  var contentHash = crypto.createHash('md5').update(hashInput).digest('hex');
  var chunksFile = path.join(knowledgeDir, 'chunks.jsonl');
  var hashFile = path.join(knowledgeDir, '.index-hash');
  var existingHash = '';
  try { existingHash = fs.readFileSync(hashFile, 'utf-8').trim(); } catch (e) {}

  var existingChunkCount = 0;
  try { if (fs.existsSync(chunksFile)) { existingChunkCount = fs.readFileSync(chunksFile, 'utf-8').trim().split('\n').filter(Boolean).length; } } catch (e) {}
  if (existingHash === contentHash && existingChunkCount > 0) return 0;

  var newLines = [];
  for (var si = 0; si < sources.length; si++) {
    var src = sources[si];
    try {
      if (!fs.existsSync(src.filePath)) continue;
      var content = fs.readFileSync(src.filePath, 'utf-8');
      var sections = content.split(/\n{2,}|\n(?=#{1,3} )/);
      for (var ci = 0; ci < sections.length; ci++) {
        var text = sections[ci].trim();
        if (text.length < 40 || text.length > 3000) continue;
        var chunkId = crypto.createHash('md5').update(src.filePath + ':' + ci).digest('hex').slice(0, 16);
        newLines.push(JSON.stringify({
          chunkId: chunkId,
          namespace: 'knowledge:shared',
          text: text,
          metadata: { filePath: src.filePath, label: src.label, chunkIndex: ci }
        }));
      }
    } catch (e) {}
  }

  // Inject monograph graph summary as a knowledge chunk (reads from monograph.db).
  try {
    var mgDbPath = path.join(CWD, '.monomind', 'monograph.db');
    var legacyStats = path.join(CWD, '.monomind', 'graph', 'stats.json');
    var legacyGraph = path.join(CWD, '.monomind', 'graph', 'graph.json');

    var summaryText = null;
    var summaryMeta = {};

    if (fs.existsSync(mgDbPath)) {
      try {
        var sumDb = _openMonographDb();
        if (sumDb) {
          try {
            var nodeC = sumDb.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
            var edgeC = sumDb.prepare('SELECT COUNT(*) AS c FROM edges').get().c;
            var topNodes = sumDb.prepare(
              'SELECT n.name, n.label, n.file_path, ' +
              '(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg ' +
              'FROM nodes n WHERE n.file_path IS NOT NULL AND n.file_path != "" ORDER BY deg DESC LIMIT 15'
            ).all();
            var typeRows = sumDb.prepare(
              'SELECT label, COUNT(*) AS c FROM nodes GROUP BY label ORDER BY c DESC LIMIT 8'
            ).all();
            var typeStr = typeRows.map(function(r) { return r.label + ':' + r.c; }).join(', ');
            summaryText = [
              'MONOGRAPH KNOWLEDGE GRAPH SUMMARY',
              'Source: monograph.db | Nodes: ' + nodeC + ' | Edges: ' + edgeC,
              '',
              'TOP GOD NODES (highest connectivity — start exploration here):',
              topNodes.map(function(n) {
                return '  ' + n.name + ' [' + n.label + '] — ' + (n.file_path || '') + ' (degree: ' + n.deg + ')';
              }).join('\n'),
              '',
              'NODE TYPE DISTRIBUTION: ' + typeStr,
              '',
              'Before grepping or globbing, prefer:',
              '  mcp__monomind__monograph_suggest({ task: "<your task>" }) — ranked relevant files',
              '  mcp__monomind__monograph_query({ q: "<symbol|keyword>" }) — BM25 search with file:line',
              '  mcp__monomind__monograph_impact({ name: "<file>" }) — upstream + downstream blast radius',
            ].join('\n');
            summaryMeta = { label: 'monograph-graph-summary', source: 'monograph.db', nodes: nodeC, edges: edgeC };
          } catch (e) { /* keep summaryText if partial */ }
        }
      } catch (e) { /* fall through to legacy */ }
    }

    if (!summaryText && fs.existsSync(legacyStats) && fs.existsSync(legacyGraph)) {
      try {
        var lStats = JSON.parse(fs.readFileSync(legacyStats, 'utf-8'));
        var lGraphStat = fs.statSync(legacyGraph);
        if (lGraphStat.size < 10 * 1024 * 1024) {
          var lGraph = JSON.parse(fs.readFileSync(legacyGraph, 'utf-8'));
          var lNodes = Array.isArray(lGraph.nodes) ? lGraph.nodes : [];
          summaryText = 'MONOGRAPH KNOWLEDGE GRAPH SUMMARY (legacy JSON)\n' +
            'Nodes: ' + (lStats.nodes || lNodes.length) + ' | Edges: ' + (lStats.edges || 0) + '\n' +
            'Use mcp__monomind__monograph_suggest to find files relevant to your task.';
          summaryMeta = { label: 'monograph-graph-summary', source: 'legacy-json', builtAt: lStats.builtAt };
        }
      } catch (e) { /* ignore */ }
    }

    if (summaryText) {
      var chunkId2 = crypto.createHash('md5').update('monograph-graph-summary').digest('hex').slice(0, 16);
      newLines.push(JSON.stringify({
        chunkId: chunkId2,
        namespace: 'knowledge:shared',
        text: summaryText,
        metadata: summaryMeta
      }));
    }
  } catch (e) { /* graph not available yet */ }

  try {
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(chunksFile, newLines.length > 0 ? newLines.join('\n') + '\n' : '', 'utf-8');
    fs.writeFileSync(hashFile, contentHash, 'utf-8');
  } catch (e) {}
  return newLines.length;
}

module.exports = {
  safeRequire,
  _triggerExtractYamlValue,
  _triggerFinalize,
  _triggerExtractFromFrontmatter,
  _triggerCollectMdFiles,
  _triggerBuildIndex,
  scanMicroAgentTriggers,
  _buildKnowledgeSearchFn,
  _autoIndexKnowledge,
};

#!/usr/bin/env node
/**
 * Monomind Hook Handler (Cross-Platform)
 * Dispatches hook events to the appropriate helper modules.
 */

const path = require('path');
const fs = require('fs');

const helpersDir = __dirname;
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
  } catch (e) {
    // silently fail
  }
  return null;
}

const router = safeRequire(path.join(helpersDir, 'router.cjs'));
const session = safeRequire(path.join(helpersDir, 'session.cjs'));
const memory = safeRequire(path.join(helpersDir, 'memory.cjs'));
const intelligence = safeRequire(path.join(helpersDir, 'intelligence.cjs'));

// Module-level reference to @monomind/hooks — populated at session-restore,
// then used by pre-task / post-task to bridge into the hook registry (Tasks 26, 39).
let _hooksModule = null;

// ── MicroAgent Trigger Scanner (Task 32) ────────────────────────────────────
function _triggerExtractYamlValue(raw) {
  var v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    // YAML double-quoted: unescape \\ → \ so regex patterns like "\\b" become \b (word boundary)
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

  // Load cached index if fresh (< 1 hour)
  try {
    if (fs.existsSync(indexPath)) {
      var idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      var age = Date.now() - new Date(idx.builtAt || 0).getTime();
      if (age < 3600000 && Array.isArray(idx.patterns)) {
        patterns = idx.patterns;
        cacheLoaded = true;  // valid even when empty (no triggers defined)
      }
    }
  } catch (e) {}

  // Rebuild only when cache is missing or stale — not when it's a valid empty result
  if (!cacheLoaded) {
    patterns = _triggerBuildIndex(agentDir);
    try {
      fs.mkdirSync(path.join(CWD, '.monomind'), { recursive: true });
      fs.writeFileSync(indexPath, JSON.stringify({ patterns: patterns, builtAt: new Date().toISOString(), totalAgentsScanned: patterns.length }));
    } catch (e) {}
  }

  // Sort by descending priority
  patterns.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });

  // Apply patterns
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

// ── Task 28: Knowledge Base — inline CJS search + auto-indexer ─────────────
//
// Purpose: give KnowledgeRetriever a real search function and pre-populate
// the knowledge store with project documents (CLAUDE.md, todo.md, etc.) so
// retrieveForTask() actually returns useful context on session restore.
// No compiled deps required — reads/writes JSONL directly.

/**
 * Build a simple keyword-overlap search function over chunks.jsonl.
 * Returns results sorted by descending score; compatible with SearchFn signature.
 */
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

/**
 * Index project knowledge sources into chunks.jsonl.
 * Skips re-indexing if content hasn't changed (hash-gated).
 * Returns the number of new chunks written.
 */
function _autoIndexKnowledge(knowledgeDir) {
  var crypto = require('crypto');
  var sources = [
    { filePath: path.join(CWD, 'CLAUDE.md'), label: 'project-instructions' },
    { filePath: path.join(CWD, 'docs/todo.md'), label: 'project-todo' },
    { filePath: path.join(CWD, 'CLAUDE.local.md'), label: 'local-instructions' },
  ];

  // Compute a combined hash of all source file sizes (fast proxy for content change)
  var hashInput = '';
  for (var i = 0; i < sources.length; i++) {
    try {
      if (fs.existsSync(sources[i].filePath)) {
        var st = fs.statSync(sources[i].filePath);
        hashInput += sources[i].filePath + ':' + st.size + ':' + st.mtimeMs + ';';
      }
    } catch (e) {}
  }
  var contentHash = crypto.createHash('md5').update(hashInput).digest('hex');

  var chunksFile = path.join(knowledgeDir, 'chunks.jsonl');
  var hashFile = path.join(knowledgeDir, '.index-hash');
  var existingHash = '';
  try { existingHash = fs.readFileSync(hashFile, 'utf-8').trim(); } catch (e) {}

  // Nothing changed — skip re-index
  var existingChunkCount = 0;
  try { if (fs.existsSync(chunksFile)) { existingChunkCount = fs.readFileSync(chunksFile, 'utf-8').trim().split('\n').filter(Boolean).length; } } catch (e) {}
  if (existingHash === contentHash && existingChunkCount > 0) return 0;

  // Build new chunks
  var newLines = [];
  for (var si = 0; si < sources.length; si++) {
    var src = sources[si];
    try {
      if (!fs.existsSync(src.filePath)) continue;
      var content = fs.readFileSync(src.filePath, 'utf-8');
      // Split on blank lines or markdown headers (## / ###)
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

  try {
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(chunksFile, newLines.length > 0 ? newLines.join('\n') + '\n' : '', 'utf-8');
    fs.writeFileSync(hashFile, contentHash, 'utf-8');
  } catch (e) {}
  return newLines.length;
}

// ── Intelligence timeout protection (fixes #1530, #1531) ───────────────────
var INTELLIGENCE_TIMEOUT_MS = 1500;
function runWithTimeout(fn, label) {
  return new Promise(function(resolve) {
    var settled = false;
    var timer = setTimeout(function() {
      if (!settled) {
        settled = true;
        process.stderr.write("[WARN] " + label + " timed out after " + INTELLIGENCE_TIMEOUT_MS + "ms, skipping\n");
        resolve(null);
      }
    }, INTELLIGENCE_TIMEOUT_MS);
    Promise.resolve().then(fn).then(
      function(result) { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } },
      function()       { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } }
    );
  });
}


const [,, command, ...args] = process.argv;

// Read stdin — Claude Code sends hook data as JSON via stdin
// Uses a timeout to prevent hanging when stdin is in an ambiguous state
// (not TTY, not a proper pipe) which happens with Claude Code hook invocations.
async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    }, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
    process.stdin.resume();
  });
}

async function main() {
  // Global safety timeout: hooks must NEVER hang (#1530, #1531)
  var safetyTimer = setTimeout(function() {
    process.stderr.write("[WARN] Hook handler global timeout (5s), forcing exit\n");
    process.exit(0);
  }, 5000);
  safetyTimer.unref();

  let stdinData = '';
  try { stdinData = await readStdin(); } catch (e) { /* ignore stdin errors */ }

  let hookInput = {};
  if (stdinData.trim()) {
    try {
      const parsed = JSON.parse(stdinData);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        hookInput = parsed;
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Merge stdin data into prompt resolution: prefer stdin fields, then env vars.
  // NEVER fall back to argv args — shell glob expansion of braces in bash output
  // creates junk files (#1342). Use env vars or stdin only.
  // Normalize snake_case/camelCase: Claude Code sends tool_input/tool_name (snake_case)
  var toolInput = hookInput.toolInput || hookInput.tool_input || {};
  var toolName = hookInput.toolName || hookInput.tool_name || '';

  var prompt = hookInput.prompt || hookInput.command
    || (typeof toolInput === 'string' ? toolInput : (toolInput.command || toolInput.prompt || ''))
    || process.env.PROMPT || process.env.TOOL_INPUT_command || '';

  // Detect prompts that are predefined single-action commands that don't
  // need agent routing or skill suggestions — invoking those adds token
  // overhead without any benefit.
  function isSimpleCommand(p) {
    if (typeof p !== 'string') return false;
    var s = p.trim();
    // Slash commands: /ts, /list-agents, /commit, /help, /use-agent etc.
    if (/^\/[a-z0-9_-]+(\s|$)/i.test(s)) return true;
    // Short single-word operator tokens (toggle, list, status)
    if (/^(ts|ls|ps|pwd|help|clear|exit|quit|status|toggle|refresh)$/i.test(s)) return true;
    // Already-resolved command messages (Claude Code sends hook with command-name context)
    var cmdName = hookInput.commandName || hookInput.command_name || '';
    if (cmdName && cmdName.length > 0) return true;
    return false;
  }

const handlers = {
  'route': async () => {
    // For slash commands and single-action invocations: skip routing panel output
    // but still write last-route.json so the statusline reflects the current action.
    if (isSimpleCommand(prompt)) {
      try {
        var cmdLabel = (typeof prompt === 'string' && prompt.trim().startsWith('/'))
          ? prompt.trim().split(/\s+/)[0]          // e.g. "/ts"
          : (hookInput.commandName || hookInput.command_name || 'command');
        var routeDir = path.join(CWD, '.monomind');
        fs.mkdirSync(routeDir, { recursive: true });
        fs.writeFileSync(
          path.join(routeDir, 'last-route.json'),
          JSON.stringify({
            agent: cmdLabel,
            confidence: 1.0,
            reason: 'predefined command — no routing needed',
            semanticRouting: false,
            updatedAt: new Date().toISOString(),
          }),
          'utf-8'
        );
      } catch (e) { /* non-fatal */ }
      return;
    }

    if (intelligence && intelligence.getContext) {
      try {
        const ctx = intelligence.getContext(prompt);
        if (ctx) console.log(ctx);
      } catch (e) { /* non-fatal */ }
    }
    if (router && (router.routeTaskSemantic || router.routeTask)) {
      const routeFn = router.routeTaskSemantic || router.routeTask;
      const result = await Promise.resolve(routeFn(prompt));
      var output = [];
      output.push('[INFO] Routing task: ' + (prompt.substring(0, 80) || '(no prompt)'));
      output.push('');
      output.push('+------------- monomind | Primary Recommendation --------------+');
      output.push('| Agent: ' + (result.agent || 'unknown').substring(0, 54).padEnd(54) + '|');
      output.push('| Confidence: ' + ((result.confidence != null ? (result.confidence * 100).toFixed(1) : '?') + '%').padEnd(49) + '|');
      output.push('| Reason: ' + (result.reason || '').substring(0, 53).padEnd(53) + '|');
      output.push('+--------------------------------------------------------------+');

      // ── Persist routing result for statusline display ─────────────
      try {
        var routeDir = path.join(CWD, '.monomind');
        fs.mkdirSync(routeDir, { recursive: true });
        // Always use the resolved agent name — never persist "extras"
        var resolvedAgent = result.agent;
        if (!resolvedAgent || resolvedAgent === 'extras') {
          var topExtra = result.extrasMatches && result.extrasMatches[0];
          resolvedAgent = topExtra ? topExtra.name : 'Specialist Agent';
        }
        var routePayload = {
          agent: resolvedAgent,
          agentSlug: result.agentSlug || null,
          confidence: result.confidence,
          reason: result.reason,
          semanticRouting: result.semanticRouting || false,
          llmRouting: result.llmRouting || false,
          updatedAt: new Date().toISOString(),
        };
        if (result.extrasMatches && result.extrasMatches.length > 0) {
          routePayload.extrasMatches = result.extrasMatches.map(function(e) {
            return { name: e.name, slug: e.slug, category: e.category };
          });
        }
        fs.writeFileSync(
          path.join(routeDir, 'last-route.json'),
          JSON.stringify(routePayload),
          'utf-8'
        );
      } catch (e) { /* non-fatal */ }

      // ── Dev skill suggestions ──────────────────────────────────────
      var matches = result.skillMatches || [];
      if (matches.length > 0) {
        // Check for high-confidence auto-invoke: if top skill scored >= 3 keyword
        // hits and is the dominant match, auto-invoke instead of just suggesting
        var topMatch = matches[0];
        var autoInvoke = false;
        if (topMatch && topMatch.score >= 3 && matches.length <= 2) {
          autoInvoke = true;
        } else if (topMatch && topMatch.score >= 2 && matches.length === 1 && (result.confidence ?? 0) < 0.7) {
          // Single strong skill match with weak agent routing = skill should take over
          autoInvoke = true;
        }

        if (autoInvoke) {
          output.push('');
          output.push('+======== SKILL AUTO-ACTIVATED (high confidence match) ========+');
          output.push('| ' + topMatch.invoke.substring(0, 61).padEnd(61) + '|');
          output.push('| INSTRUCTION: Invoke ' + topMatch.invoke.substring(0, 41).padEnd(41) + '|');
          output.push('| BEFORE responding. This skill matched with very high         |');
          output.push('| confidence — do not skip it.                                 |');
          output.push('+==============================================================+');
        } else {
          output.push('');
          if ((result.confidence ?? 0) < 0.8) {
            output.push('+----------- Skill Suggestions (pick one if relevant) ---------+');
            output.push('| No strong primary match — here are the best skill candidates |');
          } else {
            output.push('+----------- Matching Skills (invoke via Skill tool) ----------+');
          }
          matches.forEach(function(m, i) {
            var label = (i + 1) + '. ' + m.skill;
            var desc = (m.description || '').substring(0, 30);
            var line = '| ' + label.substring(0, 30).padEnd(30) + desc.padEnd(30) + ' |';
            output.push(line);
            output.push('|   invoke: ' + m.invoke.substring(0, 51).padEnd(51) + '|');
          });
          output.push('+--------------------------------------------------------------+');
          if ((result.confidence ?? 0) < 0.8) {
            output.push('| To use a skill: call Skill("skill-name") before responding.  |');
            output.push('+--------------------------------------------------------------+');
          }
        }
      }

      // ── Specific agent panel ──────────────────────────────────────────────────
      var specificAgents = result.specificAgents || [];
      if (specificAgents.length > 0) {
        output.push('');
        var saHdr = '------- Specific Agents (' + specificAgents.length + ' available) ';
        output.push('+' + saHdr + '-'.repeat(Math.max(1, 62 - saHdr.length)) + '+');
        specificAgents.forEach(function(a, i) {
          var label = (i + 1) + '. ' + a.label;
          var note = (a.note || '').substring(0, 26);
          output.push('| ' + label.substring(0, 33).padEnd(33) + note.padEnd(27) + ' |');
          if (a.slug) {
            output.push('|   slug: ' + a.slug.substring(0, 52).padEnd(52) + ' |');
          }
        });
        output.push('+--------------------------------------------------------------+');
        output.push('| Use: Task({ subagent_type: "<slug>" })  or  /specialagent    |');
        output.push('+--------------------------------------------------------------+');
      }

      // ── Specialist agents (non-dev domain) — only shown when specificAgents panel wasn't shown ──
      var extras = result.extrasMatches || [];
      var specificAgentsShown = (result.specificAgents || []).length > 0;
      if (extras.length > 0 && !specificAgentsShown) {
        output.push('');
        var spHdr = '------- Specialist Agents (' + extras.length + ' matched) ';
        output.push('+' + spHdr + '-'.repeat(Math.max(1, 62 - spHdr.length)) + '+');
        extras.slice(0, 5).forEach(function(e, i) {
          var label = (i + 1) + '. ' + e.name;
          var cat = '[' + e.category + ']';
          output.push('| ' + label.substring(0, 44).padEnd(44) + cat.substring(0, 16).padEnd(16) + ' |');
          output.push('|   slug: ' + e.slug.substring(0, 52).padEnd(52) + ' |');
        });
        output.push('+--------------------------------------------------------------+');
        output.push('| Use: Task({ subagent_type: "<slug>" })  or  /specialagent    |');
        output.push('+--------------------------------------------------------------+');
      }

      // ── MicroAgent Trigger Scan (Task 32) ──────────────────────────────
      try {
        var triggerResult = scanMicroAgentTriggers(typeof prompt === 'string' ? prompt : '');
        if (triggerResult.matches.length > 0) {
          output.push('');
          if (triggerResult.takeoverAgent) {
            var tAgent = triggerResult.takeoverAgent;
            var tKw = triggerResult.matches[0].matchedText;
            output.push('+============= MicroAgent TAKEOVER Detected ===================+');
            output.push('| Specialist: ' + tAgent.substring(0, 49).padEnd(49) + '|');
            output.push('| Keyword:    ' + ('"' + tKw + '"').substring(0, 49).padEnd(49) + '|');
            output.push('| Recommended: use this specialist instead of primary agent.   |');
            output.push('+==============================================================+');
          } else {
            output.push('+------- MicroAgent Specialists Triggered ---------------------+');
            triggerResult.matches.forEach(function(m) {
              var slug = m.agentSlug.substring(0, 37).padEnd(37);
              var kw = ('(match: "' + m.matchedText + '")').substring(0, 21).padEnd(21);
              output.push('| + ' + slug + kw + ' |');
            });
            output.push('+--------------------------------------------------------------+');
          }
          // Persist trigger matches alongside route result
          try {
            var routeFile = path.join(CWD, '.monomind', 'last-route.json');
            var existing = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
            existing.microAgents = { injectAgents: triggerResult.injectAgents || [], takeoverAgent: triggerResult.takeoverAgent || null };
            fs.writeFileSync(routeFile, JSON.stringify(existing), 'utf-8');
          } catch (e) {}
        }
      } catch (e) { /* non-fatal */ }

      console.log(output.join('\n'));

      // Swarm mode selection is available on-demand via /mastermind slash command.
    } else {
      console.log('[INFO] Router not available, using default routing');
    }

    // Task 22: TeamRoutingModes — only log when an explicit swarm config is present
    try {
      var swarmCfgPath = path.join(CWD, '.monomind', 'swarm-config.json');
      if (fs.existsSync(swarmCfgPath)) {
        var topology22 = JSON.parse(fs.readFileSync(swarmCfgPath, 'utf-8')).topology || 'mesh';
        var mode22 = topology22 === 'hierarchical' ? 'route' : 'coordinate';
        console.log('[ROUTING_MODE] topology=' + topology22 + ' → mode=' + mode22);
      }
    } catch (e) { /* non-fatal */ }
  },

  'load-agent': () => {
    // Load and print full agent text so Claude can adopt its identity
    const slug = args.join(' ').trim() || (typeof prompt === 'string' ? prompt.trim() : '');
    if (!router || !router.loadExtrasAgent) {
      console.error('[ERROR] Router does not support loadExtrasAgent');
      process.exit(1);
    }
    const agent = router.loadExtrasAgent(slug);
    if (!agent) {
      console.error('[ERROR] Extras agent not found: ' + slug);
      console.error('Run: node .claude/helpers/router.cjs --load-agent <slug>  to check available slugs');
      process.exit(1);
    }
    console.log('=== AGENT ACTIVATED: ' + agent.name + ' [' + agent.category + '] ===');
    console.log('');
    console.log(agent.content);
    console.log('');
    console.log('=== END AGENT: ' + agent.name + ' ===');
    console.log('INSTRUCTION: You are now ' + agent.name + '. Adopt the identity, tone, and expertise described above for the remainder of this task.');

    // Persist active agent for statusline
    try {
      var routeDir = path.join(CWD, '.monomind');
      fs.mkdirSync(routeDir, { recursive: true });
      fs.writeFileSync(
        path.join(routeDir, 'last-route.json'),
        JSON.stringify({
          agent: agent.slug,
          name: agent.name,
          category: agent.category,
          confidence: 1.0,
          reason: 'manually activated via load-agent',
          activated: true,
          updatedAt: new Date().toISOString(),
        }),
        'utf-8'
      );
    } catch (e) { /* non-fatal */ }
  },

  'list-extras': () => {
    if (!router || !router.loadExtrasRegistry) {
      console.error('[ERROR] Extras registry not available');
      process.exit(1);
    }
    const registry = router.loadExtrasRegistry();
    const category = args[0] || '';
    const entries = category
      ? registry.extras.filter(e => e.category === category)
      : registry.extras;
    const byCategory = {};
    for (const e of entries) {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      byCategory[e.category].push(e);
    }
    for (const [cat, agents] of Object.entries(byCategory)) {
      console.log('\n[' + cat.toUpperCase() + ']');
      for (const a of agents) {
        console.log('  ' + a.slug.padEnd(45) + a.name);
      }
    }
    console.log('\nTotal: ' + entries.length + ' extras agents');
  },

  'pre-bash': () => {
    var _rawCmd = hookInput.command || prompt;
    var cmd = (typeof _rawCmd === 'string' ? _rawCmd : String(_rawCmd || '')).toLowerCase();
    var dangerous = ['rm -rf /', 'rm -rf/', 'format c:', 'del /s /q c:\\', ':(){:|:&};:'];
    for (var i = 0; i < dangerous.length; i++) {
      if (cmd.includes(dangerous[i])) {
        console.error('[BLOCKED] Dangerous command detected: ' + dangerous[i]);
        process.exit(1);
      }
    }
    console.log('[OK] Command validated');
  },

  'post-edit': () => {
    if (session && session.metric) {
      try { session.metric('edits'); } catch (e) { /* no active session */ }
    }
    if (intelligence && intelligence.recordEdit) {
      try {
        var file = hookInput.file_path || toolInput.file_path
          || process.env.TOOL_INPUT_file_path || args[0] || '';
        intelligence.recordEdit(file);
      } catch (e) { /* non-fatal */ }
    }
    // ── Security-Sensitive File Auto-Alert ────────────────────────────────
    // When editing auth, security, crypto, or env-related files, flag it
    try {
      var editFile = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '').toLowerCase();
      var securityPatterns = /\b(auth|security|crypto|secret|credential|token|password|\.env|permission|acl|rbac|jwt|oauth|session|cookie)\b/;
      if (securityPatterns.test(editFile) || editFile.includes('/security/') || editFile.includes('/auth/')) {
        console.log('[SECURITY_EDIT] Security-sensitive file modified: ' + path.basename(editFile));
        console.log('[SECURITY_EDIT] INSTRUCTION: Consider running a security review. Invoke Skill("code-review:code-review") with security focus, or run: npx monomind security scan --path "' + editFile + '"');
      }
    } catch (e) { /* non-fatal */ }

    // ── Smart Test/Build Suggestions (PE-001) ───────────────────────────
    try {
      var editFile = (hookInput.file_path || toolInput.file_path
        || process.env.TOOL_INPUT_file_path || args[0] || '');
      var editBase = path.basename(editFile).toLowerCase();
      var editDir = path.dirname(editFile);
      if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(editBase)) {
        console.log('[AUTO_SUGGEST] Test file modified — run: npm test -- --testPathPattern="' + path.basename(editFile) + '"');
      } else if (editBase === 'package.json') {
        console.log('[AUTO_SUGGEST] package.json changed — consider running: npm install');
      } else if (editBase === 'tsconfig.json' || editBase === 'tsconfig.base.json') {
        console.log('[AUTO_SUGGEST] TypeScript config changed — consider running: npm run build');
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Edit recorded');
  },

  'session-restore': async () => {
    try {
      if (session) {
        var existing = session.restore && session.restore();
        if (!existing) {
          session.start && session.start();
        }
      } else {
        console.log('[OK] Session restored: session-' + Date.now());
      }
    } catch (e) { console.log('[WARN] Session restore failed: ' + e.message); }
    // Initialize intelligence (with timeout — #1530)
    // Respects monomind.neural.enabled kill switch from settings.json
    var neuralEnabled = true;
    try {
      var settingsPath = path.join(CWD, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        var settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settingsData.monomind && settingsData.monomind.neural && settingsData.monomind.neural.enabled === false) {
          neuralEnabled = false;
          console.log('[NEURAL] Disabled via monomind.neural.enabled=false');
        }
      }
    } catch (e) { /* non-fatal */ }
    if (neuralEnabled && intelligence && intelligence.init) {
      var initResult = await runWithTimeout(function() { return intelligence.init(); }, 'intelligence.init()');
      if (initResult && initResult.nodes > 0) {
        console.log('[INTELLIGENCE] Loaded ' + initResult.nodes + ' patterns, ' + initResult.edges + ' edges');
      }
    }
    // GAP-001: Bridge hook-handler.cjs to @monomind/hooks compiled packages.
    // Dynamic import() resolves ESM packages even from CJS — failures are silent.
    try {
      var hooksModule = await import('@monomind/hooks');
      if (hooksModule && hooksModule.initDefaultWorkers) {
        await runWithTimeout(function() { return hooksModule.initDefaultWorkers(); }, '@monomind/hooks.initDefaultWorkers()');
        // Store reference so pre-task / post-task can call executeHooks (Tasks 26, 39)
        _hooksModule = hooksModule;
        console.log('[INFO] @monomind/hooks workers initialized');
      }
    } catch (e) { /* @monomind/hooks not compiled yet — skip */ }

    // ── Context Persistence Auto-Restore ───────────────────────────────────
    // Restore archived conversation context from previous sessions
    try {
      var cpHook = await import('file://' + path.join(__dirname, 'context-persistence-hook.mjs'));
      var restoreFn = (cpHook && cpHook.restore) || (cpHook && cpHook.default && cpHook.default.restore);
      if (restoreFn) {
        var restored = await runWithTimeout(function() { return restoreFn(); }, 'context-persistence.restore()');
        if (restored && restored.turns > 0) {
          console.log('[CONTEXT_RESTORED] ' + restored.turns + ' turns from previous session');
        }
      }
    } catch (e) { /* non-fatal — context-persistence may not be available */ }

    // Task 28: AgentKnowledgeBase — preload shared knowledge context on session restore.
    // Self-contained: auto-indexes project docs into chunks.jsonl, then keyword-searches
    // them. Works without @monomind/memory being compiled. Falls back to KnowledgeRetriever
    // if the compiled package IS available (richer dedup + formatting).
    try {
      var knowledgeDir = path.join(CWD, '.monomind', 'knowledge');
      var indexed = _autoIndexKnowledge(knowledgeDir);
      if (indexed > 0) {
        console.log('[KNOWLEDGE_INDEXED] ' + indexed + ' chunks written from project sources');
      }

      var kSearchFn = _buildKnowledgeSearchFn(knowledgeDir);
      var sessionCtx = (hookInput && (hookInput.sessionId || hookInput.session_id))
        ? 'session context: ' + (hookInput.sessionId || hookInput.session_id)
        : 'project context general';

      // Prefer compiled KnowledgeRetriever for dedup + formatting; inline fallback otherwise
      var memoryMod = null;
      try { memoryMod = await import('@monomind/memory'); } catch (e) {}

      if (memoryMod && memoryMod.KnowledgeStore && memoryMod.KnowledgeRetriever) {
        var kStore = new memoryMod.KnowledgeStore(knowledgeDir);
        var kRetriever = new memoryMod.KnowledgeRetriever(kSearchFn, kStore);
        var kResult = await kRetriever.retrieveForTask('shared', sessionCtx, 5);
        if (kResult.excerpts.length > 0) {
          console.log('[KNOWLEDGE_PRELOADED] ' + kResult.excerpts.length + ' excerpts (KnowledgeRetriever)');
        }
      } else {
        // Inline fallback — no compiled deps needed
        var directResults = await kSearchFn(sessionCtx, { namespace: 'knowledge:shared', limit: 5, minScore: 0.3 });
        if (directResults.length > 0) {
          console.log('[KNOWLEDGE_PRELOADED] ' + directResults.length + ' excerpts (direct keyword search)');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Task 23: SharedInstructions — auto-load .agents/shared_instructions.md on session restore
    // Hard limit: 1500 chars (~375 tokens). Content beyond this is truncated and flagged.
    var SI_CHAR_LIMIT = 1500;
    var applySharedInstrLimit = function(content, source) {
      if (content.length > SI_CHAR_LIMIT) {
        console.warn('[SHARED_INSTRUCTIONS_OVERLIMIT] ' + content.length + ' chars exceeds limit of ' + SI_CHAR_LIMIT +
          ' — truncating. Edit ' + source + ' to stay under limit.');
        return content.slice(0, SI_CHAR_LIMIT) + '\n… [truncated — file exceeds ' + SI_CHAR_LIMIT + ' char limit]';
      }
      return content;
    };
    try {
      var siMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/agents/shared-instructions-loader.js'));
      var loader = siMod.sharedInstructionsLoader || (siMod.SharedInstructionsLoader ? new siMod.SharedInstructionsLoader() : null);
      if (loader) {
        var sharedInstr = loader.getSharedInstructions(CWD);
        if (sharedInstr) {
          var sharedInstrSafe = applySharedInstrLimit(sharedInstr, '.agents/shared_instructions.md');
          console.log('[SHARED_INSTRUCTIONS] Loaded ' + sharedInstrSafe.length + ' chars from .agents/shared_instructions.md');
          console.log(sharedInstrSafe);
        }
      }
    } catch (e) {
      // Try direct filesystem fallback
      try {
        var siPath = path.join(CWD, '.agents', 'shared_instructions.md');
        if (fs.existsSync(siPath)) {
          var siContent = fs.readFileSync(siPath, 'utf-8');
          var siContentSafe = applySharedInstrLimit(siContent, siPath);
          console.log('[SHARED_INSTRUCTIONS] Loaded ' + siContentSafe.length + ' chars from .agents/shared_instructions.md');
          console.log(siContentSafe);
        }
      } catch (e2) { /* non-fatal */ }
    }

    // Memory Palace — inject L0 (identity) + L1 (essential story) into session context
    try {
      var palace = require('./memory-palace.cjs');
      var palaceContext = palace.wakeUp(CWD);
      if (palaceContext) {
        console.log(palaceContext);
      }
    } catch (e) { /* non-fatal — palace not available */ }

    // ── Periodic Update Check (once per day) ──────────────────────────────
    try {
      var updateCheckFile = path.join(CWD, '.monomind', 'last-update-check.json');
      var shouldCheck = true;
      if (fs.existsSync(updateCheckFile)) {
        var lastCheck = JSON.parse(fs.readFileSync(updateCheckFile, 'utf-8'));
        var hoursSince = (Date.now() - new Date(lastCheck.timestamp).getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) shouldCheck = false;
      }
      if (shouldCheck) {
        // Non-blocking: write marker immediately, check asynchronously
        fs.mkdirSync(path.join(CWD, '.monomind'), { recursive: true });
        fs.writeFileSync(updateCheckFile, JSON.stringify({ timestamp: new Date().toISOString() }), 'utf-8');
        try {
          var localPkg = path.join(CWD, 'packages/@monomind/cli/package.json');
          if (fs.existsSync(localPkg)) {
            var localVer = JSON.parse(fs.readFileSync(localPkg, 'utf-8')).version;
            if (localVer) {
              // Non-blocking spawn — never holds the event loop during hook execution
              var spawnFn = require('child_process').spawn;
              var child = spawnFn('npm', ['view', '@monomind/cli', 'version'], {
                stdio: ['ignore', 'pipe', 'ignore'],
                shell: false,
              });
              // Required: without an error listener, ENOENT (npm not in PATH) crashes the process
              child.on('error', function() {});
              var out = '';
              child.stdout.on('data', function(d) { out += d; });
              child.on('close', function() {
                var current = out.trim();
                var pendingUpdatePath = path.join(CWD, '.monomind', 'pending-update.json');
                if (current && current !== localVer) {
                  // Write result to a sidecar file — picked up on next session-start
                  try {
                    fs.writeFileSync(
                      pendingUpdatePath,
                      JSON.stringify({ from: localVer, to: current, checkedAt: new Date().toISOString() }),
                      'utf-8'
                    );
                  } catch (e2) {}
                } else if (current) {
                  // Versions match — clear any stale notification so it doesn't show forever
                  try { fs.unlinkSync(pendingUpdatePath); } catch (e2) {}
                }
              });
              child.unref();
            }
          }
        } catch (e) { /* npm not available — skip silently */ }
      }
      // Surface any previously-detected update on every session restore (not just on check day)
      try {
        var pendingUpdate = path.join(CWD, '.monomind', 'pending-update.json');
        if (fs.existsSync(pendingUpdate)) {
          var upd = JSON.parse(fs.readFileSync(pendingUpdate, 'utf-8'));
          if (upd && upd.from && upd.to && upd.from !== upd.to) {
            console.log('[UPDATE_AVAILABLE] @monomind/cli ' + upd.from + ' → ' + upd.to + ' (run: npx monomind update)');
          }
        }
      } catch (e) {}
    } catch (e) { /* non-fatal */ }

    // ── Daemon Auto-Start Check ────────────────────────────────────────────
    // If daemon is not running, suggest starting it (or auto-start if config says so)
    try {
      var daemonPid = path.join(CWD, '.monomind', 'daemon.pid');
      var daemonRunning = false;
      if (fs.existsSync(daemonPid)) {
        try {
          var pid = parseInt(fs.readFileSync(daemonPid, 'utf-8').trim(), 10);
          process.kill(pid, 0); // throws if process doesn't exist
          daemonRunning = true;
        } catch (e) { /* pid stale */ }
      }
      if (!daemonRunning) {
        // Check config for autoStart preference
        var daemonCfg = {};
        try {
          var cfgPath = path.join(CWD, 'monomind.config.json');
          if (fs.existsSync(cfgPath)) daemonCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).daemon || {};
        } catch (e) {}
        if (daemonCfg.autoStart) {
          // Auto-start daemon in background
          var spawn = require('child_process').spawn;
          var child = spawn('npx', ['monomind', 'daemon', 'start'], {
            cwd: CWD, detached: true, stdio: 'ignore'
          });
          child.on('error', function() {});
          child.unref();
          console.log('[DAEMON_AUTOSTART] Background daemon started (pid ' + child.pid + ')');
        } else {
          console.log('[DAEMON_STOPPED] Background daemon is not running. To auto-start, set daemon.autoStart=true in monomind.config.json or run: npx monomind daemon start');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Token Usage — inject daily/monthly cost summary from JSONL session logs
    try {
      var tokenTracker = require('./token-tracker.cjs');
      var tokenSummary = tokenTracker.quickSummary();
      if (tokenSummary) {
        console.log(tokenSummary);
      }
      // Write structured cache for statusline (best-effort, non-blocking)
      try {
        var tokenData = tokenTracker.quickSummaryData();
        if (tokenData) {
          var metricsDir = path.join(CWD, '.monomind', 'metrics');
          if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
          tokenData.cachedAt = new Date().toISOString();
          fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify(tokenData), 'utf-8');
        }
      } catch (_) { /* ignore cache write failure */ }
    } catch (e) { /* non-fatal — token tracker not available */ }

    // ── Registry Surfacing (SR-001) ─────────────────────────────────────
    // Show agent registry summary so users know what's available
    try {
      var regPath = path.join(CWD, '.monomind', 'registry.json');
      if (fs.existsSync(regPath)) {
        var reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
        var agentCount = (reg.agents || []).length;
        if (agentCount > 0) {
          console.log('[REGISTRY] ' + agentCount + ' agents available in registry');
        }
      }
    } catch (e) { /* non-fatal */ }

    // ── Monomind Control UI Status ────────────────────────────────────────
    try {
      var http = require('http');
      var controlPort = 4242;
      var req = http.get('http://localhost:' + controlPort + '/', function(res) {
        if (res.statusCode === 200) {
          console.log('[CONTROL_UI] UP — http://localhost:' + controlPort);
        }
        res.resume();
      });
      req.on('error', function() {
        console.log('[CONTROL_UI] offline — run: npx monomind mcp start');
      });
      req.setTimeout(800, function() { req.destroy(); });
    } catch (e) { /* non-fatal */ }

    // ── Worker Queue Resume (SR-003) ────────────────────────────────────
    try {
      var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
      if (fs.existsSync(dispatchDir)) {
        var pendingFiles = fs.readdirSync(dispatchDir).filter(function(f) { return f.startsWith('pending-'); });
        if (pendingFiles.length > 0) {
          console.log('[WORKER_RESUME] ' + pendingFiles.length + ' worker dispatch(es) pending from prior session');
        }
      }
    } catch (e) { /* non-fatal */ }
  },

  'session-end': async () => {
    // Consolidate intelligence (with timeout — #1530)
    if (intelligence && intelligence.consolidate) {
      var consResult = await runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()');
      if (consResult && consResult.entries > 0) {
        var msg = '[INTELLIGENCE] Consolidated: ' + consResult.entries + ' entries, ' + consResult.edges + ' edges';
        if (consResult.newEntries > 0) msg += ', ' + consResult.newEntries + ' new';
        msg += ', PageRank recomputed';
        console.log(msg);
      }
    }
    try {
      if (session && session.end) {
        session.end();
      } else {
        console.log('[OK] Session ended');
      }
    } catch (e) { console.log('[WARN] Session end failed: ' + e.message); }

    // ── Routing Feedback Loop (SE-001) ────────────────────────────────────
    // Persist routing accuracy feedback so the router improves over sessions
    try {
      var feedbackPath = path.join(CWD, '.monomind', 'routing-feedback.jsonl');
      var lastRoutePath = path.join(CWD, '.monomind', 'last-route.json');
      if (fs.existsSync(lastRoutePath)) {
        var lastRoute = JSON.parse(fs.readFileSync(lastRoutePath, 'utf-8'));
        var feedbackEntry = {
          timestamp: new Date().toISOString(),
          suggestedAgent: lastRoute.agent,
          confidence: lastRoute.confidence,
          sessionId: hookInput.sessionId || hookInput.session_id || '',
          // If intelligence gave feedback during session, it's recorded here
          intelligenceFeedback: (intelligence && intelligence.getSessionStats) ? intelligence.getSessionStats() : null,
        };
        fs.appendFileSync(feedbackPath, JSON.stringify(feedbackEntry) + '\n', 'utf-8');
        // Rotate: keep last 1000 lines to prevent unbounded growth
        try {
          var raw = fs.readFileSync(feedbackPath, 'utf-8');
          var lines = raw.split('\n').filter(Boolean);
          if (lines.length > 1000) {
            fs.writeFileSync(feedbackPath, lines.slice(-1000).join('\n') + '\n', 'utf-8');
          }
        } catch (e2) { /* rotation is best-effort */ }
      }
    } catch (e) { /* non-fatal */ }

    // Memory Palace tombstone writes removed — redundant with raw session JSONL

    // ── Learning Service Auto-Consolidation ─────────────────────────────
    // Consolidate learned patterns from short-term to long-term storage
    try {
      var learningService = await import('file://' + path.join(__dirname, 'learning-service.mjs'));
      if (learningService && learningService.consolidate) {
        var lResult = await runWithTimeout(function() { return learningService.consolidate(); }, 'learning.consolidate()');
        if (lResult && lResult.promoted > 0) {
          console.log('[LEARNING] Consolidated: ' + lResult.promoted + ' patterns promoted to long-term');
        }
      } else if (learningService && learningService.default && learningService.default.consolidate) {
        var lResult2 = await runWithTimeout(function() { return learningService.default.consolidate(); }, 'learning.consolidate()');
        if (lResult2 && lResult2.promoted > 0) {
          console.log('[LEARNING] Consolidated: ' + lResult2.promoted + ' patterns promoted to long-term');
        }
      }
    } catch (e) { /* non-fatal — learning-service may need better-sqlite3 */ }

    // ── Context Persistence Auto-Archive ─────────────────────────────────
    // Archive conversation context so it survives compaction and new sessions
    try {
      var cpHook = await import('file://' + path.join(__dirname, 'context-persistence-hook.mjs'));
      if (cpHook && cpHook.archive) {
        await runWithTimeout(function() { return cpHook.archive(); }, 'context-persistence.archive()');
        console.log('[CONTEXT_PERSIST] Session transcript archived');
      } else if (cpHook && cpHook.default && cpHook.default.archive) {
        await runWithTimeout(function() { return cpHook.default.archive(); }, 'context-persistence.archive()');
        console.log('[CONTEXT_PERSIST] Session transcript archived');
      }
    } catch (e) { /* non-fatal — context-persistence may not export archive() */ }

    // ── Worker Queue Cleanup ─────────────────────────────────────────────
    // Process and clean up any pending worker dispatch files
    try {
      var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
      if (fs.existsSync(dispatchDir)) {
        var pending = fs.readdirSync(dispatchDir).filter(function(f) { return f.startsWith('pending-'); });
        if (pending.length > 0) {
          console.log('[WORKER_CLEANUP] ' + pending.length + ' worker dispatch(es) pending from this session');
        }
        // Move to processed
        var processedDir = path.join(dispatchDir, 'processed');
        fs.mkdirSync(processedDir, { recursive: true });
        pending.forEach(function(f) {
          try {
            fs.renameSync(path.join(dispatchDir, f), path.join(processedDir, f));
          } catch (e) { /* ignore */ }
        });
        // Trim processed/ to last 200 files to prevent unbounded growth
        try {
          var processedFiles = fs.readdirSync(processedDir)
            .filter(function(f) { return f.startsWith('pending-'); })
            .map(function(f) { var fp = path.join(processedDir, f); var mt = 0; try { mt = fs.statSync(fp).mtimeMs; } catch(e2){} return { f: f, mt: mt }; })
            .sort(function(a, b) { return a.mt - b.mt; });
          if (processedFiles.length > 200) {
            processedFiles.slice(0, processedFiles.length - 200).forEach(function(item) {
              try { fs.unlinkSync(path.join(processedDir, item.f)); } catch (e2) { /* ignore */ }
            });
          }
        } catch (e2) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }
  },

  'pre-task': async () => {
    if (session && session.metric) {
      try { session.metric('tasks'); } catch (e) { /* no active session */ }
    }

    // ── Task 27: PerRunModelTier — inline complexity scoring ───────────────
    var taskStr = typeof prompt === 'string' ? prompt : '';
    if (taskStr) {
      var score = 50;
      var lower = taskStr.toLowerCase();
      var words = taskStr.trim().split(/\s+/).length;
      if (words < 20) score -= 20;
      if (words > 100) score += 20;
      if (words > 200) score += 10;
      var highKw = ['architecture','distributed','security audit','cve','consensus','fault-tolerant','migrate','refactor across','orchestrat','design system','database schema','performance optim','threat model','encryption','zero-knowledge'];
      var lowKwRe = /\b(format|list|rename|sort|typo|lint|log|comment|print|echo|delete unused|remove import)\b/i;
      if (highKw.some(function(k) { return lower.includes(k); })) score += 10;
      if (lowKwRe.test(lower)) score -= 10;
      if (/(?:step\s*\d|first[\s,].*then[\s,]|phase\s*\d)/i.test(taskStr)) score += 10;
      if (/```[\s\S]*?```/.test(taskStr) || /\b[\w.-]+\/[\w./-]+\b/.test(taskStr)) score += 5;
      score = Math.max(0, Math.min(100, score));
      var tier = score < 30 ? 'haiku' : score > 70 ? 'opus' : 'sonnet';
      console.log('[TASK_MODEL_RECOMMENDATION] Use model="' + tier + '" (complexity=' + score + ')');
    }
    // Task 06: AutoRetry — signal retry policy only if coordinator path is active
    if (hookInput.swarmCoordinator || hookInput.coordinator || hookInput.useRetry) {
      console.log('[AUTO_RETRY_ENABLED] maxAttempts=3 strategy=exponential-backoff backoffMs=1000');
    }

    if (router && prompt) {
      var routeFn = router.routeTaskSemantic || router.routeTask;
      var result = await Promise.resolve(routeFn(prompt));
      console.log('[INFO] Task routed to: ' + result.agent + ' (confidence: ' + result.confidence + ')');
    } else {
      console.log('[OK] Task started');
    }

    // Task 24: PromptVersioning — resolve prompt variant before agent spawn
    try {
      var memMod = await import('@monomind/memory');
      if (memMod && memMod.PromptVersionStore) {
        var pvStore = new memMod.PromptVersionStore(path.join(CWD, '.monomind', 'prompt-versions'));
        var pvMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/agents/prompt-experiment.js'));
        if (pvMod && pvMod.PromptExperimentRouter) {
          var pvRouter = new pvMod.PromptExperimentRouter(pvStore);
          var agentSlug24 = hookInput.agentSlug || hookInput.agentType || hookInput.agent_type || 'unknown';
          if (agentSlug24 !== 'unknown') {
            var resolved = pvRouter.resolvePromptForSpawn(agentSlug24);
            if (resolved.version) {
              console.log('[PROMPT_VERSION] ' + agentSlug24 + ' v' + resolved.version + (resolved.isCandidate ? ' (experiment candidate)' : ''));
            }
          }
        }
      }
    } catch (e) { /* not available or no experiment */ }

    // Bridge to @monomind/hooks registry — fires Tasks 26 (PromptAssembler) and any other PreTask hooks
    if (_hooksModule && _hooksModule.executeHooks && _hooksModule.HookEvent) {
      try {
        await _hooksModule.executeHooks(_hooksModule.HookEvent.PreTask, {
          task: typeof prompt === 'string' ? { description: prompt, id: hookInput.taskId || '' } : null,
          sessionId: hookInput.sessionId || hookInput.session_id || 'default',
        }, { continueOnError: true, timeout: 2000 });
      } catch (e) { /* non-fatal */ }
    }
  },

  'post-task': async () => {
    var taskSuccess = hookInput.success !== false && hookInput.status !== 'failed';
    if (intelligence && intelligence.feedback) {
      try {
        intelligence.feedback(true);
      } catch (e) { /* non-fatal */ }
    }
    // Each TeammateIdle/TaskCompleted = one agent done → remove oldest registration (FIFO)
    const regDir = path.join(CWD, '.monomind', 'agents', 'registrations');
    try {
      if (fs.existsSync(regDir)) {
        const files = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          // Sort by mtime ascending (oldest first) and remove the oldest one
          const sorted = files
            .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(regDir, f)).mtimeMs; } catch { return 0; } })() }))
            .sort((a, b) => a.mtime - b.mtime);
          try { fs.unlinkSync(path.join(regDir, sorted[0].f)); } catch { /* ignore */ }
        }
        // Also purge any stragglers older than 30 min
        const now = Date.now();
        for (const f of fs.readdirSync(regDir).filter(f => f.endsWith('.json'))) {
          try { if (now - fs.statSync(path.join(regDir, f)).mtimeMs > 30 * 60 * 1000) fs.unlinkSync(path.join(regDir, f)); } catch { /* ignore */ }
        }
        const remaining = fs.readdirSync(regDir).filter(f => f.endsWith('.json')).length;
        const _actPath = path.join(CWD, '.monomind', 'metrics', 'swarm-activity.json');
        let _prevLastActive = 0;
        try { _prevLastActive = (JSON.parse(fs.readFileSync(_actPath, 'utf-8'))?.swarm?.lastActive) || 0; } catch { /* ignore */ }
        fs.writeFileSync(_actPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          swarm: {
            active: remaining > 0,
            agent_count: remaining,
            coordination_active: remaining > 0,
            lastActive: Math.max(remaining, _prevLastActive), // preserve peak across completion
          },
        }));
      }
    } catch (e) { /* non-fatal */ }
    // Bridge to @monomind/hooks registry — fires Tasks 39 (SpecializationScorer) and any other PostTask hooks
    if (_hooksModule && _hooksModule.executeHooks && _hooksModule.HookEvent) {
      try {
        await _hooksModule.executeHooks(_hooksModule.HookEvent.PostTask, {
          task: {
            id: hookInput.taskId || hookInput.task_id || '',
            status: taskSuccess ? 'completed' : 'failed',
            agentSlug: hookInput.agentSlug || hookInput.agent_slug || 'unknown',
            type: hookInput.taskType || hookInput.task_type || 'general',
          },
          success: taskSuccess,
          latencyMs: hookInput.latencyMs || hookInput.latency_ms || 0,
          qualityScore: hookInput.qualityScore || hookInput.quality_score,
        }, { continueOnError: true, timeout: 2000 });
      } catch (e) { /* non-fatal */ }
    }
    // Task 35: TerminationConditions — detect halted swarms via halt-signal
    try {
      var haltMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/agents/halt-signal.js'));
      if (haltMod && haltMod.isHalted) {
        var swarmId35 = hookInput.swarmId || hookInput.swarm_id || 'default';
        if (haltMod.isHalted(swarmId35)) {
          console.warn('[HALT_DETECTED] Swarm ' + swarmId35 + ' has an active halt signal — agents should stop');
        }
      }
    } catch (e) {
      // Try direct file check
      try {
        var haltFile = path.join(CWD, 'data', 'halt-signals.jsonl');
        if (fs.existsSync(haltFile)) {
          var haltLines = fs.readFileSync(haltFile, 'utf-8').trim().split('\n').filter(Boolean);
          if (haltLines.length > 0) {
            console.warn('[HALT_DETECTED] ' + haltLines.length + ' halt signal(s) present');
          }
        }
      } catch (e2) { /* non-fatal */ }
    }

    // Task 37: DeadLetterQueue — enqueue failed tasks when retries exhausted
    try {
      if (!taskSuccess) {
        var dlqMod = await import('file://' + path.join(CWD, 'packages/@monomind/cli/dist/src/dlq/dlq-writer.js'));
        if (dlqMod && dlqMod.DLQWriter) {
          var dlqDir = path.join(CWD, '.monomind', 'dlq');
          var dlqWriter = new dlqMod.DLQWriter(dlqDir);
          dlqWriter.enqueue({
            toolName: 'post-task',
            originalPayload: { taskId: hookInput.taskId || '', agentSlug: hookInput.agentSlug || 'unknown' },
            deliveryAttempts: [{ attempt: 1, timestamp: new Date().toISOString(), error: hookInput.error || 'task failed' }],
            agentId: hookInput.agentSlug || hookInput.agent_slug,
            swarmId: hookInput.swarmId || hookInput.swarm_id,
          });
          console.log('[DLQ_ENQUEUED] Failed task ' + (hookInput.taskId || 'unknown') + ' sent to dead-letter queue');
        }
      }
    } catch (e) { /* non-fatal */ }

    // Memory Palace task drawer writes removed — use auto-memory files for task context

    // ── Worker Auto-Dispatch ──────────────────────────────────────────────
    // Auto-dispatch background workers based on task outcome
    try {
      var taskDesc = (typeof prompt === 'string' ? prompt : hookInput.description || '').toLowerCase();
      var workersToDispatch = [];

      // Always consolidate memory after any task
      workersToDispatch.push('consolidate');

      // Security-related task → dispatch audit worker
      if (/\b(security|auth|vuln|cve|threat|token|permission|crypto)\b/.test(taskDesc)) {
        workersToDispatch.push('audit');
      }
      // Performance-related → dispatch benchmark worker
      if (/\b(performance|optimiz|benchmark|latency|throughput)\b/.test(taskDesc)) {
        workersToDispatch.push('benchmark');
      }
      // Code changes → dispatch testgaps worker
      if (/\b(implement|feature|refactor|fix|build|add|create|modify)\b/.test(taskDesc)) {
        workersToDispatch.push('testgaps');
      }
      // Any significant task → dispatch map worker for codebase indexing
      if (taskDesc.length > 50) {
        workersToDispatch.push('map');
      }

      // Dispatch via @monomind/hooks if available, otherwise write dispatch file
      if (workersToDispatch.length > 0) {
        var dispatchDir = path.join(CWD, '.monomind', 'worker-dispatch');
        fs.mkdirSync(dispatchDir, { recursive: true });
        var dispatchPayload = {
          workers: workersToDispatch,
          trigger: 'post-task',
          taskDesc: taskDesc.substring(0, 100),
          success: taskSuccess,
          timestamp: new Date().toISOString(),
        };
        fs.writeFileSync(
          path.join(dispatchDir, 'pending-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.json'),
          JSON.stringify(dispatchPayload), 'utf-8'
        );
        console.log('[WORKER_DISPATCH] Queued: ' + workersToDispatch.join(', '));
      }
    } catch (e) { /* non-fatal */ }

    // ── ADR Auto-Generation ────────────────────────────────────────────────
    // When adr.autoGenerate is true and task involved architect-level work,
    // create an ADR stub in the configured directory
    try {
      var settingsPath = path.join(CWD, '.claude', 'settings.json');
      var adrCfg = {};
      if (fs.existsSync(settingsPath)) {
        var s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        adrCfg = (s.monomind && s.monomind.adr) || {};
      }
      if (adrCfg.autoGenerate) {
        var taskAgent = hookInput.agentSlug || hookInput.agent_slug || '';
        var taskDescAdr = (typeof prompt === 'string' ? prompt : hookInput.description || '').toLowerCase();
        var isArchitectLevel = ['architect', 'system-architect', 'software-architect'].includes(taskAgent)
          || /\b(architecture|design decision|adr|trade-?off|migration strategy)\b/.test(taskDescAdr);
        if (isArchitectLevel && taskDescAdr.length > 30) {
          var adrDir = path.join(CWD, adrCfg.directory || 'docs/adr');
          fs.mkdirSync(adrDir, { recursive: true });
          var adrNum = (fs.readdirSync(adrDir).filter(function(f) { return f.endsWith('.md'); }).length + 1)
            .toString().padStart(4, '0');
          var adrTitle = taskDescAdr.substring(0, 60).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          var adrFile = path.join(adrDir, 'ADR-' + adrNum + '-' + adrTitle + '.md');
          if (!fs.existsSync(adrFile)) {
            var adrContent = '# ADR-' + adrNum + ': ' + (typeof prompt === 'string' ? prompt.substring(0, 80) : adrTitle) + '\n\n'
              + '**Date:** ' + new Date().toISOString().slice(0, 10) + '\n'
              + '**Status:** Accepted\n'
              + '**Agent:** ' + (taskAgent || 'unknown') + '\n\n'
              + '## Context\n\nAuto-generated from task completion.\n\n'
              + '## Decision\n\n_Fill in the decision made._\n\n'
              + '## Consequences\n\n_Fill in the consequences._\n';
            fs.writeFileSync(adrFile, adrContent, 'utf-8');
            console.log('[ADR_GENERATED] ' + path.basename(adrFile));
          }
        }
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Task completed');
  },

  'compact-manual': async () => {
    // Consolidate intelligence before compaction so patterns survive
    if (intelligence && intelligence.consolidate) {
      try { await runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()'); } catch (e) { /* non-fatal */ }
    }
    // Save current routing context for post-compact restore
    try {
      var lastRoute = path.join(CWD, '.monomind', 'last-route.json');
      if (fs.existsSync(lastRoute)) {
        var route = JSON.parse(fs.readFileSync(lastRoute, 'utf-8'));
        console.log('[COMPACT_CONTEXT] Last route: ' + route.agent + ' (' + (route.confidence != null ? (route.confidence * 100).toFixed(0) : '?') + '%)');
      }
    } catch (e) { /* non-fatal */ }
    console.log('[COMPACT] Manual compaction — intelligence consolidated, context preserved');
  },

  'compact-auto': async () => {
    // Same consolidation for auto-compact
    if (intelligence && intelligence.consolidate) {
      try { await runWithTimeout(function() { return intelligence.consolidate(); }, 'intelligence.consolidate()'); } catch (e) { /* non-fatal */ }
    }
    try {
      var lastRoute = path.join(CWD, '.monomind', 'last-route.json');
      if (fs.existsSync(lastRoute)) {
        var route = JSON.parse(fs.readFileSync(lastRoute, 'utf-8'));
        console.log('[COMPACT_CONTEXT] Last route: ' + route.agent + ' (' + (route.confidence != null ? (route.confidence * 100).toFixed(0) : '?') + '%)');
      }
    } catch (e) { /* non-fatal */ }
    console.log('[COMPACT] Auto compaction — intelligence consolidated, context preserved');
    console.log('GOLDEN RULE: 1 message = all parallel operations');
  },

  'agent-start': () => {
    // Called by SubagentStart hook — register this agent so the statusline can count it
    const regDir = path.join(CWD, '.monomind', 'agents', 'registrations');
    try {
      fs.mkdirSync(regDir, { recursive: true });
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const regFile = path.join(regDir, 'agent-' + id + '.json');
      fs.writeFileSync(regFile, JSON.stringify({
        agentId: id,
        startedAt: new Date().toISOString(),
        pid: process.pid,
      }));
      // Also refresh swarm-activity.json so it's within the 5-min staleness window
      const activityDir = path.join(CWD, '.monomind', 'metrics');
      fs.mkdirSync(activityDir, { recursive: true });
      const activityPath = path.join(activityDir, 'swarm-activity.json');
      const active = fs.readdirSync(regDir).filter(f => f.endsWith('.json')).length;
      // Preserve lastActive (peak) across agent lifecycle so statusline shows non-zero after completion
      let prevLastActive = 0;
      try { prevLastActive = (JSON.parse(fs.readFileSync(activityPath, 'utf-8'))?.swarm?.lastActive) || 0; } catch { /* ignore */ }
      fs.writeFileSync(activityPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        swarm: {
          active: active > 0,
          agent_count: active,
          coordination_active: active > 0,
          lastActive: Math.max(active, prevLastActive),
        },
      }));

      // Write last-dispatch.json so the route handler can suppress redundant suggestions
      // on the next turn when the same type of agent is recommended.
      const agentType = hookInput.subagent_type || hookInput.agentType || hookInput.agent_type || hookInput.agentSlug || 'unknown';
      const agentDesc = hookInput.description || hookInput.prompt_description || '';
      fs.writeFileSync(
        path.join(CWD, '.monomind', 'last-dispatch.json'),
        JSON.stringify({
          agentType: agentType,
          description: agentDesc.substring(0, 120),
          dispatchedAt: new Date().toISOString(),
        }),
        'utf-8'
      );
    } catch (e) { /* non-fatal — never block a subagent from starting */ }
    console.log('[OK] Agent registered');
  },

  'status': () => {
    console.log('[OK] Status check');
  },

  'stats': async () => {
    if (intelligence && intelligence.stats) {
      await Promise.resolve(intelligence.stats(args.includes('--json')));
    } else {
      console.log('[WARN] Intelligence module not available. Run session-restore first.');
    }
  },
};

if (command && handlers[command]) {
    try {
      await Promise.resolve(handlers[command]());
    } catch (e) {
      console.log('[WARN] Hook ' + command + ' encountered an error: ' + e.message);
    }
  } else if (command) {
    console.log('[OK] Hook: ' + command);
  } else {
    console.log('Usage: hook-handler.cjs <route|pre-bash|post-edit|session-restore|session-end|pre-task|post-task|compact-manual|compact-auto|status|stats>');
  }
}

main().catch(function(e) {
  console.log('[WARN] Hook handler error: ' + e.message);
}).finally(function() {
  // Ensure clean exit for Claude Code hooks
  process.exit(0);
});

'use strict';
// Extracted from hook-handler.cjs — receives hCtx from dispatcher.
// Behavioral equivalence verified: 133 routing tests pass post-extraction.
// hCtx (hook context) contains all shared state and utility functions:
//   hCtx.hookInput, hCtx.toolInput, hCtx.toolName, hCtx.prompt, hCtx.args, hCtx.CWD
//   hCtx.session, hCtx.router, hCtx.intelligence
//   hCtx.isSimpleCommand — function defined in main(), passed via hCtx
//   hCtx.getLearningService — async factory for LearningService singleton
//   Utility fns: _recordRecentEdit, _findAffectedTests, _recordHookLatency,
//     _getBudgetStatus, _injectCompactGraphMap, _maybeRebuildMonograph,
//     _buildKnowledgeSearchFn, getMonographSuggestions, getMonographNeighbors,
//     runWithTimeout, safeRequire, scanMicroAgentTriggers, _recordGraphTelemetry,
//     _recordDecisionMarkers, _recordToolCall, _openMonographDb, fs, path
//
// NOTE: The 'route' handler has a local variable named 'ctx' (from intelligence.getContext).
// The dispatcher passes the hook context as 'hCtx' to avoid collision.

const path = require('path');
const fs = require('fs');

module.exports = {
  handle: async function(hCtx) {
    var prompt = hCtx.prompt;
    var hookInput = hCtx.hookInput;
    var router = hCtx.router;
    var intelligence = hCtx.intelligence;
    var CWD = hCtx.CWD;

    // For slash commands and single-action invocations: skip routing panel output
    // but still write last-route.json so the statusline reflects the current action.
    if (hCtx.isSimpleCommand(prompt)) {
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
      var result = await Promise.resolve(routeFn(prompt));

      // Graph-fallback override: when the router picked a low-confidence
      // non-dev specialist (marketing slugs etc) but monograph has a strong
      // graph match for the prompt, derive the agent from the top file's
      // label instead. Stops "improve the system" → China E-Commerce.
      try {
        // Don't override when the prompt has obvious non-dev keywords —
        // marketing/sales/finance asks SHOULD route to those specialists.
        var nonDevPrompt = /\b(marketing|advertis|seo|tiktok|instagram|linkedin|sales|customer|brand|blog post|content strategy|copy(?:writ|writing)|pitch|investor|hr|recruit|legal|compliance|tax|invoice|accounting|onboarding|design syst|figma|user research|persona)\b/i.test(prompt);

        var devAgents = /^(coder|tester|reviewer|planner|researcher|system-architect|backend-dev|backend-architect|mobile-dev|ml-developer|cicd-engineer|api-docs|code-analyzer|production-validator|Technical Writer)$/i;
        var pickedDev = devAgents.test(String(result.agent || '').trim()) ||
                        devAgents.test(String(result.agentSlug || '').trim());

        var resConf = (result.confidence != null ? result.confidence : 0);
        var resReason = String(result.reason || '');
        var fromKeywordStage = resReason.indexOf('Keyword 2-stage') !== -1;
        var promptIsDevish = /\b(develop(?:ment|er)?|routing|improve|refactor|fix|bug|optimi[sz]e|implement|build|debug|deploy|test|feature|system|performance|architecture|memory|hook|graph|statusline|monograph|api|cli|skill|hooks|agent|workflow|init|module|package|registry|server|client|route|handler|localhost|dashboard|sidebar|layout|component|function|class|config|port|script|parse|compile|lint|build)\b/i.test(prompt);

        // Align with the 90% primary-panel threshold: any non-dev pick below
        // 90% confidence gets overridden via the graph, unless the prompt
        // explicitly uses non-dev domain language (nonDevPrompt guard).
        var shouldOverride = !nonDevPrompt && (
          (!pickedDev && resConf < 0.90) ||
          (fromKeywordStage && promptIsDevish)
        );
        if (shouldOverride) {
          var topGraph = hCtx.getMonographSuggestions(prompt, 1)[0];
          if (topGraph) {
            var agent = 'coder';
            var file = (topGraph.file || '').toLowerCase();
            // Test files
            if (/\.(test|spec)\./.test(file) || file.includes('__tests__')) agent = 'tester';
            // Architecture/system docs → architect
            else if (/(architect|adr-|design-doc|rfc-)/.test(file))         agent = 'system-architect';
            // Pure docs → tech writer
            else if (file.endsWith('readme.md') || file.startsWith('docs/') || /\/docs\//.test(file)) agent = 'Technical Writer';
            // Other .md (skills, agents, configs) → coder (they're code-adjacent)
            else if (file.endsWith('.md'))                                  agent = 'coder';
            // Class/Interface → architect
            else if (topGraph.label === 'Class' || topGraph.label === 'Interface') agent = 'system-architect';
            // Functions, files, methods → coder
            else                                                             agent = 'coder';
            // Scale confidence by graph degree: well-connected nodes are stronger anchors.
            var topDeg = topGraph.deg || 0;
            var graphConf = topDeg > 30 ? 0.80 : (topDeg > 10 ? 0.75 : 0.70);
            result = Object.assign({}, result, {
              agent: agent,
              agentSlug: agent,
              confidence: graphConf,
              reason: 'Graph fallback: top file ' + (topGraph.name || '').substring(0, 30) + ' [' + topGraph.label + '] deg=' + topDeg,
              specificAgents: [],
              extrasMatches: [],
            });
          }
        }
      } catch (e) {}

      var output = [];
      output.push('[INFO] Routing task: ' + (prompt.substring(0, 80) || '(no prompt)'));
      output.push('');
      // Routing panel strategy:
      //   conf >= 0.90 → show primary recommendation (router is confident, trust it)
      //   conf  < 0.90 → show category picker so Claude uses its own context to
      //                   pick the right agent category + agent from a menu.
      //                   Specific-agent panel is suppressed (category menu replaces it).
      var conf = result.confidence != null ? result.confidence : 0;
      var promptShort = (prompt || '').trim().length < 60;
      var lowConf = conf < 0.70;
      var suppressPanel = lowConf && promptShort;

      // Agent category menu — shown when conf < 0.90 so Claude picks with context.
      var AGENT_CATEGORIES = [
        { label: 'CORE',      agents: 'coder · reviewer · tester · planner · researcher' },
        { label: 'BACKEND',   agents: 'backend-dev · Backend Architect · DB Optimizer' },
        { label: 'FRONTEND',  agents: 'Frontend Developer · mobile-dev' },
        { label: 'ARCH',      agents: 'Software Architect · system-architect' },
        { label: 'SECURITY',  agents: 'Security Engineer · security-architect' },
        { label: 'AI/ML',     agents: 'AI Engineer · ml-developer · Data Engineer' },
        { label: 'DEVOPS',    agents: 'DevOps Automator · SRE · cicd-engineer' },
        { label: 'DOCS',      agents: 'Technical Writer · api-docs' },
        { divider: 'Non-Coding Agents' },
        { label: 'PRODUCT',   agents: 'Product Manager · Launch Strategist · CRO Spec.' },
        { label: 'MARKETING', agents: 'Content Creator · SEO Specialist · Growth Hacker' },
        { label: 'SOCIAL',    agents: 'TikTok · LinkedIn · Twitter · Instagram Strat.' },
        { label: 'SALES',     agents: 'Deal Strategist · Sales Coach · Outbound Strat.' },
        { label: 'BUSINESS',  agents: 'Finance Tracker · Legal Compliance · Analytics' },
        { label: 'DESIGN',    agents: 'Monodesign (UI/UX · brand · CSS · animation)' },
      ];

      if (conf >= 0.90) {
        output.push('+------------- monomind | Primary Recommendation --------------+');
        output.push('| Agent: ' + (result.agent || 'unknown').substring(0, 54).padEnd(54) + '|');
        output.push('| Confidence: ' + ((result.confidence != null ? (result.confidence * 100).toFixed(1) : '?') + '%').padEnd(49) + '|');
        output.push('| Reason: ' + (result.reason || '').substring(0, 53).padEnd(53) + '|');
        output.push('+--------------------------------------------------------------+');
      } else if (!suppressPanel) {
        output.push('+------- monomind | Agent Category Picker ---------------------+');
        output.push('| ' + ('Conf: ' + (conf * 100).toFixed(0) + '% — router uncertain. YOU choose using context.').padEnd(60) + ' |');
        output.push('+--------------------------------------------------------------+');
        AGENT_CATEGORIES.forEach(function(cat) {
          if (cat.divider) {
            var d = '- ' + cat.divider + ' ';
            output.push('|' + d.padEnd(31, '-') + ''.padEnd(31, '-') + '|');
          } else {
            output.push('| ' + cat.label.padEnd(10) + cat.agents.substring(0, 50).padEnd(50) + ' |');
          }
        });
        output.push('+--------------------------------------------------------------+');
        output.push('| INSTRUCTION: Read your conversation context. Identify the    |');
        output.push('| best-fit category above, then pick one agent from it and     |');
        output.push('| spawn it via Task({ subagent_type: "name" }). If no agent    |');
        output.push('| fits the task, skip and proceed directly. Do this now.       |');
        output.push('+--------------------------------------------------------------+');
      }

      // ── Persist routing result for statusline display ─────────────
      try {
        var routeDir = path.join(CWD, '.monomind');
        fs.mkdirSync(routeDir, { recursive: true });
        // When confidence < 90% and the router picked a non-dev agent without
        // a graph override, don't persist the wrong specialist — show "AI" instead.
        var confForPersist = result.confidence != null ? result.confidence : 0;
        var devAgentsForPersist = /^(coder|tester|reviewer|planner|researcher|system-architect|backend-dev|backend-architect|mobile-dev|ml-developer|cicd-engineer|api-docs|code-analyzer|production-validator|Technical Writer|Software Architect|Frontend Developer|AI Engineer|Data Engineer|Security Engineer|DevOps Automator|SRE)$/i;
        var persistedIsNonDev = !devAgentsForPersist.test(String(result.agent || '').trim());
        var resolvedAgent = result.agent;
        if (!resolvedAgent || resolvedAgent === 'extras') {
          var topExtra = result.extrasMatches && result.extrasMatches[0];
          resolvedAgent = topExtra ? topExtra.name : 'Specialist Agent';
        }
        // If router was uncertain (< 90%) and picked a non-dev specialist,
        // show "AI selecting" in statusline rather than the wrong agent.
        if (confForPersist < 0.90 && persistedIsNonDev && !String(result.reason || '').startsWith('Graph fallback')) {
          resolvedAgent = 'AI selecting';
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
      // Skip entirely on suppressed (low-confidence + short) prompts.
      var specificAgents = result.specificAgents || [];
      if (specificAgents.length > 0 && !suppressPanel && conf >= 0.90) {
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
      var specificAgentsShown = (result.specificAgents || []).length > 0 && conf >= 0.90;
      if (extras.length > 0 && !specificAgentsShown && !suppressPanel) {
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
        var triggerResult = hCtx.scanMicroAgentTriggers(typeof prompt === 'string' ? prompt : '');
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
            var routeSt = fs.statSync(routeFile);
            if (routeSt.size <= 1024 * 1024) {
              var existing = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
              existing.microAgents = { injectAgents: triggerResult.injectAgents || [], takeoverAgent: triggerResult.takeoverAgent || null };
              fs.writeFileSync(routeFile, JSON.stringify(existing), 'utf-8');
            }
          } catch (e) {}
        }
      } catch (e) { /* non-fatal */ }

      console.log(output.join('\n'));

      // Record any decision markers in this prompt (auto-ADR pipeline).
      try { hCtx._recordDecisionMarkers(prompt); } catch (e) {}

      // Cost budget — emit amber/red banner when approaching limit.
      try {
        var budget = hCtx._getBudgetStatus();
        if (budget && budget.alert) {
          var tunedNote = budget.autoTuned ? ' (auto-tuned)' : '';
          if (budget.spike && !budget.breached) {
            console.log('[BUDGET_SPIKE] Today $' + budget.todayCost.toFixed(2) + ' is >2x your rolling daily avg. Unusual spend — review .monomind/metrics/token-summary.json.');
          } else if (budget.breached) {
            console.log('[BUDGET_BREACHED] Daily $' + budget.todayCost.toFixed(2) + '/$' + budget.dailyLimit + ' (' + budget.dailyPct + '%) · Monthly $' + budget.monthCost.toFixed(2) + '/$' + budget.monthlyLimit + ' (' + budget.monthlyPct + '%)' + tunedNote + '. Switch to Haiku with /model haiku or edit .monomind/budget.json.');
          } else {
            console.log('[BUDGET_ALERT] Daily ' + budget.dailyPct + '% of $' + budget.dailyLimit + ' · Monthly ' + budget.monthlyPct + '% of $' + budget.monthlyLimit + tunedNote + '.');
          }
        }
      } catch (e) {}

      // Inject monograph hint for complex tasks.
      // Source of truth is .monomind/monograph.db (SQLite). Legacy stats.json
      // is no longer written by the build, so it is checked only as a fallback.
      try {
        var monographDb = path.join(CWD, '.monomind', 'monograph.db');
        var legacyStats = path.join(CWD, '.monomind', 'graph', 'stats.json');
        var nodeCount = 0;
        if (fs.existsSync(monographDb)) {
          try {
            var hintDb = hCtx._openMonographDb();
            if (hintDb) {
              nodeCount = hintDb.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
            }
          } catch (e) { /* ignore — fall back to legacy */ }
        }
        if (nodeCount === 0 && fs.existsSync(legacyStats)) {
          try {
            var legacyStatsSt = fs.statSync(legacyStats);
            if (legacyStatsSt.size <= 1024 * 1024) {
              var gStats = JSON.parse(fs.readFileSync(legacyStats, 'utf-8'));
              nodeCount = gStats.nodes || 0;
            }
          } catch (e) { /* ignore */ }
        }
        if (nodeCount > 100) {
          // Pre-resolve top-5 relevant files for the user's prompt — the LLM
          // sees the answer inline instead of being told to call a tool.
          var suggestions = hCtx.getMonographSuggestions(prompt, 5);

          // Boost recently-edited files to the top of pre-resolve suggestions.
          // Even when the FTS index hasn't caught up to the latest edits, the
          // LLM should see the files it just modified as the primary context.
          try {
            var recentEditsForRoute = hCtx._getRecentEdits();
            if (recentEditsForRoute.length > 0) {
              // Extract prompt keywords for relevance gating
              var promptWords = (prompt || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
              var promptWordSet = {};
              for (var pw = 0; pw < promptWords.length; pw++) promptWordSet[promptWords[pw]] = 1;

              var existingFiles = {};
              for (var se = 0; se < suggestions.length; se++) existingFiles[suggestions[se].file || ''] = 1;

              var editBoosts = [];
              for (var re = 0; re < recentEditsForRoute.length && editBoosts.length < 2; re++) {
                var reFile = recentEditsForRoute[re].file;
                // Skip if already in suggestions
                if (existingFiles[reFile]) continue;
                var reName = path.basename(reFile, path.extname(reFile)).toLowerCase();
                // Only boost if filename shares a keyword with the prompt OR the edit is very recent (<3 min)
                var veryRecent = (Date.now() - recentEditsForRoute[re].editedAt) < 3 * 60 * 1000;
                var editMatches = promptWordSet[reName] || veryRecent;
                if (editMatches) {
                  editBoosts.push({ name: path.basename(reFile), label: 'File', file: reFile, deg: 0, _editBoost: true });
                }
              }
              if (editBoosts.length > 0) {
                suggestions = editBoosts.concat(suggestions).slice(0, 5);
              }
            }
          } catch (e) { /* non-fatal */ }

          if (suggestions.length > 0) {
            console.log('\n[MONOGRAPH] ' + nodeCount + ' nodes indexed. Top files for this task (pre-resolved from graph):');
            for (var si = 0; si < suggestions.length; si++) {
              var s = suggestions[si];
              var editTag = s._editBoost ? ' ✎' : '';
              console.log('  · ' + s.name + ' [' + s.label + '] — ' + (s.file || '') + (s.deg ? ' (deg ' + s.deg + ')' : '') + editTag);
            }
            console.log('  Use mcp__monomind__monograph_query / monograph_impact for deeper drill-down.');
            hCtx._recordGraphTelemetry('preresolve_hit');
          } else {
            console.log('\n[MONOGRAPH] ' + nodeCount + ' nodes indexed. Call mcp__monomind__monograph_suggest first to find relevant files without grepping.');
            hCtx._recordGraphTelemetry('preresolve_miss');
          }
        }
      } catch(e) {}

      // Swarm mode selection is available on-demand via /mastermind slash command.
    } else {
      console.log('[INFO] Router not available, using default routing');
    }

    // Task 22: TeamRoutingModes — only log when an explicit swarm config is present
    try {
      var swarmCfgPath = path.join(CWD, '.monomind', 'swarm-config.json');
      if (fs.existsSync(swarmCfgPath)) {
        var swarmCfgSt = fs.statSync(swarmCfgPath);
        var topology22 = swarmCfgSt.size <= 1024 * 1024 ? (JSON.parse(fs.readFileSync(swarmCfgPath, 'utf-8')).topology || 'mesh') : 'mesh';
        var mode22 = topology22 === 'hierarchical' ? 'route' : 'coordinate';
        console.log('[ROUTING_MODE] topology=' + topology22 + ' → mode=' + mode22);
      }
    } catch (e) { /* non-fatal */ }
  }
};

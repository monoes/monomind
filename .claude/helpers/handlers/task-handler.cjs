'use strict';
// Extracted from hook-handler.cjs — receives hCtx from dispatcher.
// Handles 'pre-task' and 'post-task' hook events.
// See route-handler.cjs for full hCtx field documentation.

const path = require('path');
const fs = require('fs');

module.exports = {
  handlePreTask: async function(hCtx) {
    var hookInput = hCtx.hookInput;
    var prompt = hCtx.prompt;
    var router = hCtx.router;
    var session = hCtx.session;
    var CWD = hCtx.CWD;

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

    // Monograph impact — detect changed files and surface their dependents
    try {
      var mgDbPath1 = path.join(CWD, '.monomind', 'monograph.db');
      if (fs.existsSync(mgDbPath1)) {
        var changedFiles1 = await new Promise(function(resolve) {
          require('child_process').exec(
            'git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null',
            { cwd: CWD, timeout: 3000 },
            function(err, stdout) { resolve(err ? '' : (stdout || '').trim()); }
          );
        });
        if (changedFiles1) {
          var mgMod1 = null;
          mgMod1 = hCtx._requireMonograph();
          if (mgMod1 && mgMod1.openDb) {
            var db1 = mgMod1.openDb(mgDbPath1);
            try {
              var fileList1 = changedFiles1.split('\n').filter(Boolean).slice(0, 8);
              var impacted1 = [];
              for (var fi = 0; fi < fileList1.length; fi++) {
                var fBase = path.basename(fileList1[fi]);
                var fNode = db1.prepare("SELECT id, name, label FROM nodes WHERE file_path LIKE ? LIMIT 1").get('%' + fBase);
                if (fNode) {
                  var fImporters = db1.prepare(
                    'SELECT n2.name FROM edges e JOIN nodes n2 ON n2.id = e.source_id WHERE e.target_id = ? LIMIT 5'
                  ).all(fNode.id);
                  var entry = fNode.name + ' (' + fNode.label + ')';
                  if (fImporters.length) entry += ' ← ' + fImporters.map(function(i){ return i.name; }).join(', ');
                  impacted1.push(entry);
                }
              }
              if (impacted1.length > 0) {
                console.log('[MONOGRAPH_IMPACT] Changed files and their dependents: ' + impacted1.join(' | '));
              }

              // Effective blast radius — second pass using first impacted node
              try {
                if (fileList1.length > 0 && mgMod1.effectiveBlastRadius) {
                  var firstFile1 = path.basename(fileList1[0]);
                  var firstNode1 = db1.prepare("SELECT id, name, label FROM nodes WHERE file_path LIKE ? LIMIT 1").get('%' + firstFile1);
                  if (firstNode1) {
                    var blastResults1 = mgMod1.effectiveBlastRadius(db1, firstNode1.id, { maxDepth: 4 });
                    if (blastResults1 && blastResults1.length > 0) {
                      var bwdCount1 = blastResults1.filter(function(r){ return r.direction === 'backward' || r.direction === 'both'; }).length;
                      var fwdCount1 = blastResults1.filter(function(r){ return r.direction === 'forward' || r.direction === 'both'; }).length;
                      var topBlast1 = blastResults1.slice(0, 8).map(function(r){
                        return '[' + r.direction + ':' + r.hops + '] ' + r.nodeName + ' (' + r.nodeLabel + ')';
                      });
                      console.log('[MONOGRAPH_BLAST_RADIUS] Node: ' + firstNode1.name + ' | forward=' + fwdCount1 + ' backward=' + bwdCount1 + ' | ' + topBlast1.join(', '));
                    }
                  }
                }
              } catch(blastErr) { /* non-fatal */ }
            } finally { if (mgMod1.closeDb) mgMod1.closeDb(db1); }
          }
        }
      }
    } catch(e) { /* non-fatal */ }

    // Bridge to @monomind/hooks registry — fires Tasks 26 (PromptAssembler) and any other PreTask hooks
    var _hooksModule = hCtx._hooksModule;
    if (_hooksModule && _hooksModule.executeHooks && _hooksModule.HookEvent) {
      try {
        await _hooksModule.executeHooks(_hooksModule.HookEvent.PreTask, {
          task: typeof prompt === 'string' ? { description: prompt, id: hookInput.taskId || '' } : null,
          sessionId: hookInput.sessionId || hookInput.session_id || 'default',
        }, { continueOnError: true, timeout: 2000 });
      } catch (e) { /* non-fatal */ }
    }
  },

  handlePostTask: async function(hCtx) {
    var hookInput = hCtx.hookInput;
    var prompt = hCtx.prompt;
    var intelligence = hCtx.intelligence;
    var CWD = hCtx.CWD;

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
    var _hooksModule = hCtx._hooksModule;
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
          var adrDir = path.join(CWD, adrCfg.directory || 'docs/adrs');
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
  }
};

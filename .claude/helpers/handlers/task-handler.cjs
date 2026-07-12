'use strict';
// Extracted from hook-handler.cjs — receives hCtx from dispatcher.
// Handles 'pre-task' and 'post-task' hook events.
// See route-handler.cjs for full hCtx field documentation.

const path = require('path');
const fs = require('fs');
const { purgeStaleRegistrations } = require('../utils/agent-registrations.cjs');

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

    // monolean: removed per-subagent redundancies:
    // - Re-routing (already done by route handler on parent prompt)
    // - AUTOMEM pattern recall (marginal value, 2 similarity searches per spawn)
    // - PromptVersioning experiments (unused feature)
    // - Monograph blast radius (already shown by post-edit hook on actual changes)

    // Bridge to @monomind/hooks registry — fires Tasks 26 (PromptAssembler) and any other PreTask hooks.
    // Each hook event runs in a fresh process, so hCtx._hooksModule set by session-restore in an
    // earlier invocation is never visible here — must (re)load lazily via _ensureHooksModule().
    var _hooksModule = hCtx._hooksModule || (hCtx._ensureHooksModule ? await hCtx._ensureHooksModule() : null);
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
        intelligence.feedback(taskSuccess);
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
        // Also purge any stragglers older than 30 min (shared with agent-start-handler.cjs)
        const remaining = purgeStaleRegistrations(regDir) || 0;
        const _actPath = path.join(CWD, '.monomind', 'metrics', 'swarm-activity.json');
        let _prevLastActive = 0;
        try { var _actSt = fs.statSync(_actPath); if (_actSt.size < 65536) { _prevLastActive = (JSON.parse(fs.readFileSync(_actPath, 'utf-8'))?.swarm?.lastActive) || 0; } } catch { /* ignore */ }
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

    // Bridge to @monomind/hooks registry — fires Tasks 39 (SpecializationScorer) and any other PostTask hooks.
    // Each hook event runs in a fresh process, so hCtx._hooksModule set by session-restore in an
    // earlier invocation is never visible here — must (re)load lazily via _ensureHooksModule().
    var _hooksModule = hCtx._hooksModule || (hCtx._ensureHooksModule ? await hCtx._ensureHooksModule() : null);
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
          var haltSt = fs.statSync(haltFile);
          var haltLines = haltSt.size < 1048576 ? fs.readFileSync(haltFile, 'utf-8').trim().split('\n').filter(Boolean) : [];
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

    // Record whether this task's outcome matched a recalled memory pattern,
    // so future pattern recall can be scored for usefulness.
    try {
      var intelligence = hCtx.intelligence;
      if (intelligence && intelligence.recordMemoryDecision) {
        var agentSlug = hookInput.agentSlug || hookInput.agent_slug || 'unknown';
        var taskDesc = typeof prompt === 'string' ? prompt : hookInput.description || '';
        await Promise.resolve(intelligence.recordMemoryDecision({
          taskDescription: taskDesc.substring(0, 200),
          agent: agentSlug,
          success: taskSuccess,
          latencyMs: hookInput.latencyMs || hookInput.latency_ms || 0,
        }));
      }
    } catch (e) { /* non-fatal — LOG is advisory */ }

    // ── ADR Auto-Generation ────────────────────────────────────────────────
    // When adr.autoGenerate is true and task involved architect-level work,
    // create an ADR stub in the configured directory
    try {
      var settingsPath = path.join(CWD, '.claude', 'settings.json');
      var adrCfg = {};
      if (fs.existsSync(settingsPath)) {
        var settingsSt = fs.statSync(settingsPath);
        if (settingsSt.size < 524288) {
          var s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          adrCfg = (s.monomind && s.monomind.adr) || {};
        }
      }
      if (adrCfg.autoGenerate) {
        var taskAgent = hookInput.agentSlug || hookInput.agent_slug || '';
        var taskDescAdr = (typeof prompt === 'string' ? prompt : hookInput.description || '').toLowerCase();
        var isArchitectLevel = ['architect', 'system-architect', 'software-architect'].includes(taskAgent)
          || /\b(architecture|design decision|adr|trade-?off|migration strategy)\b/.test(taskDescAdr);
        if (isArchitectLevel && taskDescAdr.length > 30) {
          // Guard adrCfg.directory against path traversal outside CWD
          var rawAdrDir = typeof adrCfg.directory === 'string' ? adrCfg.directory : 'docs/adrs';
          var resolvedAdrDir = path.resolve(CWD, rawAdrDir);
          if (!resolvedAdrDir.startsWith(CWD + path.sep) && resolvedAdrDir !== CWD) { throw new Error('adr.directory outside project'); }
          var adrDir = resolvedAdrDir;
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

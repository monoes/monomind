'use strict';
// Extracted from hook-handler.cjs — handles 'agent-start' (SubagentStart) hook event.
// Receives hCtx from dispatcher. See route-handler.cjs for hCtx field docs.

const path = require('path');
const fs = require('fs');
const { purgeStaleRegistrations } = require('../utils/agent-registrations.cjs');
const { cleanEntries, atomicWriteFileSync, withLock } = require('../utils/fs-helpers.cjs');

module.exports = {
  handle: async function(hCtx) {
    var hookInput = hCtx.hookInput;
    var CWD = hCtx.CWD;
    var _openMonographDb = hCtx._openMonographDb;
    var getMonographSuggestions = hCtx.getMonographSuggestions;

    // Register this agent so the statusline can count active agents.
    const regDir = path.join(CWD, '.monomind', 'agents', 'registrations');
    try {
      fs.mkdirSync(regDir, { recursive: true });
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const regFile = path.join(regDir, 'agent-' + id + '.json');
      // P3-15: also stamp the agent's type/slug so handlePostTask (task-handler.cjs)
      // can correlate a completion event back to THIS registration instead of
      // blindly popping the oldest file — the registration previously carried no
      // identity beyond a random id, so post-task had nothing to match against.
      // Same field precedence as the last-dispatch.json write below, computed
      // early so both writers agree on the agent's identity.
      const MAX_TYPE_LEN = 128;
      const agentType = String(hookInput.subagent_type || hookInput.agentType || hookInput.agent_type || hookInput.agentSlug || 'unknown').slice(0, MAX_TYPE_LEN);
      fs.writeFileSync(regFile, JSON.stringify({
        agentId: id,
        agentType: agentType,
        startedAt: new Date().toISOString(),
        pid: process.pid,
      }));
      // Purge stragglers older than 30 min on every agent-start too — not just
      // on TeammateIdle/TaskCompleted (task-handler.cjs) — since sessions that
      // never emit those events would otherwise leak registrations forever.
      const activeAfterPurge = purgeStaleRegistrations(regDir);
      // Refresh swarm-activity.json within the 5-min staleness window.
      const activityDir = path.join(CWD, '.monomind', 'metrics');
      fs.mkdirSync(activityDir, { recursive: true });
      const activityPath = path.join(activityDir, 'swarm-activity.json');
      const MAX_AGENTS = 1000;
      const active = Math.min(
        activeAfterPurge != null ? activeAfterPurge : cleanEntries(regDir, f => f.endsWith('.json')).length,
        MAX_AGENTS
      );
      // P2-21: swarm-activity.json is written by both this handler and
      // task-handler.cjs's handlePostTask, concurrently (Claude Code fires
      // hook events for parallel tool calls in one message). The old
      // read-prevLastActive-then-write was a lost-update race — two
      // processes could both read the same prevLastActive before either
      // wrote, so whichever wrote last silently erased the other's peak.
      // Share one lock file with task-handler.cjs so the read-merge-write
      // cycle is a single critical section across both writers.
      withLock(activityPath + '.lock', function() {
        // Preserve lastActive (peak) so statusline shows non-zero after completion.
        let prevLastActive = 0;
        try {
          const MAX_ACTIVITY = 64 * 1024; // 64 KiB
          var actStat = fs.statSync(activityPath);
          if (actStat.size <= MAX_ACTIVITY) {
            prevLastActive = (JSON.parse(fs.readFileSync(activityPath, 'utf-8'))?.swarm?.lastActive) || 0;
          }
        } catch { /* ignore */ }
        atomicWriteFileSync(activityPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          swarm: {
            active: active > 0,
            agent_count: active,
            coordination_active: active > 0,
            lastActive: Math.max(active, prevLastActive),
          },
        }));
      }, 5000);

      // Write last-dispatch.json so the route handler can suppress redundant
      // suggestions on the next turn when the same agent type is recommended.
      const MAX_DESC_LEN = 500;
      const agentDesc = String(hookInput.description || hookInput.prompt_description || '').slice(0, MAX_DESC_LEN);
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

    // monolean: compact single-line graph context instead of multi-line map.
    // Subagents get task-relevant files only — god nodes are noise for a focused task.
    try {
      var subAgentDesc = hookInput.description || hookInput.prompt_description || '';
      if (subAgentDesc && subAgentDesc.length > 8) {
        var subHints = getMonographSuggestions(subAgentDesc, 3);
        if (subHints.length > 0) {
          var parts = subHints.map(function(s) {
            return s.name + ' [' + s.label + '] — ' + (s.file || '');
          });
          console.log('[MONOGRAPH] Top files: ' + parts.join(' · '));
        }
      }
    } catch (e) { /* non-fatal */ }

    // Bridge to @monoes/hooks registry — fires AgentSpawn hooks (was previously never
    // wired: HookEvent.AgentSpawn existed but no CJS handler ever fired it).
    try {
      var _hooksModule = hCtx._ensureHooksModule ? await hCtx._ensureHooksModule() : null;
      if (_hooksModule && _hooksModule.executeHooks && _hooksModule.HookEvent) {
        var agentTypeBridge = String(hookInput.subagent_type || hookInput.agentType || hookInput.agent_type || hookInput.agentSlug || 'unknown');
        var agentDescBridge = String(hookInput.description || hookInput.prompt_description || '');
        // Must be awaited (bounded by runWithTimeout, 1500ms) — hook-handler.cjs's
        // main().finally(() => process.exit(...)) reaps any unawaited fire-and-forget
        // promise before it does real I/O. See session-restore-handler.cjs's
        // SessionStart bridge for the reference pattern this mirrors.
        await hCtx.runWithTimeout(function() {
          return _hooksModule.executeHooks(_hooksModule.HookEvent.AgentSpawn, {
            agent: {
              id: hookInput.agentId || hookInput.agent_id || (agentTypeBridge + '-' + Date.now()),
              type: agentTypeBridge,
              description: agentDescBridge.slice(0, 500),
            },
          }, { continueOnError: true, timeout: 1500 });
        }, '@monoes/hooks.AgentSpawn');
      }
    } catch (e) { /* non-fatal */ }
  },
};

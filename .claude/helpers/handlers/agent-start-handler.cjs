'use strict';
// Extracted from hook-handler.cjs — handles 'agent-start' (SubagentStart) hook event.
// Receives hCtx from dispatcher. See route-handler.cjs for hCtx field docs.

const path = require('path');
const fs = require('fs');

module.exports = {
  handle: function(hCtx) {
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
      fs.writeFileSync(regFile, JSON.stringify({
        agentId: id,
        startedAt: new Date().toISOString(),
        pid: process.pid,
      }));
      // Refresh swarm-activity.json within the 5-min staleness window.
      const activityDir = path.join(CWD, '.monomind', 'metrics');
      fs.mkdirSync(activityDir, { recursive: true });
      const activityPath = path.join(activityDir, 'swarm-activity.json');
      const active = fs.readdirSync(regDir).filter(f => f.endsWith('.json')).length;
      // Preserve lastActive (peak) so statusline shows non-zero after completion.
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

      // Write last-dispatch.json so the route handler can suppress redundant
      // suggestions on the next turn when the same agent type is recommended.
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

    // Subagent context inheritance — inject graph god nodes + parent's last
    // pre-resolved suggestions so the spawned agent inherits spatial map.
    try {
      var subDb = _openMonographDb();
      if (subDb) {
        try {
          var godRows = subDb.prepare(
            "SELECT n.name, n.label, n.file_path AS file, " +
            "(SELECT COUNT(*) FROM edges WHERE source_id=n.id OR target_id=n.id) AS deg " +
            "FROM nodes n " +
            "WHERE n.label NOT IN ('Concept') AND n.file_path IS NOT NULL AND n.file_path != '' " +
            "ORDER BY deg DESC LIMIT 5"
          ).all();
          if (godRows.length > 0) {
            console.log('[MONOGRAPH_SUBAGENT_CTX] Graph map inherited from parent:');
            for (var gi = 0; gi < godRows.length; gi++) {
              var gr = godRows[gi];
              console.log('  · ' + gr.name + ' [' + gr.label + '] — ' + (gr.file || '') + ' (deg ' + gr.deg + ')');
            }
            try {
              var subAgentDesc = hookInput.description || hookInput.prompt_description || '';
              if (subAgentDesc && subAgentDesc.length > 8) {
                var subHints = getMonographSuggestions(subAgentDesc, 3);
                if (subHints.length > 0) {
                  console.log('  Top files for this subagent task:');
                  for (var si2 = 0; si2 < subHints.length; si2++) {
                    var sh = subHints[si2];
                    console.log('    · ' + sh.name + ' [' + sh.label + '] — ' + (sh.file || ''));
                  }
                }
              }
            } catch (_) {}
            console.log('  Use mcp__monomind__monograph_suggest / monograph_query in this subagent before grepping.');
          }
        } catch (e) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }

    console.log('[OK] Agent registered');
  },
};

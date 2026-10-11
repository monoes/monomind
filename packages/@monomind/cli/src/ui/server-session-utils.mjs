import path from 'node:path';
import {
  collectAgents,
  collectHooks,
  collectKnowledge,
  collectMemory,
  collectMetrics,
  collectProject,
  collectSessions,
  collectSystem,
  collectTokens,
} from './collector.mjs';

// ─── Session JSONL parser ────────────────────────────────────────────────────
function categorizeTool(name) {
  if (['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS'].includes(name)) return 'file';
  if (name === 'Bash') return 'bash';
  if (['Agent', 'Task'].includes(name)) return 'agent';
  if (name.startsWith('mcp__monomind__memory') || name.startsWith('mcp__monomind__agentdb'))
    return 'memory';
  if (['WebFetch', 'WebSearch'].includes(name)) return 'web';
  if (name === 'TodoWrite' || name === 'TodoRead') return 'task';
  if (name === 'Skill') return 'skill';
  if (name === 'ToolSearch') return 'search';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function parseSessionLines(lines) {
  const events = [];
  const _agentDepth = 0;
  const toolMap = new Map(); // id → tool event index

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const type = entry.type;
    const ts = entry.timestamp || null;
    const uuid = entry.uuid || null;

    if (type === 'user') {
      const content = entry.message?.content;
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text)
          .join('');
      }
      if (text && text.length > 0) {
        events.push({ kind: 'user', text: text.slice(0, 500), uuid, ts });
      }
    } else if (type === 'assistant') {
      const content = entry.message?.content || [];
      for (const block of Array.isArray(content) ? content : []) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'thinking') {
          events.push({ kind: 'thinking', text: (block.thinking || '').slice(0, 200), uuid, ts });
        } else if (block.type === 'text') {
          const t = (block.text || '').trim();
          if (t) events.push({ kind: 'text', text: t.slice(0, 600), uuid, ts });
        } else if (block.type === 'tool_use') {
          const cat = categorizeTool(block.name);
          const label = buildToolLabel(block.name, block.input || {});
          const idx = events.length;
          const ev = { kind: 'tool', name: block.name, cat, label, id: block.id, uuid, ts };
          if (cat === 'agent') {
            ev.subagent = block.input?.subagent_type || block.input?.description || '?';
            ev.background = !!block.input?.run_in_background;
          }
          events.push(ev);
          if (block.id) toolMap.set(block.id, idx);
        }
      }
    } else if (type === 'tool') {
      const content = entry.message?.content || [];
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type !== 'tool_result') continue;
        const resultText = Array.isArray(block.content)
          ? block.content
              .filter((b) => b && b.type === 'text')
              .map((b) => b.text)
              .join('')
              .slice(0, 400)
          : String(block.content || '').slice(0, 400);
        const isError = !!block.is_error;
        const toolIdx = toolMap.get(block.tool_use_id);
        events.push({
          kind: 'tool_result',
          tool_use_id: block.tool_use_id,
          text: resultText,
          isError,
          toolIdx,
          uuid,
          ts,
        });
      }
    }
  }
  return events;
}

function buildToolLabel(name, input) {
  if (name === 'Read') return input.file_path ? `Read ${path.basename(input.file_path)}` : 'Read';
  if (name === 'Write')
    return input.file_path ? `Write ${path.basename(input.file_path)}` : 'Write';
  if (name === 'Edit') return input.file_path ? `Edit ${path.basename(input.file_path)}` : 'Edit';
  if (name === 'Bash') return (input.description || input.command || 'Bash').slice(0, 60);
  if (name === 'Grep') return `Grep ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Glob') return `Glob ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Agent' || name === 'Task')
    return `→ ${input.subagent_type || input.description || 'agent'}`;
  if (name === 'WebFetch') return `Fetch ${(input.url || '').slice(0, 50)}`;
  if (name === 'WebSearch') return `Search ${(input.query || '').slice(0, 40)}`;
  if (name === 'Skill') return `Skill: ${input.skill || '?'}`;
  if (name.startsWith('mcp__monomind__memory'))
    return name.replace('mcp__monomind__memory_', 'mem:');
  if (name.startsWith('mcp__'))
    return name.replace('mcp__monomind__', '⬡ ').replace('mcp__', '⬡ ').slice(0, 40);
  return name.slice(0, 40);
}

// ─── Section collectors (for /api/section lazy load) ────────────────────────
function buildSectionData(name, dir) {
  const d = path.resolve(dir);
  switch (name) {
    case 'sessions':
      return { sessions: collectSessions(d) };
    case 'agents':
      return { agents: collectAgents(d) };
    case 'tokens':
      return { tokens: collectTokens(d) };
    case 'hooks':
      return { hooks: collectHooks(d) };
    case 'knowledge':
      return { knowledge: collectKnowledge(d) };
    case 'metrics':
      return { metrics: collectMetrics(d) };
    case 'system':
      return { system: collectSystem() };
    case 'memory': {
      const s = collectSessions(d);
      return { sessions: { palace: s.palace }, memory: collectMemory(d) };
    }
    case 'overview':
      return { project: collectProject(d), system: collectSystem() };
    default:
      return {};
  }
}

// Map file path fragment → affected section names
function pathToSections(filename) {
  if (!filename) return null;
  const f = filename.toLowerCase();
  if (f.includes('token')) return ['tokens'];
  if (f.includes('registry') || f.includes('registrations')) return ['agents'];
  if (f.includes('route') || f.includes('worker-dispatch')) return ['hooks'];
  if (f.includes('chunk') || f.includes('skills')) return ['knowledge'];
  if (
    f.includes('auto-memory-store') ||
    f.includes('episodes.jsonl') ||
    (f.includes('/memory/') && f.endsWith('.md'))
  )
    return ['memory', 'sessions'];
  if (f.includes('palace') || f.includes('drawers') || f.includes('identity'))
    return ['memory', 'sessions'];
  if (f.includes('consolidation')) return ['metrics', 'memory'];
  if (
    f.includes('ddd') ||
    f.includes('audit') ||
    f.includes('codebase-map') ||
    f.includes('security-audit') ||
    f.includes('performance')
  )
    return ['metrics'];
  if (f.endsWith('.jsonl') || f.includes('sessions')) return ['sessions'];
  return ['sessions', 'agents', 'tokens', 'hooks'];
}

export { buildSectionData, buildToolLabel, categorizeTool, parseSessionLines, pathToSections };

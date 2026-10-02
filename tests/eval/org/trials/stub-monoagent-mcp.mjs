#!/usr/bin/env node
// Phase 0 recording stub for a role's mono-agent tool provider (org sections
// spec, section 9). It serves the exact tool list captured from the real
// `monoagentcli mcp` grant, so the role's tool surface is unchanged, but it
// never runs a workflow:
//   - outbound tools (posts, DMs, comments) append the full call to the log
//     and report a started run that later reads as succeeded;
//   - read tools replay recorded production outputs in call order, or return
//     the same failure shape production got when nothing was recorded.
// Usage: stub-monoagent-mcp.mjs <config.json> <calls.jsonl>
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const [configPath, logPath] = process.argv.slice(2);
if (!configPath || !logPath) {
  process.stderr.write('usage: stub-monoagent-mcp.mjs <config.json> <calls.jsonl>\n');
  process.exit(2);
}
/** { initialize, tools, outbound: string[], async: string[], replay: {tool: string[]} } */
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const outbound = new Set(config.outbound);
const asyncTools = new Set(config.async);
const replayed = new Map(); // tool -> next replay index
const runs = new Map(); // execution_id -> result text for automation_status/output

const role = process.env.MONOMIND_ORG_ROLE ?? '';
const record = (entry) =>
  appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), role, ...entry })}\n`);
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const text = (s, isError = false) => ({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) });
const runText = (o) => JSON.stringify(o, null, 2);

function call(name, args) {
  if (name === 'automation_status' || name === 'automation_output') {
    const id = String(args?.execution_id ?? '');
    record({ tool: name, input: args });
    return text(runs.get(id) ?? runText({ error: `unknown execution_id "${id}"`, status: 'failed' }));
  }
  const execution_id = randomUUID();
  if (outbound.has(name)) {
    record({ tool: name, input: args, outbound: true, execution_id });
    const done = runText({ execution_id, output: '{"ok":true}', status: 'success' });
    runs.set(execution_id, done);
    return text(asyncTools.has(name) ? runText({ execution_id, status: 'running' }) : done);
  }
  const outputs = config.replay?.[name] ?? [];
  let result;
  if (outputs.length > 0) {
    const i = replayed.get(name) ?? 0;
    replayed.set(name, i + 1);
    result = { execution_id, output: outputs[i % outputs.length], status: 'success' };
  } else {
    result = { error: `node (${name}): no data available`, execution_id, status: 'failed' };
  }
  record({ tool: name, input: args, replay: outputs.length > 0, execution_id });
  const body = runText(result);
  runs.set(execution_id, body);
  return text(asyncTools.has(name) ? runText({ execution_id, status: 'running' }) : body);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notifications need no reply
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return reply(config.initialize);
    case 'tools/list':
      return reply({ tools: config.tools });
    case 'tools/call':
      return reply(call(msg.params?.name, msg.params?.arguments ?? {}));
    case 'ping':
      return reply({});
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
});

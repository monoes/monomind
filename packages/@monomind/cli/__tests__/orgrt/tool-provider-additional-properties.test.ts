// packages/@monomind/cli/__tests__/orgrt/tool-provider-additional-properties.test.ts
/**
 * #325 — a provider tool's top-level `additionalProperties` must survive to
 * `tools/call`. The shape built from `properties` alone made every runtime's
 * zod object strip unlisted keys, so `{"a":1}` reached the provider as `{}`.
 *
 * A real stdio MCP provider echoes back the arguments it receives; the tools
 * go through the fence path (executeToolCall), the Claude SDK's in-process MCP
 * server, and the Vercel input schema.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ClaudeAgentRunner, type OrgToolDef } from '../../src/orgrt/agent-runner.js';
import { buildToolProtocol, executeToolCall, toolInputSchema } from '../../src/orgrt/tool-fence.js';
import { jsonSchemaCatchall, ToolProviderHub } from '../../src/orgrt/tool-providers.js';

const SERVER_SCRIPT = `
import readline from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const tools = [
  { name: 'echo', description: 'open', inputSchema: { type: 'object', additionalProperties: true } },
  { name: 'implicit', description: 'no keyword', inputSchema: { type: 'object', properties: { n: { type: 'integer' } } } },
  { name: 'strict', description: 'closed', inputSchema: { type: 'object', additionalProperties: false, properties: { n: { type: 'integer' } } } },
  { name: 'typed', description: 'string extras', inputSchema: { type: 'object', additionalProperties: { type: 'string' }, properties: { n: { type: 'integer' } }, required: ['n'] } },
];
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } });
  else if (msg.method === 'tools/list') send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  else if (msg.method === 'tools/call') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(msg.params.arguments) }] } });
  else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no' } });
});
`;

let root: string;
let hub: ToolProviderHub;
let tools: OrgToolDef[];
const byName = (n: string) => tools.find((t) => t.name === `echo_prov__${n}`)!;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tp-addl-'));
  const script = join(root, 'provider.mjs');
  writeFileSync(script, SERVER_SCRIPT);
  hub = new ToolProviderHub();
  const set = await hub.buildRoleTools({
    ctx: { org: 'o', run: 'r', role: 'lead', root },
    providers: [{ kind: 'mcp-stdio', name: 'echo-prov', command: process.execPath, args: [script] } as any],
    trace: () => ({ chain_id: 'chn_test', hop: 0 }) as any,
    cwd: root,
  });
  tools = set.tools;
});

afterAll(() => {
  hub.closeAll();
  rmSync(root, { recursive: true, force: true });
});

describe('#325 provider tool additionalProperties', () => {
  it('fence path: additionalProperties true passes unlisted keys to tools/call', async () => {
    expect(await executeToolCall(tools, { name: 'echo_prov__echo', arguments: { a: 1 } })).toBe('{"a":1}');
  });

  it('fence path: an absent additionalProperties keyword keeps unlisted keys too', async () => {
    expect(await executeToolCall(tools, { name: 'echo_prov__implicit', arguments: { n: 2, a: 1 } })).toBe(
      '{"n":2,"a":1}',
    );
  });

  it('fence path: additionalProperties false still strips unlisted keys', async () => {
    expect(await executeToolCall(tools, { name: 'echo_prov__strict', arguments: { n: 2, a: 1 } })).toBe('{"n":2}');
  });

  it('listed properties are still validated, and a typed additionalProperties validates the extras', async () => {
    expect(await executeToolCall(tools, { name: 'echo_prov__strict', arguments: { n: 'x' } })).toMatch(
      /^ERROR: invalid arguments for echo_prov__strict: n /,
    );
    expect(await executeToolCall(tools, { name: 'echo_prov__typed', arguments: { a: 'b' } })).toMatch(
      /^ERROR: invalid arguments for echo_prov__typed: n /,
    );
    expect(await executeToolCall(tools, { name: 'echo_prov__typed', arguments: { n: 1, a: 2 } })).toMatch(
      /^ERROR: invalid arguments for echo_prov__typed: a /,
    );
    expect(await executeToolCall(tools, { name: 'echo_prov__typed', arguments: { n: 1, a: 'b' } })).toBe(
      '{"n":1,"a":"b"}',
    );
  });

  it('fence protocol advertises that the open tool takes other keys', () => {
    const protocol = buildToolProtocol(tools);
    expect(protocol).toContain('**echo_prov__echo**(...other keys)');
    expect(protocol).toContain('**echo_prov__strict**(n: optional number)');
  });

  it('Vercel input schema keeps unlisted keys, strict tool strips them', () => {
    expect(toolInputSchema(byName('echo')).parse({ a: 1 })).toEqual({ a: 1 });
    expect(toolInputSchema(byName('strict')).parse({ n: 1, a: 1 })).toEqual({ n: 1 });
  });

  it('jsonSchemaCatchall: false → none, true/absent → unknown, object → typed', () => {
    expect(jsonSchemaCatchall({ type: 'object', additionalProperties: false })).toBeUndefined();
    expect(jsonSchemaCatchall({ type: 'object' })).toBeInstanceOf(z.ZodUnknown);
    expect(jsonSchemaCatchall({ type: 'object', additionalProperties: true })).toBeInstanceOf(z.ZodUnknown);
    expect(jsonSchemaCatchall({ additionalProperties: { type: 'string' } })).toBeInstanceOf(z.ZodString);
  });

  it('Claude SDK path: the in-process MCP server passes unlisted keys and advertises them', async () => {
    let options: any;
    const runner = new ClaudeAgentRunner(((args: any) => {
      options = args.options;
      return (async function* () {})();
    }) as any);
    const stream = runner.run({
      tools,
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: root,
      env: {},
      maxTurns: 1,
    } as any);
    for await (const _ of stream) {
      // drain
    }
    // The MCP server's own request handlers: the path a real tools/call takes.
    const server = (options.mcpServers.org.instance as any).server;
    const handler = (method: string) => server._requestHandlers.get(method);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await handler('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {})).content[0].text;

    expect(await call('echo_prov__echo', { a: 1 })).toBe('{"a":1}');
    expect(await call('echo_prov__strict', { n: 2, a: 1 })).toBe('{"n":2}');
    expect(await call('echo_prov__strict', { n: 'x' })).toMatch(/Input validation error/);

    const listed = (await handler('tools/list')({ method: 'tools/list', params: {} }, {})).tools;
    const echo = listed.find((t: { name: string }) => t.name === 'echo_prov__echo');
    const strict = listed.find((t: { name: string }) => t.name === 'echo_prov__strict');
    expect(echo.inputSchema.additionalProperties).not.toBe(false);
    expect(echo.inputSchema.additionalProperties).toBeDefined();
    expect(strict.inputSchema.properties).toHaveProperty('n');
  });
});

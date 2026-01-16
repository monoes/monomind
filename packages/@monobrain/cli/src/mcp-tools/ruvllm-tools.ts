/**
 * RuVector LLM WASM MCP Tools
 *
 * Exposes @ruvector/ruvllm-wasm operations via MCP protocol.
 * All tools gracefully degrade when the WASM package is not installed.
 */

import type { MCPTool } from './types.js';
import type { ChatMessage } from '../ruvector/ruvllm-wasm.js';

async function loadRuvllmWasm() {
  return import('../ruvector/ruvllm-wasm.js');
}

export const ruvllmWasmTools: MCPTool[] = [
  {
    name: 'ruvllm_status',
    description: 'Get ruvllm-wasm availability and initialization status.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      try {
        const mod = await loadRuvllmWasm();
        const status = await mod.getRuvllmStatus();
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_hnsw_create',
    description: 'Create a WASM HNSW router for semantic pattern routing. Max ~11 patterns (v2.0.1 limit).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dimensions: { type: 'number', description: 'Embedding dimensions (e.g., 64, 128, 384)' },
        maxPatterns: { type: 'number', description: 'Max patterns capacity (limit ~11 in v2.0.1)' },
        efSearch: { type: 'number', description: 'HNSW ef search parameter (higher = more accurate, slower)' },
      },
      required: ['dimensions', 'maxPatterns'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const mod = await loadRuvllmWasm();
        const router = await mod.createHnswRouter({
          dimensions: args.dimensions as number,
          maxPatterns: args.maxPatterns as number,
          efSearch: args.efSearch as number | undefined,
        });
        // Store router in module-level registry
        const id = `hnsw-${Date.now().toString(36)}`;
        hnswRouters.set(id, router);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, routerId: id, dimensions: args.dimensions, maxPatterns: args.maxPatterns }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_hnsw_add',
    description: 'Add a pattern to an HNSW router. Embedding must match router dimensions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        routerId: { type: 'string', description: 'HNSW router ID from ruvllm_hnsw_create' },
        name: { type: 'string', description: 'Pattern name/label' },
        embedding: { type: 'array', items: { type: 'number' }, description: 'Float array embedding vector' },
        metadata: { type: 'object', description: 'Optional metadata object' },
      },
      required: ['routerId', 'name', 'embedding'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const router = hnswRouters.get(args.routerId as string);
        if (!router) return { content: [{ type: 'text', text: JSON.stringify({ error: `Router not found: ${args.routerId}` }) }], isError: true };
        const embedding = new Float32Array(args.embedding as number[]);
        const ok = router.addPattern({
          name: args.name as string,
          embedding,
          metadata: args.metadata as Record<string, unknown>,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ success: ok, patternCount: router.patternCount() }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_hnsw_route',
    description: 'Route a query embedding to nearest patterns in HNSW index.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        routerId: { type: 'string', description: 'HNSW router ID' },
        query: { type: 'array', items: { type: 'number' }, description: 'Query embedding vector' },
        k: { type: 'number', description: 'Number of nearest neighbors (default: 3)' },
      },
      required: ['routerId', 'query'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const router = hnswRouters.get(args.routerId as string);
        if (!router) return { content: [{ type: 'text', text: JSON.stringify({ error: `Router not found: ${args.routerId}` }) }], isError: true };
        const query = new Float32Array(args.query as number[]);
        const results = router.route(query, (args.k as number) ?? 3);
        return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_sona_create',
    description: 'Create a SONA instant adaptation loop (<1ms adaptation cycles).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hiddenDim: { type: 'number', description: 'Hidden dimension (default: 64)' },
        learningRate: { type: 'number', description: 'Learning rate (default: 0.01)' },
        patternCapacity: { type: 'number', description: 'Max stored patterns' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const mod = await loadRuvllmWasm();
        const sona = await mod.createSonaInstant({
          hiddenDim: args.hiddenDim as number | undefined,
          learningRate: args.learningRate as number | undefined,
          patternCapacity: args.patternCapacity as number | undefined,
        });
        const id = `sona-${Date.now().toString(36)}`;
        sonaInstances.set(id, sona);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, sonaId: id }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_sona_adapt',
    description: 'Run SONA instant adaptation with a quality signal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sonaId: { type: 'string', description: 'SONA instance ID' },
        quality: { type: 'number', description: 'Quality signal (0.0-1.0)' },
      },
      required: ['sonaId', 'quality'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const sona = sonaInstances.get(args.sonaId as string);
        if (!sona) return { content: [{ type: 'text', text: JSON.stringify({ error: `SONA not found: ${args.sonaId}` }) }], isError: true };
        sona.adapt(args.quality as number);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, stats: sona.stats() }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_microlora_create',
    description: 'Create a MicroLoRA adapter (ultra-lightweight LoRA, ranks 1-4).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        inputDim: { type: 'number', description: 'Input dimension' },
        outputDim: { type: 'number', description: 'Output dimension' },
        rank: { type: 'number', description: 'LoRA rank (1-4, default: 2)' },
        alpha: { type: 'number', description: 'LoRA alpha scaling (default: 1.0)' },
      },
      required: ['inputDim', 'outputDim'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const mod = await loadRuvllmWasm();
        const lora = await mod.createMicroLora({
          inputDim: args.inputDim as number,
          outputDim: args.outputDim as number,
          rank: args.rank as number | undefined,
          alpha: args.alpha as number | undefined,
        });
        const id = `lora-${Date.now().toString(36)}`;
        loraInstances.set(id, lora);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, loraId: id }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_microlora_adapt',
    description: 'Adapt MicroLoRA weights with quality feedback.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        loraId: { type: 'string', description: 'MicroLoRA instance ID' },
        quality: { type: 'number', description: 'Quality signal (0.0-1.0)' },
        learningRate: { type: 'number', description: 'Learning rate (default: 0.01)' },
        success: { type: 'boolean', description: 'Whether the adaptation was successful (default: true)' },
      },
      required: ['loraId', 'quality'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const lora = loraInstances.get(args.loraId as string);
        if (!lora) return { content: [{ type: 'text', text: JSON.stringify({ error: `MicroLoRA not found: ${args.loraId}` }) }], isError: true };
        lora.adapt(
          args.quality as number,
          args.learningRate as number | undefined,
          args.success as boolean | undefined,
        );
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, stats: lora.stats() }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_chat_format',
    description: 'Format chat messages using a template (llama3, mistral, chatml, phi, gemma, or auto-detect).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        messages: {
          type: 'array',
          items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } }, required: ['role', 'content'] },
          description: 'Array of {role, content} message objects',
        },
        template: { type: 'string', description: 'Template preset (llama3, mistral, chatml, phi, gemma) or model ID for auto-detection' },
      },
      required: ['messages', 'template'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const mod = await loadRuvllmWasm();
        const messages = args.messages as ChatMessage[];
        const templateStr = args.template as string;

        const presets = ['llama3', 'mistral', 'chatml', 'phi', 'gemma'];
        const template = presets.includes(templateStr)
          ? templateStr as any
          : { modelId: templateStr };

        const formatted = await mod.formatChat(messages, template);
        return { content: [{ type: 'text', text: formatted }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'ruvllm_generate_config',
    description: 'Create a generation config (maxTokens, temperature, topP, etc.) as JSON.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        maxTokens: { type: 'number', description: 'Max tokens to generate' },
        temperature: { type: 'number', description: 'Sampling temperature (note: f32 precision)' },
        topP: { type: 'number', description: 'Top-p sampling' },
        topK: { type: 'number', description: 'Top-k sampling' },
        repetitionPenalty: { type: 'number', description: 'Repetition penalty' },
        stopSequences: { type: 'array', items: { type: 'string' }, description: 'Stop sequences' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const mod = await loadRuvllmWasm();
        const config = await mod.createGenerateConfig(args as any);
        return { content: [{ type: 'text', text: config }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
];

// ── Instance Registries ──────────────────────────────────────

const hnswRouters = new Map<string, Awaited<ReturnType<typeof import('../ruvector/ruvllm-wasm.js').createHnswRouter>>>();
const sonaInstances = new Map<string, Awaited<ReturnType<typeof import('../ruvector/ruvllm-wasm.js').createSonaInstant>>>();
const loraInstances = new Map<string, Awaited<ReturnType<typeof import('../ruvector/ruvllm-wasm.js').createMicroLora>>>();

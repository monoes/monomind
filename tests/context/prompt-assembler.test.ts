/**
 * Tests for the dynamic system prompt assembly pipeline.
 *
 * Uses vitest with --globals (describe/it/expect are ambient).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  PromptAssembler,
  type AssemblyConfig,
} from '../../packages/@monomind/cli/src/context/prompt-assembler.js';
import type {
  ContextProvider,
  RunContext,
} from '../../packages/@monomind/cli/src/context/context-provider.js';
import { GitStateProvider } from '../../packages/@monomind/cli/src/context/git-state-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    agentSlug: 'coder',
    taskDescription: 'implement auth',
    sessionId: 'sess-1',
    metadata: {},
    ...overrides,
  };
}

/** Create a stub provider with a fixed output. */
function stubProvider(
  name: string,
  content: string,
  priority: number,
  opts: { required?: boolean; maxTokens?: number } = {},
): ContextProvider {
  return {
    name,
    priority,
    maxTokens: opts.maxTokens ?? 500,
    required: opts.required ?? false,
    provide: vi.fn().mockResolvedValue(content),
  };
}

/** Create a provider that rejects. */
function failingProvider(name: string, priority: number): ContextProvider {
  return {
    name,
    priority,
    maxTokens: 500,
    required: false,
    provide: vi.fn().mockRejectedValue(new Error('boom')),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptAssembler', () => {
  const basePrompt = 'You are a helpful assistant.';
  // base prompt is ~7 tokens (28 chars / 4)
  const basePromptTokens = Math.ceil(basePrompt.length / 4);

  it('includes all providers when budget is sufficient', async () => {
    const providers = [
      stubProvider('conventions', 'Use TypeScript.', 100),
      stubProvider('prefs', '- style: concise', 90),
      stubProvider('git', 'Branch: main', 60),
    ];

    const assembler = new PromptAssembler({
      maxTotalTokens: 6000,
      basePromptTokens,
      providers,
    });

    const result = await assembler.assemble(basePrompt, makeCtx());

    expect(result.sectionsIncluded).toEqual([
      'conventions',
      'prefs',
      'git',
    ]);
    expect(result.sectionsDropped).toEqual([]);
    expect(result.sectionsTruncated).toEqual([]);
    expect(result.content).toContain('Use TypeScript.');
    expect(result.content).toContain('- style: concise');
    expect(result.content).toContain('Branch: main');
    expect(result.content).toContain(basePrompt);
  });

  it('drops lowest-priority provider when budget is tight', async () => {
    // Each section ~100 tokens = 400 chars.  Budget for context = 150 tokens.
    const longContent = 'x'.repeat(400); // 100 tokens
    const providers = [
      stubProvider('high', longContent, 100),
      stubProvider('low', longContent, 10),
    ];

    const assembler = new PromptAssembler({
      maxTotalTokens: basePromptTokens + 150,
      basePromptTokens,
      providers,
    });

    const result = await assembler.assemble(basePrompt, makeCtx());

    expect(result.sectionsIncluded).toContain('high');
    expect(result.sectionsDropped).toContain('low');
  });

  it('truncates a required provider when it exceeds remaining budget', async () => {
    // Required section is 200 tokens but budget only allows ~50 for context.
    const bigContent = 'R'.repeat(800); // 200 tokens
    const providers = [
      stubProvider('required-section', bigContent, 100, { required: true }),
    ];

    const assembler = new PromptAssembler({
      maxTotalTokens: basePromptTokens + 50,
      basePromptTokens,
      providers,
    });

    const result = await assembler.assemble(basePrompt, makeCtx());

    expect(result.sectionsIncluded).toContain('required-section');
    expect(result.sectionsTruncated).toContain('required-section');
    expect(result.sectionsDropped).toEqual([]);
    // Content should be shorter than the original 800 chars
    const sectionContent = result.content.split('---')[0].trim();
    expect(sectionContent.length).toBeLessThan(800);
  });

  it('gracefully excludes a provider that throws', async () => {
    const providers = [
      stubProvider('good', 'hello', 80),
      failingProvider('bad', 90),
    ];

    const assembler = new PromptAssembler({
      maxTotalTokens: 6000,
      basePromptTokens,
      providers,
    });

    const result = await assembler.assemble(basePrompt, makeCtx());

    expect(result.sectionsIncluded).toEqual(['good']);
    // 'bad' is not in dropped — it was rejected, not budget-dropped
    expect(result.sectionsDropped).not.toContain('bad');
    expect(result.content).toContain('hello');
  });

  it('places base prompt after context sections', async () => {
    const providers = [stubProvider('ctx', 'Context here.', 50)];

    const assembler = new PromptAssembler({
      maxTotalTokens: 6000,
      basePromptTokens,
      providers,
    });

    const result = await assembler.assemble(basePrompt, makeCtx());

    const ctxPos = result.content.indexOf('Context here.');
    const basePos = result.content.indexOf(basePrompt);
    expect(ctxPos).toBeLessThan(basePos);
  });

  it('excludes provider that returns empty content', async () => {
    const providers = [
      stubProvider('filled', 'content', 80),
      stubProvider('empty', '', 90),
    ];

    const assembler = new PromptAssembler({
      maxTotalTokens: 6000,
      basePromptTokens,
      providers,
    });

    const result = await assembler.assemble(basePrompt, makeCtx());

    expect(result.sectionsIncluded).toEqual(['filled']);
    expect(result.content).not.toContain('empty');
  });

  it('sorts sections by priority descending in output', async () => {
    const providers = [
      stubProvider('low', 'lo', 10),
      stubProvider('mid', 'mi', 50),
      stubProvider('high', 'hi', 90),
    ];

    const assembler = new PromptAssembler({
      maxTotalTokens: 6000,
      basePromptTokens,
      providers,
    });

    const result = await assembler.assemble(basePrompt, makeCtx());

    expect(result.sectionsIncluded).toEqual(['high', 'mid', 'low']);

    // In the assembled content, high-priority content appears first
    const hiPos = result.content.indexOf('hi');
    const miPos = result.content.indexOf('mi');
    const loPos = result.content.indexOf('lo');
    expect(hiPos).toBeLessThan(miPos);
    expect(miPos).toBeLessThan(loPos);
  });

  it('GitStateProvider returns fallback when not in a git repo', async () => {
    const provider = new GitStateProvider();
    const ctx = makeCtx({ workingDir: '/tmp/definitely-not-a-repo-xyz' });

    const result = await provider.provide(ctx);

    expect(result).toContain('Git state unavailable');
  });
});

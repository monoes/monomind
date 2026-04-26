/**
 * Dynamic Agent Synthesis Tests — Task 47
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  agentDefinitionSchema,
  SynthesisPromptTemplate,
} from '../../packages/@monomind/hooks/src/synthesis/synthesis-prompt-template.js';
import { EphemeralRegistry } from '../../packages/@monomind/hooks/src/synthesis/ephemeral-registry.js';
import { TTLCleanup } from '../../packages/@monomind/hooks/src/synthesis/ttl-cleanup.js';
import type {
  AgentDefinition,
  SynthesisRequest,
  EphemeralAgentRecord,
} from '../../packages/@monomind/hooks/src/synthesis/types.js';

// ── fs mocks ──

vi.mock('fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ──

function validDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent for dynamic synthesis validation purposes.',
    color: '#ff6600',
    emoji: '🧪',
    vibe: 'experimental',
    tools: ['Read', 'Grep'],
    systemPromptBody:
      'You are a test agent synthesized dynamically. Follow all instructions carefully and report results.',
    tags: ['test', 'synthesis'],
    synthesizedFrom: 'researcher',
    synthesizedAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRecord(overrides: Partial<EphemeralAgentRecord> = {}): EphemeralAgentRecord {
  return {
    slug: 'test-agent',
    filePath: '/tmp/agents/test-agent.md',
    createdAt: new Date('2026-04-01T00:00:00Z'),
    expiresAt: new Date('2026-04-01T01:00:00Z'),
    usageCount: 0,
    avgQualityScore: 0,
    promoted: false,
    synthesisRequestId: 'req-001',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<SynthesisRequest> = {}): SynthesisRequest {
  return {
    requestId: 'req-001',
    taskDescription: 'Analyze security vulnerabilities in the auth module',
    topMatchSlug: 'security-auditor',
    topMatchScore: 0.62,
    existingAgentCount: 60,
    requestedAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  };
}

// ── agentDefinitionSchema ──

describe('agentDefinitionSchema', () => {
  it('accepts a valid agent definition', () => {
    const result = agentDefinitionSchema.safeParse(validDef());
    expect(result.success).toBe(true);
  });

  it('rejects slugs with uppercase letters', () => {
    const result = agentDefinitionSchema.safeParse(validDef({ slug: 'Test-Agent' }));
    expect(result.success).toBe(false);
  });

  it('rejects short systemPromptBody', () => {
    const result = agentDefinitionSchema.safeParse(
      validDef({ systemPromptBody: 'Too short' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects unknown tools', () => {
    const result = agentDefinitionSchema.safeParse(
      validDef({ tools: ['Read', 'MagicWand'] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty tools array', () => {
    const result = agentDefinitionSchema.safeParse(validDef({ tools: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects invalid hex color', () => {
    const result = agentDefinitionSchema.safeParse(validDef({ color: 'red' }));
    expect(result.success).toBe(false);
  });
});

// ── SynthesisPromptTemplate.build ──

describe('SynthesisPromptTemplate.build', () => {
  it('includes the task description in the prompt', () => {
    const request = makeRequest();
    const prompt = SynthesisPromptTemplate.build(request, ['coder', 'tester']);
    expect(prompt).toContain(request.taskDescription);
  });

  it('includes the existing slug list', () => {
    const prompt = SynthesisPromptTemplate.build(
      makeRequest(),
      ['coder', 'tester', 'reviewer'],
    );
    expect(prompt).toContain('coder, tester, reviewer');
  });

  it('shows (none) when no existing slugs', () => {
    const prompt = SynthesisPromptTemplate.build(makeRequest(), []);
    expect(prompt).toContain('(none)');
  });

  it('includes the top match slug and score', () => {
    const prompt = SynthesisPromptTemplate.build(makeRequest(), []);
    expect(prompt).toContain('security-auditor');
    expect(prompt).toContain('0.620');
  });
});

// ── SynthesisPromptTemplate.toAgentMarkdown ──

describe('SynthesisPromptTemplate.toAgentMarkdown', () => {
  it('generates valid YAML frontmatter', () => {
    const md = SynthesisPromptTemplate.toAgentMarkdown(validDef());
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('slug: test-agent');
    expect(md).toContain('---');
    // Body appears after frontmatter
    expect(md).toContain('You are a test agent');
  });

  it('includes tools and tags as arrays', () => {
    const md = SynthesisPromptTemplate.toAgentMarkdown(validDef());
    expect(md).toContain('"Read"');
    expect(md).toContain('"Grep"');
    expect(md).toContain('"test"');
    expect(md).toContain('"synthesis"');
  });
});

// ── EphemeralRegistry ──

describe('EphemeralRegistry', () => {
  let registry: EphemeralRegistry;

  beforeEach(() => {
    EphemeralRegistry.resetInstance();
    registry = EphemeralRegistry.getInstance();
  });

  it('register adds a record retrievable by slug', () => {
    const rec = makeRecord();
    registry.register(rec);
    expect(registry.isRegistered('test-agent')).toBe(true);
    expect(registry.get('test-agent')?.slug).toBe('test-agent');
  });

  it('incrementUsage updates count and quality average', () => {
    registry.register(makeRecord({ usageCount: 0, avgQualityScore: 0 }));

    registry.incrementUsage('test-agent', 0.8);
    expect(registry.get('test-agent')?.usageCount).toBe(1);
    expect(registry.get('test-agent')?.avgQualityScore).toBeCloseTo(0.8);

    registry.incrementUsage('test-agent', 0.6);
    expect(registry.get('test-agent')?.usageCount).toBe(2);
    // Rolling avg: 0.8 + (0.6 - 0.8) / 2 = 0.7
    expect(registry.get('test-agent')?.avgQualityScore).toBeCloseTo(0.7);
  });

  it('markPromoted sets the promoted flag', () => {
    registry.register(makeRecord());
    expect(registry.get('test-agent')?.promoted).toBe(false);

    registry.markPromoted('test-agent');
    expect(registry.get('test-agent')?.promoted).toBe(true);
  });

  it('listExpired returns only expired non-promoted records', () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    const futureDate = new Date('2030-01-01T00:00:00Z');

    registry.register(makeRecord({
      slug: 'expired-agent',
      expiresAt: pastDate,
      promoted: false,
    }));
    registry.register(makeRecord({
      slug: 'active-agent',
      expiresAt: futureDate,
      promoted: false,
    }));
    registry.register(makeRecord({
      slug: 'promoted-expired',
      expiresAt: pastDate,
      promoted: true,
    }));

    const expired = registry.listExpired();
    expect(expired).toHaveLength(1);
    expect(expired[0].slug).toBe('expired-agent');
  });

  it('get returns undefined for unknown slug', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getAll returns defensive copies', () => {
    registry.register(makeRecord());
    const all = registry.getAll();
    expect(all.size).toBe(1);
    // Mutating the copy should not affect registry
    all.delete('test-agent');
    expect(registry.isRegistered('test-agent')).toBe(true);
  });
});

// ── TTLCleanup ──

describe('TTLCleanup', () => {
  let registry: EphemeralRegistry;
  let cleanup: TTLCleanup;

  beforeEach(async () => {
    EphemeralRegistry.resetInstance();
    registry = EphemeralRegistry.getInstance();
    cleanup = new TTLCleanup('/tmp/agents');
    // Re-initialize fs mocks (mockReset:true in vitest config clears implementations)
    const fs = await import('fs/promises');
    (fs.unlink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('identifies expired records and removes them', async () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    registry.register(makeRecord({
      slug: 'old-agent',
      filePath: '/tmp/agents/old-agent.md',
      expiresAt: pastDate,
    }));

    const result = await cleanup.runCleanup(registry);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedSlugs).toContain('old-agent');
    expect(registry.isRegistered('old-agent')).toBe(false);
  });

  it('never deletes promoted agents', async () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    registry.register(makeRecord({
      slug: 'promoted-agent',
      expiresAt: pastDate,
      promoted: true,
    }));

    const result = await cleanup.runCleanup(registry);
    expect(result.deletedCount).toBe(0);
    expect(registry.isRegistered('promoted-agent')).toBe(true);
  });

  it('extendTTL extends the expiration date', () => {
    const record = makeRecord({ expiresAt: new Date('2026-04-01T01:00:00Z') });
    const oneHourMs = 3_600_000;

    const extended = cleanup.extendTTL(record, oneHourMs);
    expect(extended.expiresAt.getTime()).toBe(
      new Date('2026-04-01T02:00:00Z').getTime(),
    );
    // Original record unchanged
    expect(record.expiresAt.getTime()).toBe(
      new Date('2026-04-01T01:00:00Z').getTime(),
    );
  });

  it('findOrphans detects .md files with no registry entry', async () => {
    const { readdir } = await import('fs/promises');
    (readdir as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'known-agent.md',
      'orphan-agent.md',
    ]);

    registry.register(makeRecord({ slug: 'known-agent' }));

    const orphans = await cleanup.findOrphans(registry);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toContain('orphan-agent.md');
  });
});

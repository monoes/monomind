/**
 * Regression coverage for a field-name mismatch between what `analyze_diff`
 * actually returns (`DiffClassification` — monovector/diff-classifier.ts:
 * `{ primary, secondary, confidence, impactLevel, suggestedReviewers,
 * testingStrategy, riskFactors }`) and what commands/analyze-diff.ts read
 * off the result. The MCP tool's response type was hand-typed inline in the
 * CLI as `{ category, subcategory, confidence, reasoning }` — none of which
 * exist on the real object except `confidence` — so `analyze diff --risk`
 * (and plain `analyze diff`, which shows the same summary box) always
 * printed a literal "Type: undefined" in the Diff Analysis table, and
 * `analyze diff --classify` showed the same undefined Category/Subcategory
 * and a "Reasoning: undefined" line. Same bug class as
 * list-field-mapping.test.ts (task/session field drift) in this package.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../types.js';

const { analyzeDiffImpl } = vi.hoisted(() => {
  const analyzeDiffImpl = vi.fn(async () => ({
    ref: 'HEAD',
    timestamp: Date.now(),
    files: [{ path: 'src/foo.ts', status: 'modified', additions: 7, deletions: 0, binary: false }],
    risk: {
      overall: 'low',
      score: 0,
      breakdown: {
        fileCount: 1,
        totalChanges: 7,
        highRiskFiles: [],
        securityConcerns: [],
        breakingChanges: [],
        testCoverage: 'unknown',
      },
    },
    // The REAL shape returned by classifyDiff()/computeOverallClassification()
    // — no `category`/`subcategory`/`reasoning` fields exist.
    classification: {
      primary: 'feature',
      secondary: ['refactor'],
      confidence: 0.82,
      impactLevel: 'medium',
      suggestedReviewers: ['backend-lead'],
      testingStrategy: ['unit'],
      riskFactors: ['touches auth module'],
    },
    recommendedReviewers: ['backend-lead'],
    summary: '1 files changed (+7/-0), low risk',
  }));
  return { analyzeDiffImpl };
});

vi.mock('../mcp-client.js', () => ({
  callMCPTool: vi.fn(async (toolName: string) => {
    if (toolName === 'analyze_diff') return analyzeDiffImpl();
    return {};
  }),
  MCPClientError: class MCPClientError extends Error {},
}));

vi.mock('../output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printJson: vi.fn(),
    printList: vi.fn(),
    printBox: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    })),
    highlight: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
    info: (s: string) => s,
    color: (s: string) => s,
    progressBar: () => '[=====>    ]',
    setColorEnabled: vi.fn(),
  },
}));

import { diffCommand } from '../commands/analyze-diff.js';
import { output } from '../output.js';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { args: [], flags: { _: [] }, cwd: process.cwd(), interactive: false, ...overrides };
}

function printBoxText(): string {
  const calls = (output.printBox as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const [lastCall] = calls.slice(-1);
  return String(lastCall?.[0]);
}

function lastPrintTableData(): Array<Record<string, unknown>> {
  const calls = (output.printTable as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const [lastCall] = calls.slice(-1);
  return (lastCall?.[0] as { data: Array<Record<string, unknown>> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('`analyze diff --risk` summary box shows the real classification type', () => {
  it('renders "Type: feature (refactor)", never "Type: undefined"', async () => {
    await diffCommand.action?.(makeCtx({ flags: { _: [], risk: true } }));
    const box = printBoxText();
    expect(box).toContain('Type: feature (refactor)');
    expect(box).not.toContain('undefined');
  });
});

describe('`analyze diff --classify` table shows the real classification fields', () => {
  it('renders Category/Subcategory/Impact Level from primary/secondary/impactLevel', async () => {
    await diffCommand.action?.(makeCtx({ flags: { _: [], classify: true } }));
    const rows = lastPrintTableData();
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.Category).toBe('feature');
    expect(byField.Subcategory).toBe('refactor');
    expect(byField['Impact Level']).toBe('medium');
    expect(Object.values(byField)).not.toContain(undefined);
  });
});

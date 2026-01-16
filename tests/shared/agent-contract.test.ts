/**
 * Tests for AgentContract (Task 05: Typed Agent I/O Contracts)
 * Uses vitest globals (describe, it, expect, vi, beforeEach, afterEach)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { AgentContract } from '../../packages/@monobrain/shared/src/agent-contract.js';

const FIXTURE_DIR = join(__dirname, '__fixtures_agent_contract__');

function writeFixture(name: string, content: object): string {
  const filePath = join(FIXTURE_DIR, name);
  writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  return filePath;
}

describe('AgentContract', () => {
  let contract: AgentContract;

  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    contract = new AgentContract();
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('reports compatible for matching schemas', () => {
    const upstreamOutput = writeFixture('upstream-out.json', {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        findings: { type: 'array' },
        agentSlug: { type: 'string' },
      },
    });
    const downstreamInput = writeFixture('downstream-in.json', {
      type: 'object',
      required: ['summary', 'findings'],
      properties: {
        summary: { type: 'string' },
        findings: { type: 'array' },
      },
    });

    const report = contract.check({
      upstreamSlug: 'security-auditor',
      upstreamOutputSchema: upstreamOutput,
      downstreamSlug: 'report-generator',
      downstreamInputSchema: downstreamInput,
    });

    expect(report.compatible).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('reports incompatible when downstream requires a missing field, mentioning the field', () => {
    const upstreamOutput = writeFixture('upstream-out.json', {
      type: 'object',
      properties: {
        summary: { type: 'string' },
      },
    });
    const downstreamInput = writeFixture('downstream-in.json', {
      type: 'object',
      required: ['summary', 'detailedReport'],
      properties: {
        summary: { type: 'string' },
        detailedReport: { type: 'string' },
      },
    });

    const report = contract.check({
      upstreamSlug: 'researcher',
      upstreamOutputSchema: upstreamOutput,
      downstreamSlug: 'documenter',
      downstreamInputSchema: downstreamInput,
    });

    expect(report.compatible).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.includes('detailedReport'))).toBe(true);
  });

  it('includes agent slugs in the report', () => {
    const upstreamOutput = writeFixture('upstream-out.json', {
      type: 'object',
      properties: { summary: { type: 'string' } },
    });
    const downstreamInput = writeFixture('downstream-in.json', {
      type: 'object',
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    });

    const report = contract.check({
      upstreamSlug: 'my-upstream',
      upstreamOutputSchema: upstreamOutput,
      downstreamSlug: 'my-downstream',
      downstreamInputSchema: downstreamInput,
    });

    expect(report.upstreamSlug).toBe('my-upstream');
    expect(report.downstreamSlug).toBe('my-downstream');
  });

  it('reports incompatible when schema file is missing', () => {
    const upstreamOutput = writeFixture('upstream-out.json', {
      type: 'object',
      properties: { summary: { type: 'string' } },
    });

    const report = contract.check({
      upstreamSlug: 'agent-a',
      upstreamOutputSchema: upstreamOutput,
      downstreamSlug: 'agent-b',
      downstreamInputSchema: '/nonexistent/path/schema.json',
    });

    expect(report.compatible).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
  });
});

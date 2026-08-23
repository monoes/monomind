// packages/@monomind/cli/src/orgrt/fence.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgBus } from './bus.js';
import type { Decision } from './policy.js';
import { type FenceConfig, FenceConfigSchema } from './types.js';

export interface FenceInstance {
  detect(input: string): Promise<{
    safe: boolean;
    threats: { type: string; confidence: number }[];
    overallRisk: number;
  }>;
  scanOutput(
    output: string,
    originalPrompt?: string,
  ): Promise<{ safe: boolean; leakageFound: boolean }>;
  getContextState(): { escalationState: string };
  addAllowlistRule(rule: {
    id: string;
    pattern: RegExp | string;
    types: string[];
    context?: string;
    reason?: string;
    source?: string;
  }): void;
}

export interface RoleFence {
  instance: FenceInstance;
  abortThreshold: number;
  scanMessages: boolean;
}

export function loadGlobalFenceConfig(root: string): FenceConfig | null {
  try {
    const raw = readFileSync(join(root, '.monomind', 'monofence.json'), 'utf8');
    return FenceConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function mergeFenceConfigs(...configs: (FenceConfig | undefined | null)[]): FenceConfig {
  const merged: Record<string, unknown> = {};
  const allAllowlist: unknown[] = [];

  for (const cfg of configs) {
    if (!cfg) continue;
    for (const [k, v] of Object.entries(cfg)) {
      if (k === 'allowlist' && Array.isArray(v)) {
        allAllowlist.push(...v);
      } else if (v !== undefined) {
        merged[k] = v;
      }
    }
  }
  if (allAllowlist.length > 0) merged.allowlist = allAllowlist;
  return merged as FenceConfig;
}

export async function createFenceForRole(config: FenceConfig): Promise<FenceInstance | null> {
  try {
    const mod = (await import('monofence-ai')) as {
      createMonoDefence: (cfg: Record<string, unknown>) => FenceInstance;
    };
    const allowlistRules = (config.allowlist ?? []).map((r) => ({
      ...r,
      pattern: new RegExp(r.pattern),
    }));
    return mod.createMonoDefence({
      confidenceThreshold: config.confidenceThreshold,
      enablePIIDetection: config.enablePIIDetection,
      allowlistRules,
      trackContext: true,
    });
  } catch {
    return null;
  }
}

export async function scanInput(
  fence: FenceInstance,
  input: string,
  abortThreshold: number,
): Promise<Decision> {
  const result = await fence.detect(input);
  const ctx = fence.getContextState();
  if (!result.safe && result.overallRisk >= abortThreshold) {
    const top = result.threats[0];
    return {
      behavior: 'deny',
      message: `[fence] threat detected: ${top?.type ?? 'unknown'} (risk ${result.overallRisk.toFixed(2)})`,
    };
  }
  if (ctx.escalationState === 'attack') {
    return {
      behavior: 'deny',
      message: `[fence] session in attack escalation state — input blocked`,
    };
  }
  return { behavior: 'allow', updatedInput: {} };
}

export async function scanMessage(
  fence: FenceInstance,
  body: string,
  abortThreshold: number,
  bus: OrgBus,
  from: string,
): Promise<boolean> {
  const result = await fence.detect(body);
  if (!result.safe && result.overallRisk >= abortThreshold) {
    const top = result.threats[0];
    bus.emit({
      type: 'audit',
      from,
      reason: 'fence-message',
      msg: `message blocked: ${top?.type ?? 'unknown'} (risk ${result.overallRisk.toFixed(2)})`,
    });
    return false;
  }
  return true;
}

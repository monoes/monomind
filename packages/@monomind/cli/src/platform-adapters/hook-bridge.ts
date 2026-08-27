/** Runtime-neutral hook input validation and decision handling. */

import { z } from 'zod';

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd'] as const;

export interface NormalizedHookEvent {
  event: (typeof HOOK_EVENTS)[number];
  tool: string;
  cwd: string;
  sessionId: string;
  input: Record<string, unknown>;
}

export type HookDecision =
  | { action: 'allow'; reason?: string }
  | { action: 'block'; reason?: string }
  | { action: 'observe'; reason?: string };

export interface HookPolicy {
  mode: 'observe' | 'block';
  timeoutMs: Partial<Record<NormalizedHookEvent['event'], number>>;
}

export const DEFAULT_TIMEOUTS: Readonly<Record<NormalizedHookEvent['event'], number>> =
  Object.freeze({
    PreToolUse: 2_000,
    PostToolUse: 10_000,
    SessionStart: 2_000,
    SessionEnd: 2_000,
  });

const NormalizedHookEventSchema = z
  .object({
    event: z.enum(HOOK_EVENTS),
    tool: z.string(),
    cwd: z.string(),
    sessionId: z.string(),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Parse untrusted platform stdin without guessing a platform-specific payload shape. */
export function parseNormalizedHookEvent(payload: unknown): NormalizedHookEvent | null {
  const result = NormalizedHookEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}

export type HookHandler = (event: NormalizedHookEvent) => Promise<HookDecision> | HookDecision;

/**
 * A self-contained Node bridge for native hook runners. It intentionally has
 * no dependency on a Claude installation or helper tree: every supported
 * runner can invoke the same executable and receive a protocol-only result.
 *
 * The generated program currently performs neutral observation. Blocking is
 * a transport capability, not an implicit policy: a future policy must return
 * an explicit `block` decision before a runner is allowed to stop a tool.
 */
export function renderNeutralHookBridge(): string {
  return `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_STDIN_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUTS = { PreToolUse: 2000, PostToolUse: 10000, SessionStart: 2000, SessionEnd: 2000 };
const start = process.hrtime.bigint();
const args = new Set(process.argv.slice(2));
const blocking = args.has('--enable-blocking-hooks');

function eventName(value) {
  return ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd'].includes(value) ? value : null;
}

function normalize(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = eventName(payload.hook_event_name || payload.event || payload.event_name);
  const tool = payload.tool_name || payload.tool || payload.toolName || '';
  const cwd = payload.cwd || payload.workspace || process.cwd();
  const sessionId = payload.session_id || payload.sessionId || '';
  const input = payload.tool_input || payload.input || {};
  if (!event || typeof tool !== 'string' || typeof cwd !== 'string' || typeof sessionId !== 'string') return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return { event, tool, cwd, sessionId, input };
}

function writeLatency(event, cwd, action) {
  try {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    const path = join(cwd, '.monomind', 'hook-latency.jsonl');
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ event, action, latencyMs, timeoutMs: DEFAULT_TIMEOUTS[event] }) + '\\n', 'utf8');
    return latencyMs;
  } catch {
    return Number(process.hrtime.bigint() - start) / 1e6;
  }
}

function finish(decision, event, cwd) {
  const latencyMs = writeLatency(event, cwd, decision.action);
  // Hook protocols reserve stdout for the host. Diagnostics are structured
  // stderr only, so a host can never mistake prose for an allow decision.
  process.stderr.write(JSON.stringify({ decision: decision.action, reason: decision.reason, latencyMs }) + '\\n');
  process.exitCode = blocking && decision.action === 'block' ? 2 : 0;
}

try {
  const raw = readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) {
    finish({ action: 'allow', reason: 'hook stdin exceeds 1 MiB' }, 'PreToolUse', process.cwd());
  } else {
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { payload = null; }
    const event = normalize(payload);
    if (!event) finish({ action: 'allow', reason: 'invalid hook payload' }, 'PreToolUse', process.cwd());
    else finish({ action: 'allow' }, event.event, event.cwd);
  }
} catch {
  // A broken bridge must never make an observe hook block a user operation.
  finish({ action: 'allow', reason: 'hook bridge failed open' }, 'PreToolUse', process.cwd());
}
`;
}

function timeoutFor(event: NormalizedHookEvent['event'], policy: HookPolicy): number {
  const configured = policy.timeoutMs[event] ?? DEFAULT_TIMEOUTS[event];
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUTS[event];
}

async function runWithTimeout(
  event: NormalizedHookEvent,
  timeoutMs: number,
  handler: HookHandler,
): Promise<HookDecision> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(handler(event)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('hook bridge timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run a normalized policy handler. Observe mode is deliberately fail-open:
 * handler failures and deadlines never become a platform-level block.
 */
export async function runHook(
  event: NormalizedHookEvent,
  policy: HookPolicy,
  handler: HookHandler = () => ({ action: 'allow' }),
): Promise<HookDecision> {
  try {
    return await runWithTimeout(event, timeoutFor(event.event, policy), handler);
  } catch (error) {
    if (policy.mode === 'observe') return { action: 'allow' };
    return {
      action: 'observe',
      reason: error instanceof Error ? error.message : 'hook bridge failed',
    };
  }
}

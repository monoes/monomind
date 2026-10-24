import { z } from 'zod';

export const TIERS = ['session', 'subagent', 'org-role', 'external'] as const;
export type Tier = (typeof TIERS)[number];
export const PRESENCE = ['active', 'stale', 'gone'] as const;
export type Presence = (typeof PRESENCE)[number];

/** Ids become address segments, so the separator and whitespace are excluded. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const id = (max: number) => z.string().min(1).max(max).regex(SAFE_ID);
/**
 * Everything an agent supplies ends up in front of other agents (an LLM reads `mesh_who`), so
 * short labels are restricted to a safe charset instead of being free text.
 */
const SAFE_LABEL = /^[A-Za-z0-9._:+-]+$/;
const label = z.string().trim().min(1).max(64).regex(SAFE_LABEL);
const SAFE_ADDR = /^[A-Za-z0-9._/-]+$/;

/** C0/C1 controls plus characters that hide or reorder text (zero-width, bidi overrides, BOM). */
function isControl(code: number): boolean {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    code === 0x2060 ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (isControl(s.charCodeAt(i))) return true;
  return false;
}
/** Free text (the task line) keeps its words but loses newlines and escape sequences. */
function stripControl(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += isControl(s.charCodeAt(i)) ? ' ' : s[i];
  return out.replace(/\s+/g, ' ').trim();
}

/** The one-line status other agents read; both `hello` and `heartbeat` carry it. */
const taskText = z.string().max(500).transform(stripControl);

const helloShape = {
  tier: z.enum(TIERS),
  runtime: label,
  pid: z.number().int().positive(),
  project: id(128),
  projectPath: z
    .string()
    .min(1)
    .max(1024)
    .refine((p) => !hasControl(p), 'control characters are not allowed'),
  sessionId: id(128),
  agentId: id(128).optional(),
  alias: id(64).optional(),
  task: taskText.optional(),
  capabilities: z.array(label).max(32).default([]),
  tags: z.array(label).max(32).default([]),
  parent: z.string().max(512).regex(SAFE_ADDR).optional(),
  /** Proof of ownership when re-registering an address that is still live. */
  key: z.string().min(1).max(128).optional(),
  /**
   * Random per attempt and repeated unchanged when a request is retried: it lets the hub recognise
   * a `hello` whose reply was lost as the same originator, not a stranger asking for the address.
   */
  nonce: z
    .string()
    .regex(/^[A-Za-z0-9]{16,64}$/)
    .optional(),
};

export const WhoFilterSchema = z.object({
  project: id(128).optional(),
  tier: z.enum(TIERS).optional(),
  status: z.enum(PRESENCE).optional(),
  capability: label.optional(),
  tag: label.optional(),
  parent: z.string().max(512).regex(SAFE_ADDR).optional(),
  includeGone: z.boolean().default(false),
});
export type WhoFilter = z.infer<typeof WhoFilterSchema>;

const reqId = z.string().min(1).max(64);

export const MESSAGE_KINDS = ['say', 'ask', 'reply'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
/** Longest message body, in characters. */
export const MAX_BODY = 4096;
/** A message body keeps its line breaks and tabs, but no other control or hidden characters. */
const body = z
  .string()
  .min(1)
  .max(MAX_BODY)
  .refine((b) => !hasControl(b.replace(/[\n\t]/g, ' ')), 'control characters are not allowed');

export const RequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('hello'), id: reqId, ...helloShape }),
  z.object({
    op: z.literal('heartbeat'),
    id: reqId,
    addr: z.string().min(1).max(512),
    key: z.string().min(1).max(128),
    task: taskText.optional(),
  }),
  z.object({
    op: z.literal('bye'),
    id: reqId,
    addr: z.string().min(1).max(512),
    key: z.string().min(1).max(128),
  }),
  z.object({ op: z.literal('who'), id: reqId, ...WhoFilterSchema.shape }),
  z.object({
    op: z.literal('send'),
    id: reqId,
    addr: z.string().min(1).max(512),
    key: z.string().min(1).max(128),
    /** An alias in the sender's project, or a full address. */
    to: z.string().min(1).max(512).regex(SAFE_ADDR),
    kind: z.enum(MESSAGE_KINDS).default('say'),
    body,
    replyTo: z.number().int().positive().optional(),
  }),
  z.object({
    op: z.literal('inbox'),
    id: reqId,
    addr: z.string().min(1).max(512),
    key: z.string().min(1).max(128),
    limit: z.number().int().min(1).max(100).default(20),
    /** Read without marking the messages as read. */
    peek: z.boolean().default(false),
  }),
]);
export type Request = z.infer<typeof RequestSchema>;

export interface HelloFields {
  tier: Tier;
  runtime: string;
  pid: number;
  project: string;
  projectPath: string;
  sessionId: string;
  agentId?: string;
  alias?: string;
  task?: string;
  capabilities: string[];
  tags: string[];
  parent?: string;
}

export interface AgentInfo extends HelloFields {
  addr: string;
  status: Presence;
  lastSeen: number;
  joinedAt: number;
}

export interface MeshMessage {
  seq: number;
  from: string;
  fromAlias?: string;
  kind: MessageKind;
  body: string;
  replyTo?: number;
  ts: number;
}

export function buildAddr(
  host: string,
  project: string,
  sessionId: string,
  agentId?: string,
): string {
  return [host, project, sessionId, ...(agentId ? [agentId] : [])].join('/');
}

export function parseAddr(
  addr: string,
): { host: string; project: string; sessionId: string; agentId?: string } | null {
  const parts = addr.split('/');
  if (parts.length < 3 || parts.length > 4 || parts.some((p) => !SAFE_ID.test(p))) return null;
  const [host, project, sessionId, agentId] = parts;
  return agentId ? { host, project, sessionId, agentId } : { host, project, sessionId };
}

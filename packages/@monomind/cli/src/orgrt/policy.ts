// packages/@monomind/cli/src/orgrt/policy.ts
import { relative, resolve } from 'node:path';
import type { OrgBus } from './bus.js';
import type { RolePolicy } from './types.js';

export type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
/** Cap for inline content snapshots on 'asset' events (bytes, UTF-16 chars) — keeps
 *  bus.jsonl / the dashboard's per-session event log from bloating on large writes. */
const SNAPSHOT_MAX_CHARS = 200_000;

/** tiny glob→RegExp: supports ** (any depth) and * (single segment). */
export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*');
  return new RegExp(`^${esc}$`);
}

export class PolicyEngine {
  private used = 0;
  constructor(
    readonly role: string,
    readonly policy: RolePolicy,
    private bus: OrgBus,
    private cwd: string,
  ) {}

  addUsage(tokens: number): void { this.used += tokens; }
  get usage(): number { return this.used; }
  get overBudget(): boolean {
    return this.policy.maxTokens != null && this.used >= this.policy.maxTokens;
  }

  async decide(tool: string, input: Record<string, unknown>): Promise<Decision> {
    const deny = (reason: string): Decision => {
      this.bus.emit({ type: 'tool', from: this.role, tool, decision: 'deny', reason, data: { input: summarize(input) } });
      return { behavior: 'deny', message: `[org-policy] ${reason}` };
    };
    const allow = (): Decision => {
      this.bus.emit({ type: 'tool', from: this.role, tool, decision: 'allow', data: { input: summarize(input) } });
      if (WRITE_TOOLS.has(tool) && typeof input.file_path === 'string') {
        // Snapshot the full resulting content when we actually have it at decide()
        // time. Write's `content` param IS the complete post-write file — capture
        // it inline on the event so the dashboard can diff this version against a
        // later one without re-reading disk (which only ever holds the CURRENT
        // version). Edit only carries old_string/new_string fragments, not the
        // resulting whole file, so there is nothing accurate to snapshot there —
        // the event still records the write (path, from), just without content.
        const content = tool === 'Write' && typeof input.content === 'string'
          && input.content.length <= SNAPSHOT_MAX_CHARS ? input.content : undefined;
        this.bus.emit({
          type: 'asset', from: this.role, path: String(input.file_path),
          ...(content !== undefined ? { data: { content } } : {}),
        });
      }
      return { behavior: 'allow', updatedInput: input };
    };

    if (this.overBudget) return deny(`token budget exhausted (${this.used}/${this.policy.maxTokens})`);
    if (this.policy.denyTools?.includes(tool)) return deny(`tool ${tool} is denied for role ${this.role}`);
    if (this.policy.allowTools && !this.policy.allowTools.includes(tool) && !tool.startsWith('mcp__org__'))
      return deny(`tool ${tool} not in allowlist for role ${this.role}`);

    if (WRITE_TOOLS.has(tool) || READ_TOOLS.has(tool)) {
      const globs = WRITE_TOOLS.has(tool) ? (this.policy.fileWrite ?? ['**']) : (this.policy.fileRead ?? ['**']);
      const p = typeof input.file_path === 'string' ? input.file_path
        : typeof input.path === 'string' ? input.path : null;
      if (p !== null) {
        const rel = relative(this.cwd, resolve(this.cwd, p));
        if (rel.startsWith('..')) return deny(`path escapes org workdir: ${p}`);
        if (!globs.some(g => globToRegExp(g).test(rel))) return deny(`path ${rel} outside ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope`);
      }
    }

    if (WEB_TOOLS.has(tool) && this.policy.webAllow !== undefined) {
      if (this.policy.webAllow.length === 0) return deny(`web access disabled for role ${this.role}`);
      if (tool === 'WebFetch') {
        const host = safeHost(String(input.url ?? ''));
        if (!host || !this.policy.webAllow.some(d => host === d || host.endsWith(`.${d}`)))
          return deny(`domain ${host ?? '?'} not in research allowlist`);
      }
      // WebSearch has no URL up front; allowed if webAllow is non-empty
    }

    return allow();
  }
}

function safeHost(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}
function summarize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input))
    out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  return out;
}

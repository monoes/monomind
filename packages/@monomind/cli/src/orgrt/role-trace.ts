// packages/@monomind/cli/src/orgrt/role-trace.ts
/**
 * #327: a role's position in a chain, as its tool calls and its org_send mail
 * carry it.
 *
 * - The chain (`chain_id`, `hop`) comes from the latest message delivered to
 *   the role with a `[trace chn_… hop=N]` line (cross-org.ts's recordTrace),
 *   else a fresh chain at hop 0 minted once for the role.
 * - `turn` numbers the role's turns: 1 for its first, +1 each time a turn ends
 *   (the runner's `result`). Every call inside one turn carries the same
 *   value; the count is checkpointed, so a stop/resume continues it.
 * - A role's org_send is stamped with its chain at hop + 1 (withTrace), the
 *   way mono-agent's WithTrace stamps the mail it sends, so A → B → A climbs
 *   one chain instead of each hop starting over.
 */
import type { RunningOrg } from './daemon.js';
import { type ChainTrace, freshChainId } from './tool-providers.js';

export interface RoleTrace extends ChainTrace {
  turn: number;
}

/** The role's current chain and turn; mints the chain on first use. */
export function currentRoleTrace(running: RunningOrg | undefined, role: string): RoleTrace {
  if (!running) return { chain_id: freshChainId(), hop: 0, turn: 1 };
  if (!running.traces) running.traces = new Map();
  let t = running.traces.get(role);
  if (!t) {
    t = { chain_id: freshChainId(), hop: 0 };
    running.traces.set(role, t);
  }
  return { chain_id: t.chain_id, hop: t.hop, turn: (running.turns?.get(role) ?? 0) + 1 };
}

/** A role's turn ended: its next tool call belongs to the next turn. */
export function endTurn(running: RunningOrg, role: string): void {
  if (!running.turns) running.turns = new Map();
  running.turns.set(role, (running.turns.get(role) ?? 0) + 1);
}

const TRACE_LINES = /^\[trace chn_[A-Za-z0-9_-]+ hop=\d+\][^\S\n]*(?:\n|$)/gm;

/** `body` with the next hop of `t` as its first line, replacing any trace line
 *  already in it — a message sits at one position in one chain. */
export function withTrace(body: string, t: ChainTrace): string {
  const rest = body.replace(TRACE_LINES, '').replace(/^\n+/, '');
  return `[trace ${t.chain_id} hop=${t.hop + 1}]\n${rest}`;
}

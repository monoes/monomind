// tests/eval/org/support/scripted.ts
//
// A scripted stand-in for the Claude Agent SDK's `query()`: it replays fixed
// agent behaviour, so a scenario can prove an invariant on every change with
// no model spend. A script says, per role and mailbox message, which model
// calls happen, what the turn costs, and whether the process then crashes.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setOrgSignatureEnforcement } from '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js';

export interface ScriptedCall {
  /** The API response id; calls sharing an id are one response split across messages. */
  id: string;
  input?: number;
  cache_read?: number;
  cache_creation?: number;
  output?: number;
}

export interface ScriptedTurn {
  calls?: ScriptedCall[];
  /** What this mailbox message costs, USD. */
  cost?: number;
  /** After reporting the result, the process dies with this error. */
  crash?: string;
}

/** What a role does for its nth mailbox message (0-based). Unlisted turns are free and instant. */
export type Script = (role: string, turn: number) => ScriptedTurn;

export interface ScriptedSdk {
  queryFn: never;
  /** The options every query() call received, per role, in call order. */
  options: Map<string, Record<string, any>[]>;
  /** Mailbox messages each role processed. */
  turns: Map<string, number>;
}

export function scriptedSdk(script: Script): ScriptedSdk {
  const options = new Map<string, Record<string, any>[]>();
  const turns = new Map<string, number>();
  const queryFn = (({
    prompt,
    options: o,
  }: {
    prompt: AsyncIterable<unknown>;
    options: Record<string, any>;
  }) => {
    const role = /You are agent "([^"]+)"/.exec(String(o.systemPrompt))?.[1] ?? '?';
    options.set(role, [...(options.get(role) ?? []), o]);
    // Cost is cumulative per query() process, as the SDK reports it.
    let cumulative = 0;
    return (async function* () {
      for await (const _message of prompt) {
        const n = turns.get(role) ?? 0;
        turns.set(role, n + 1);
        const turn = script(role, n);
        for (const c of turn.calls ?? [])
          yield {
            type: 'assistant',
            session_id: `sdk-${role}`,
            parent_tool_use_id: null,
            message: {
              id: c.id,
              content: [],
              usage: {
                input_tokens: c.input ?? 0,
                output_tokens: c.output ?? 0,
                cache_read_input_tokens: c.cache_read ?? 0,
                cache_creation_input_tokens: c.cache_creation ?? 0,
              },
            },
          };
        cumulative += turn.cost ?? 0;
        yield {
          type: 'result',
          subtype: 'success',
          session_id: `sdk-${role}`,
          usage: { input_tokens: 0, output_tokens: 0 },
          total_cost_usd: cumulative,
        };
        if (turn.crash) throw new Error(turn.crash);
      }
    })();
  }) as never;
  return { queryFn, options, turns };
}

/** A project root holding one org definition, ready for an OrgDaemon. Scenario
 *  orgs are fixtures, so operator-signature enforcement (a test-only switch) is
 *  off, as in the package's own suites. */
export function projectWithOrg(def: Record<string, unknown>): { root: string; name: string } {
  setOrgSignatureEnforcement(false);
  const root = mkdtempSync(join(tmpdir(), 'org-eval-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${def.name}.json`), JSON.stringify(def));
  return { root, name: String(def.name) };
}

export async function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

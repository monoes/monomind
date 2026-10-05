import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { RunnerTransportError } from './runner-transport-error.js';
export const FREEBUFF_UNSUPPORTED =
  'Freebuff is interactive-only: its published CLI has no supported headless prompt/JSON transport. Use freebuff interactively (freebuff login), or select another monomind runtime. No Freebuff process was started.';
/** Deliberately refuses rather than scraping a terminal or substituting Codebuff. */
export class FreebuffAgentRunner implements AgentRunner {
  // biome-ignore lint/correctness/useYield: unsupported transports reject before producing any messages.
  async *run(_args: AgentRunArgs): AsyncIterable<AgentMessage> {
    throw new RunnerTransportError('unsupported', FREEBUFF_UNSUPPORTED);
  }
}

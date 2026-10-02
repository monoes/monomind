// tests/eval/org/support/phase2.ts
//
// Shared fixture for the Phase 2 scenarios: a boss and one worker in an org on
// the opt-in `run_config.context` surface, driven through a real OrgDaemon by
// a scripted SDK, with the run's files read back for assertions.
import { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { readPacketLog } from '../../../../packages/@monomind/cli/src/orgrt/packet.js';
import { projectWithOrg, type Script, scriptedSdk, waitUntil } from './scripted.js';

/** The token a scenario's poke carries, so a script reacts to it and to nothing the runtime sends later. */
export const START = 'SCENARIO-START';

export const taskIdOf = (message: string): string | undefined =>
  /\[task:([\w-]+)\]/.exec(message)?.[1];

export async function startPhase2Org(opts: {
  context: Record<string, unknown>;
  script: Script;
  roles?: Record<string, unknown>[];
  runConfig?: Record<string, unknown>;
}) {
  const sdk = scriptedSdk(opts.script);
  const { root, name } = projectWithOrg({
    name: 'p2',
    goal: 'g',
    run_config: { context: opts.context, ...(opts.runConfig ?? {}) },
    roles: opts.roles ?? [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'worker', title: 'Worker', type: 'specialist', reports_to: 'boss' },
    ],
  });
  const daemon = new OrgDaemon(root, {
    queryFn: sdk.queryFn,
    forward: false,
    stopWaitMs: 100,
    crashBackoffsMs: [],
  });
  const running = await daemon.startOrg(name);
  const events: { reason?: string; msg?: string; data?: any }[] = [];
  running.bus.subscribe((e) => events.push(e as never));
  return {
    events,
    sdk,
    daemon,
    running,
    /** Wake a role with a mailbox message so its scripted turn runs. */
    poke: (to: string, subject = START, body = START) =>
      daemon.deliver(name, 'owner', to, subject, body),
    packetLog: async () => {
      await running.bus.flush();
      return readPacketLog(running.bus.dir);
    },
    until: waitUntil,
  };
}

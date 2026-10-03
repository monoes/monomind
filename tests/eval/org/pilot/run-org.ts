// tests/eval/org/pilot/run-org.ts
//
// Runs one prepared trial's org in this process, as `org run` does, so that the pilot's treatment
// arm can attach the hand-off prototype to this one daemon (harness.ts). The baseline arm runs the
// same way with nothing attached, so the arms differ only by the prototype. Native children are
// disabled in both. Used as the run command of smoke/run-trial.sh (SMOKE_RUN_CMD):
//   npx tsx tests/eval/org/pilot/run-org.ts
// reading SMOKE_ROOT, SMOKE_ORG and SMOKE_TASK.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadClaudeSdk } from '../../../../packages/@monomind/cli/src/orgrt/agent-runner-claude.js';
import { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { startOrgServer } from '../../../../packages/@monomind/cli/src/orgrt/server.js';
import { attachPilot, type PilotTrial } from './harness.js';

/** The tools that start a native child agent; denied to every role in both arms. */
export const NATIVE_CHILD_TOOLS = ['Task', 'Agent'];

type QueryFn = OrgDaemonOptions['queryFn'];
type OrgDaemonOptions = NonNullable<ConstructorParameters<typeof OrgDaemon>[1]>;

/** `query` with the native-child tools added to every call's disallowed tools. */
export function withoutNativeChildren(query: NonNullable<QueryFn>): NonNullable<QueryFn> {
  return ((params: { options?: Record<string, unknown> }) =>
    query({
      ...params,
      options: {
        ...(params.options ?? {}),
        disallowedTools: [
          ...((params.options?.disallowedTools as string[] | undefined) ?? []),
          ...NATIVE_CHILD_TOOLS,
        ],
      },
    } as never)) as NonNullable<QueryFn>;
}

export interface RunOrgOptions {
  root: string;
  name: string;
  task?: string;
  /** The prototype's trial, for the treatment arm; absent in the baseline arm. */
  pilot?: PilotTrial;
  /** Defaults to the real SDK's query. */
  queryFn?: NonNullable<QueryFn>;
  autoApprove?: string[];
  pollMs?: number;
}

export async function runOrg(o: RunOrgOptions): Promise<{ stoppedManually: boolean }> {
  const query = o.queryFn ?? ((await loadClaudeSdk()).query as NonNullable<QueryFn>);
  const daemon = new OrgDaemon(o.root, {
    crossProcess: true,
    queryFn: withoutNativeChildren(query),
  });
  if (o.pilot) attachPilot(daemon, o.pilot, o.pilot.runId);
  const srv = await startOrgServer(daemon, 0);
  daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
  try {
    await daemon.startOrg(o.name, o.task || undefined, {
      resume: false,
      autoApprove: o.autoApprove ?? ['Bash', 'WebFetch', 'WebSearch', 'org_complete'],
    });
    const stopfile = join(o.root, '.monomind/orgs', o.name, 'stop');
    let stoppedManually = false;
    while (daemon.getOrg(o.name)) {
      if (existsSync(stopfile)) {
        stoppedManually = true;
        break;
      }
      await new Promise((r) => setTimeout(r, o.pollMs ?? 2000));
    }
    return { stoppedManually };
  } finally {
    await daemon.stopAll();
    srv.close();
  }
}

if (process.argv[1]?.endsWith('run-org.ts')) {
  const root = process.env.SMOKE_ROOT as string;
  const name = process.env.SMOKE_ORG as string;
  const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
  const pilot: PilotTrial | undefined =
    trial.pilot?.arm === 'treatment'
      ? {
          runId: trial.pilot.runId,
          dir: trial.pilot.dir,
          routing: trial.pilot.routing,
          contracts: trial.pilot.contracts,
          ...(trial.pilot.faults ? { faults: trial.pilot.faults } : {}),
        }
      : undefined;
  const { stoppedManually } = await runOrg({ root, name, task: process.env.SMOKE_TASK, pilot });
  console.log(`org ${name} ended${stoppedManually ? ' (stopped)' : ''}`);
  process.exit(0);
}

// packages/@monomind/cli/src/orgrt/test-loop.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrgBus } from './bus.js';
import { OrgDaemon } from './daemon.js';
import { queueMessage } from './inbox.js';
import { PolicyEngine } from './policy.js';
import { startOrgServer } from './server.js';
import { type BusEvent, ORG_DIR, RolePolicySchema } from './types.js';

/** Test scenario definition - declarative scenario files for scripted org tests */
interface TestScenario {
  name: string;
  description?: string;
  orgs: Array<{
    name: string;
    goal: string;
    roles: Array<{
      id: string;
      title: string;
      type: string;
      reports_to: string | null;
      policy?: { denyTools?: string[]; fileWrite?: string[] };
    }>;
  }>;
  script: Array<{
    step: number;
    from: string;
    to?: string;
    action: 'send' | 'tool' | 'expect';
    tool?: string;
    input?: Record<string, unknown>;
    subject?: string;
    body?: string;
    expect?: string;
  }>;
}

/** Load a test scenario from a JSON file */
function loadScenario(root: string, scenarioFile: string): TestScenario | null {
  const scenarioPath = join(root, '.monomind', 'scenarios', scenarioFile);
  if (!existsSync(scenarioPath)) return null;

  try {
    const content = readFileSync(scenarioPath, 'utf8');
    return JSON.parse(content) as TestScenario;
  } catch {
    return null;
  }
}

/**
 * Parses an `expect` DSL string of the form `<eventType>` or
 * `<eventType>:field=value[,field=value...]` (fields: from, to, tool,
 * decision, reason, subject) and checks it against events actually observed
 * on the org buses so far — not a hardcoded pass.
 */
function evaluateExpect(expect: string, observed: BusEvent[]): boolean {
  const [type, fieldsPart] = expect.split(':', 2);
  const wantType = type.trim();
  const fields = fieldsPart
    ? Object.fromEntries(
        fieldsPart.split(',').map((kv) => {
          const [k, v] = kv.split('=', 2);
          return [k?.trim(), v?.trim()];
        }),
      )
    : {};
  return observed.some((e) => {
    if (e.type !== wantType) return false;
    for (const [k, v] of Object.entries(fields)) {
      const actual = (e as unknown as Record<string, unknown>)[k];
      if (actual === undefined || String(actual) !== v) return false;
    }
    return true;
  });
}

/**
 * Run a declarative test scenario instead of the hardcoded scriptedQuery.
 *
 * IMPORTANT: this drives 'tool' checks through the REAL PolicyEngine and
 * 'expect' checks against events REALLY emitted on the org buses so far —
 * but scenario orgs are never actually started via daemon.startOrg() (no
 * real agent SDK sessions run), so 'send' steps only exercise deliver()'s
 * routing/queuing logic, not a live agent receiving and acting on the
 * message. The report is labeled "structural dry-run" to be honest that not
 * every check type here is verified against a fully live run.
 */
function runScenario(daemon: OrgDaemon, scenario: TestScenario, root: string): Promise<LoopReport> {
  return (async () => {
    // Create org definitions from scenario
    for (const orgDef of scenario.orgs) {
      const dir = join(root, ORG_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${orgDef.name}.json`),
        JSON.stringify(
          {
            name: orgDef.name,
            goal: orgDef.goal,
            roles: orgDef.roles,
          },
          null,
          2,
        ),
      );
    }

    // One OrgBus per scenario org, so 'tool' policy decisions have somewhere
    // real to emit to and 'expect' has real events to check against.
    const buses = new Map<string, OrgBus>();
    const observed: BusEvent[] = [];
    for (const orgDef of scenario.orgs) {
      const bus = new OrgBus(orgDef.name, 'scenario', join(root, ORG_DIR, orgDef.name, 'scenario'));
      bus.subscribe((e) => observed.push(e));
      buses.set(orgDef.name, bus);
    }
    // Cache one PolicyEngine per org:role so budget/usage state (this.used)
    // accumulates realistically across a scenario's steps, same as a live run.
    const policies = new Map<string, PolicyEngine>();
    const policyFor = (orgName: string, roleId: string): PolicyEngine | null => {
      const key = `${orgName}:${roleId}`;
      const cached = policies.get(key);
      if (cached) return cached;
      const orgDef = scenario.orgs.find((o) => o.name === orgName);
      const role = orgDef?.roles.find((r) => r.id === roleId);
      const bus = buses.get(orgName);
      if (!orgDef || !role || !bus) return null;
      const engine = new PolicyEngine(
        role.id,
        RolePolicySchema.parse(role.policy ?? {}),
        bus,
        root,
      );
      policies.set(key, engine);
      return engine;
    };

    const iterations: IterationResult[] = [];
    let stepIndex = 0;

    // Execute scenario steps
    for (const step of scenario.script) {
      stepIndex++;
      const checks: Record<string, boolean> = {};

      try {
        switch (step.action) {
          case 'send':
            if (step.to) {
              const parts = step.to.split(':');
              const orgName = parts[0];
              const receipt = await daemon.deliver(
                orgName,
                step.from,
                step.to,
                step.subject || 'test message',
                step.body || 'test body',
              );
              checks[`step_${stepIndex}_delivered`] = receipt.includes('delivered');
            }
            break;

          case 'tool': {
            // Real policy evaluation — not a stub. step.expect (optional) names the
            // expected Decision behavior ('allow' | 'deny'); defaults to 'allow'.
            const orgName =
              scenario.orgs.find((o) => o.roles.some((r) => r.id === step.from))?.name ??
              scenario.orgs[0]?.name;
            const engine = orgName ? policyFor(orgName, step.from) : null;
            if (!engine || !step.tool) {
              checks[`step_${stepIndex}_tool_allowed`] = false;
              break;
            }
            const decision = await engine.decide(step.tool, step.input ?? {});
            const expectedBehavior = step.expect === 'deny' ? 'deny' : 'allow';
            checks[`step_${stepIndex}_tool_allowed`] = decision.behavior === expectedBehavior;
            break;
          }

          case 'expect':
            // Real check against events actually observed on the scenario's org
            // buses so far (populated by 'send' and 'tool' steps above) — not a
            // hardcoded pass.
            checks[`step_${stepIndex}_expectation`] = step.expect
              ? evaluateExpect(step.expect, observed)
              : false;
            break;
        }

        iterations.push({ checks, events: stepIndex });
      } catch (_err) {
        checks[`step_${stepIndex}_error`] = false;
        iterations.push({ checks, events: stepIndex });
      }
    }

    const failed = iterations.filter((it) => Object.values(it.checks).some((v) => !v)).length;
    const summary = `[structural dry-run] Scenario "${scenario.name}": ${iterations.length - failed}/${iterations.length} steps passed`;

    return { iterations, failed, summary };
  })();
}

/**
 * Scripted fake SDK used by the verification loop (no API cost, deterministic).
 * boss: on kickoff, delegates to coder, then pings the partner org's boss.
 * coder: "writes" a report (Write allowed by policy), attempts Bash (denied), replies to boss.
 * It drives the SAME production code paths via the _orgTest seam:
 * callTool → policy.decide → bus; deliver → daemon.deliver → mailboxes + bus;
 * assistant/result → chat/usage events.
 */
const scriptedQuery =
  (roleId: string) =>
  ({ prompt, options }: any) =>
    (async function* () {
      const seam = options._orgTest;
      for await (const m of prompt) {
        const text = String(m.message.content);
        // Trigger ONLY on the daemon kickoff message (starts with `Org "`). A bare
        // includes('started') also matches the xorg body "alpha started its run",
        // making the partner boss re-deliver to itself forever — an unbroken
        // microtask chain that starves the event loop (waitFor's timer never fires).
        if (roleId === 'boss' && text.startsWith('Org "') && text.includes('started')) {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Kicking off: delegating to coder.' }] },
          };
          await seam.deliver('coder', 'task', 'produce out/report.md');
          await seam.deliver('partner:boss', 'fyi', 'alpha started its run');
        } else if (roleId === 'coder') {
          await seam.callTool('Write', {
            file_path: join(options.cwd, 'out/report.md'),
            content: '# report',
          });
          await seam.callTool('Bash', { command: 'echo should-be-denied' }); // policy MUST deny
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Report written.' }] },
          };
          await seam.deliver('boss', 're: task', 'done — out/report.md');
        } else {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: `ack: ${text.slice(0, 40)}` }] },
          };
        }
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 5, output_tokens: 5 } };
      }
    })();

interface IterationResult {
  checks: Record<string, boolean>;
  events: number;
}
export interface LoopReport {
  iterations: IterationResult[];
  failed: number;
  summary: string;
}

function writeFixtures(root: string): void {
  const dir = join(root, ORG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'alpha.json'),
    JSON.stringify({
      name: 'alpha',
      goal: 'produce a report',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        {
          id: 'coder',
          title: 'Coder',
          type: 'specialist',
          reports_to: 'boss',
          policy: { denyTools: ['Bash'], fileWrite: ['out/**'] },
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, 'partner.json'),
    JSON.stringify({
      name: 'partner',
      goal: 'receive handoffs',
      roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
    }),
  );
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return pred();
}

export async function runTestLoop(
  root: string,
  times: number,
  scenarioFile?: string,
): Promise<LoopReport> {
  // If a scenario file is provided, run it instead of the hardcoded test
  if (scenarioFile) {
    const scenario = loadScenario(root, scenarioFile);
    if (!scenario) {
      return { iterations: [], failed: 0, summary: `Scenario file not found: ${scenarioFile}` };
    }

    const daemon = new OrgDaemon(root, { forward: false });
    const srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.credential);

    try {
      return await runScenario(daemon, scenario, root);
    } finally {
      await daemon.stopAll();
      srv.close();
    }
  }

  writeFixtures(root);
  const iterations: IterationResult[] = [];

  for (let i = 0; i < times; i++) {
    const queryFn = (args: any) => {
      const roleId = /You are agent "([^"]+)"/.exec(args.options.systemPrompt)?.[1] ?? 'unknown';
      return scriptedQuery(roleId)(args);
    };
    const daemon = new OrgDaemon(root, { queryFn: queryFn as any, forward: false });
    // xdeliver server for cross-process delivery (tested via the xorg check)
    const srv = await startOrgServer(daemon, 0);
    daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.credential);

    // Queue a message for partner:boss BEFORE starting it — verifies inbox drain on startup
    queueMessage(root, 'partner', {
      fromQualified: 'external:system',
      toRole: 'boss',
      subject: 'pre-start',
      body: 'queued while offline',
      ts: Date.now(),
    });

    const alpha = await daemon.startOrg('alpha');
    const partner = await daemon.startOrg('partner');
    await waitFor(() =>
      alpha.busEvents().some((e) => e.type === 'message' && e.from === 'coder' && e.to === 'boss'),
    );
    await daemon.stopAll();
    srv.close();
    const evs = alpha.busEvents();
    const has = (pred: (e: BusEvent) => boolean) => evs.some(pred);
    const persistedCount = OrgBus.readHistory(join(root, ORG_DIR, 'alpha', alpha.run)).length;
    const partnerEvs = partner.busEvents();
    const checks: Record<string, boolean> = {
      chat: has((e) => e.type === 'chat'),
      message: has((e) => e.type === 'message' && e.from === 'boss' && e.to === 'coder'),
      tool: has((e) => e.type === 'tool' && e.decision === 'allow' && e.tool === 'Write'),
      policyDeny: has((e) => e.type === 'tool' && e.decision === 'deny' && e.tool === 'Bash'),
      asset: has((e) => e.type === 'asset' && (e.path ?? '').endsWith('out/report.md')),
      xorg: has((e) => e.type === 'xorg' && e.to === 'partner:boss'),
      usage: has((e) => e.type === 'usage'),
      persisted: persistedCount === evs.length,
      inboxDrain: partnerEvs.some(
        (e) => e.type === 'xorg' && e.from === 'external:system' && e.subject === 'pre-start',
      ),
    };
    iterations.push({ checks, events: evs.length });
  }

  const failed = iterations.filter((it) => Object.values(it.checks).some((v) => !v)).length;
  const summary =
    `org e2e: ${times - failed}/${times} passed` +
    (failed
      ? ` — failing checks: ${JSON.stringify(iterations.filter((it) => Object.values(it.checks).some((v) => !v)).map((it) => it.checks))}`
      : '');
  return { iterations, failed, summary };
}

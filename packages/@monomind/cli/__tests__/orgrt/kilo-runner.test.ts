import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KiloAgentRunner } from "../../src/orgrt/kilo-runner.js";
import { FreebuffAgentRunner } from "../../src/orgrt/freebuff-runner.js";
import type {
  AgentRunArgs,
  AgentMessage,
} from "../../src/orgrt/agent-runner.js";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture(body: string): AgentRunArgs {
  const dir = mkdtempSync(join(tmpdir(), "kilo-test-"));
  dirs.push(dir);
  const bin = join(dir, "kilo");
  writeFileSync(join(dir,"package.json"),JSON.stringify({version:"7.8.3",bin:{kilo:"kilo"}}));
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nif(process.argv.includes('--version')) { console.log('7.8.3'); process.exit(0); }\nlet input='';process.stdin.on('data', c=>input+=c);process.stdin.on('end',()=>{${body}});`,
    { mode: 0o700 },
  );
  return {
    tools: [],
    access: "full",
    settingSources: ["user", "project", "local"],
    prompt: (async function* () {
      yield "private prompt";
    })(),
    systemPrompt: "system",
    cwd: dir,
    env: { KILO_CLI_BIN: bin },
    maxTurns: 10,
  };
}
async function collect(args: AgentRunArgs, timeoutMs?: number) {
  const out: AgentMessage[] = [];
  for await (const m of new KiloAgentRunner({ timeoutMs }).run(args))
    out.push(m);
  return out;
}
describe("Kilo dedicated JSON transport", () => {
  it("delivers stdin through EOF, keeps prompt out of argv, resumes and maps completed text once with zero usage", async () => {
    const args =
      fixture(`if (!input.includes('private prompt') || process.argv.includes('private prompt') || !process.argv.includes('--session') || !process.argv.includes('provider/model')) process.exit(2);
    const frames=[{type:'text',sessionID:'sess',part:{id:'p',text:'answer'}},{type:'text',sessionID:'sess',part:{id:'p',text:'answer'}},{type:'step_finish',sessionID:'sess',part:{id:'s',cost:0,tokens:{input:0,output:2,cache:{read:0,write:0}}}}]; frames.forEach(f=>console.log(JSON.stringify(f)));`);
    args.resume = "sess";
    args.model = "provider/model";
    const out = await collect(args);
    expect(out.filter((m) => m.type === "assistant")).toEqual([
      { type: "assistant", text: "answer", session_id: "sess" },
    ]);
    expect(out.at(-1)).toMatchObject({
      type: "result",
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 2,
    });
  });
  it("preserves absent usage and pairs tool ids with error completion", async () => {
    const out = await collect(
      fixture(
        `console.log(JSON.stringify({type:'tool_use',sessionID:'s',part:{id:'p',callID:'call',tool:'bash',state:{status:'error',input:{command:'false'},error:'failed'}}}));console.log(JSON.stringify({type:'text',sessionID:'s',part:{id:'t',text:'done'}}));`,
      ),
    );
    expect(out[0]).toMatchObject({
      type: "tool_use",
      tool_use_id: "call",
      tool: "bash",
    });
    expect(out[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call",
      is_error: true,
    });
    expect(out.at(-1)).not.toHaveProperty("cost_usd");
    expect(out.at(-1)).not.toHaveProperty("input_tokens");
  });
  it.each(["scoped", "read"] as const)(
    "rejects %s before executing any binary, even with broad config/daemon",
    async (access) => {
      const args = fixture(`process.exit(99)`);
      args.access = access;
      args.env.KILO_CLI_BIN = "/missing";
      args.env.KILO_SERVER_URL = "http://localhost:9999";
      await expect(collect(args)).rejects.toMatchObject({
        code: "unsupported",
      });
    },
  );
  it("rejects partial settings, caller tools, sandbox and budgets before spawning", async () => {
    for (const change of [
      { settingSources: [] },
      { sandbox: "workspace-write" },
      { tools: [{ name: "x" }] },
      { usdBudget: () => ({ left: 1 }) },
      { tokenBudget: () => ({ left: 100, max: 100 }) },
    ]) {
      const args = fixture("");
      Object.assign(args, change);
      args.env.KILO_CLI_BIN = "/missing";
      await expect(collect(args)).rejects.toMatchObject({
        code: "unsupported",
      });
    }
  });
  it.each([
    ['console.log("broken")', "bad-frame"],
    ['console.log(JSON.stringify({type:"error",error:{data:{message:"insufficient credits"}}}))', 'quota'],
    ['console.log(JSON.stringify({type:"error",error:{data:{message:"429 rate limit exceeded"}}}))', 'rate-limited'],
    ['console.log(JSON.stringify({type:"error",error:{name:"ProviderModelNotFoundError",data:{message:"model not found"}}}))', 'runner-error'],
    ["", "runner-error"],
    [
      'console.log(JSON.stringify({type:"error",error:{name:"AuthError",data:{message:"Unauthorized"}}}))',
      "auth",
    ],
  ] as const)("classifies %s", async (body, code) => {
    await expect(collect(fixture(body))).rejects.toMatchObject({ code });
  });
  it("hands the sections private-home variables to the child (the registry's kilo entry relies on it)", async () => {
    const args =
      fixture(`console.log(JSON.stringify({type:'text',sessionID:'s',part:{id:'p',text:[process.env.HOME,process.env.XDG_DATA_HOME,process.env.XDG_STATE_HOME].join('|')}}));`);
    args.env = { ...args.env, HOME: "/iso/private", XDG_DATA_HOME: "/iso/private/.local/share", XDG_STATE_HOME: "/iso/private/.local/state" };
    const text = (await collect(args)).find((m) => m.type === "assistant")?.text;
    expect(text).toBe("/iso/private|/iso/private/.local/share|/iso/private/.local/state");
  });
  it("bounds a silent process independently of cost", async () => {
    await expect(
      collect(fixture("setInterval(()=>{},1000)"), 100),
    ).rejects.toMatchObject({ code: "timeout" });
  });
  it("cancels a silent process", async () => {
    const args = fixture("setInterval(()=>{},1000)");
    const controller = new AbortController();
    args.signal = controller.signal;
    const pending = collect(args);
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
  it("Freebuff refuses execution without invoking a binary", async () => {
    const args = fixture("");
    args.env.FREEBUFF_CLI_BIN = "/missing";
    await expect(
      (async () => {
        for await (const _ of new FreebuffAgentRunner().run(args)) {
          /* no frames */
        }
      })(),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});

it('discovery distinguishes interactive-only installation from verified full-only execution', async () => {
  const { scanInstalled } = await import('../../src/orgrt/runner-registry.js');
  const args = fixture('process.exit(99)');
  const scan = await scanInstalled({ env: { PATH: '', KILO_CLI_BIN: args.env.KILO_CLI_BIN, FREEBUFF_CLI_BIN: args.env.KILO_CLI_BIN } });
  const freebuff = scan.agents.find(agent => agent.id === 'freebuff')!;
  expect(freebuff).toMatchObject({ installed: true, binary: args.env.KILO_CLI_BIN, execution_supported: false, full_access: false, access_modes: [], sandbox_modes: [], init_target: null });
  expect(freebuff.execution_unsupported_reason).toBeTruthy();
  const kilo = scan.agents.find(agent => agent.id === 'kilo')!;
  expect(kilo).toMatchObject({ installed: true, binary: args.env.KILO_CLI_BIN, execution_supported: true, execution_unsupported_reason: null, full_access: true, access_modes: ['full'], resume: true, reports_cost: true, tool_activity_fidelity: 'full', init_target: null });
  for (const runtime of ['freebuff', 'kilo']) expect(scan.agents.find(agent => agent.id === runtime)!.install).toEqual({ kind: 'npm', packages: [runtime === 'kilo' ? '@kilocode/cli@7.8.3' : 'freebuff'] });
});
it('disables daemon reuse regardless of inherited or caller environment', async () => {
  const args=fixture(`if(process.env.KILO_NO_DAEMON !== '1') process.exit(99);console.log(JSON.stringify({type:'text',sessionID:'s',part:{id:'p',text:'done'}}));`);
  args.env.KILO_NO_DAEMON='';
  args.canUseTool=async()=>({behavior:'allow'});
  expect((await collect(args)).at(-1)).toMatchObject({type:'result',subtype:'success'});
});
it('meters costs cumulatively across mailbox prompts', async () => {
  const args=fixture(`console.log(JSON.stringify({type:'text',sessionID:'s',part:{id:'p',text:'done'}}));console.log(JSON.stringify({type:'step_finish',sessionID:'s',part:{id:'step',cost:0.1}}));`);
  args.prompt=(async function*(){yield 'one';yield 'two';})();
  expect((await collect(args)).filter(m=>m.type==='result').map(m=>m.cost_usd)).toEqual([0.1,0.2]);
});
it('rejects missing binaries and unsupported versions with explicit codes', async () => {
  const args=fixture('');
  args.env.KILO_CLI_BIN='/missing-kilo';
  await expect(collect(args)).rejects.toMatchObject({code:'ENOENT'});
  const old=fixture('');
  const {readFileSync}=await import('node:fs');
  writeFileSync(old.env.KILO_CLI_BIN,readFileSync(old.env.KILO_CLI_BIN,'utf8').replace('7.8.3','7.8.2'),{mode:0o700});
  await expect(collect(old)).rejects.toMatchObject({code:'unsupported'});
});

it('scan probes refuse old versions and withhold ready execution capabilities', async () => {
  const args=fixture('');
  const {readFileSync}=await import('node:fs');
  writeFileSync(args.env.KILO_CLI_BIN,readFileSync(args.env.KILO_CLI_BIN,'utf8').replace('7.8.3','7.8.2'),{mode:0o700});
  rmSync(join(args.cwd,'package.json'));
  const {scanInstalled}=await import('../../src/orgrt/runner-registry.js');
  const scan=await scanInstalled({env:{PATH:'',KILO_CLI_BIN:args.env.KILO_CLI_BIN},probe:true});
  expect(scan.agents.find(entry=>entry.id==='kilo')).toMatchObject({version:'7.8.2',execution_supported:false,full_access:false,access_modes:[],sandbox_modes:[],resume:false,reports_cost:false,tool_activity_fidelity:'none'});
  expect(scan.agents.find(entry=>entry.id==='kilo')?.execution_unsupported_reason).toContain('7.8.3');
});

it('refuses unverified effort or malformed model without running a binary', async()=>{
  for(const change of [{effort:'high'},{model:'without-provider'}]) {
    const args=fixture('');Object.assign(args,change);args.env.KILO_CLI_BIN='/missing';
    await expect(collect(args)).rejects.toMatchObject({code:'unsupported'});
  }
});

import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { execErrorCode } from './agent-exec-errors.js';
import {
  type AgentMessage,
  type AgentRunArgs,
  type AgentRunner,
  killOnAbort,
} from './agent-runner.js';
import { maskedCommand } from './authority-mask.js';
import { kiloVersionRefusal } from './kilo-version.js';
import { spawnRunnerProcess } from './process-group-spawn.js';
import { RunnerTransportError } from './runner-transport-error.js';

/** Live-verified against Kilo 7.8.3 with a zero-priced OpenRouter model:
 * native write/read, resume, zero-cost usage, and user/project/local settings.
 * JSON text events are completed parts, not token deltas. Scoped confinement
 * is deliberately refused. Daemon reuse is disabled for every child. */
export class KiloAgentRunner implements AgentRunner {
  constructor(private options: { timeoutMs?: number } = {}) {}
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    if (args.access !== 'full' || (args.sandbox && args.sandbox !== 'full'))
      throw new RunnerTransportError(
        'unsupported',
        'Kilo scoped/read/sandbox confinement is unverified; refusing before spawning.',
      );
    if (args.tools.length || args.claudeRestrictions || args.tokenBudget || args.usdBudget)
      throw new RunnerTransportError(
        'unsupported',
        'Kilo caller tools, restrictions and hard budgets are unsupported; refusing before spawning.',
      );
    if (
      !['user', 'project', 'local'].every((source) =>
        args.settingSources?.includes(source as 'user'),
      )
    )
      throw new RunnerTransportError(
        'unsupported',
        'Kilo loads user/project/local settings together. Explicitly request all three; isolated or partial settings are unsupported.',
      );
    if (args.model && !/^[^\s/]+\/[^\s]+$/.test(args.model))
      throw new RunnerTransportError('unsupported', 'Kilo --model must be provider/model.');
    if (args.effort)
      throw new RunnerTransportError(
        'unsupported',
        'Kilo effort requires verified per-model variants; abstract effort mapping is not implemented.',
      );
    if (args.signal?.aborted)
      throw new RunnerTransportError('cancelled', 'Kilo cancelled before spawning.');
    const env = { ...process.env, ...args.env, KILO_NO_DAEMON: '1' };
    // Provider keys are accepted only when explicitly supplied by the caller.
    for (const key of Object.keys(env))
      if (key.startsWith('ANTHROPIC_') && !(key in args.env)) delete env[key];
    const bin = args.env.KILO_CLI_BIN?.trim() || process.env.KILO_CLI_BIN?.trim() || 'kilo';
    const [versionBin, versionArgv] = maskedCommand(args.authorityMask, bin, ['--version']);
    let versionText: string;
    try {
      const version = await promisify(execFile)(versionBin, versionArgv, {
        cwd: args.cwd,
        env,
        timeout: 5000,
        maxBuffer: 65536,
        signal: args.signal,
      });
      versionText = version.stdout.trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
      if (args.signal?.aborted)
        throw new RunnerTransportError('cancelled', 'Kilo cancelled during version verification.');
      throw new RunnerTransportError(
        'unsupported',
        'Kilo --version could not verify the required CLI 7.8.3. Install @kilocode/cli@7.8.3 or check KILO_CLI_BIN.',
      );
    }
    const versionRefusal = kiloVersionRefusal(versionText);
    if (versionRefusal) throw new RunnerTransportError('unsupported', versionRefusal);
    let session = args.resume;
    let sessionCost: number | undefined;
    for await (const prompt of args.prompt) {
      if (args.signal?.aborted)
        throw new RunnerTransportError('cancelled', 'Kilo cancelled before spawning.');
      const argv = ['run', '--format', 'json', '--dir', args.cwd, '--dangerously-skip-permissions'];
      if (args.model) argv.push('--model', args.model);
      if (session) argv.push('--session', session);
      const proc = spawnRunnerProcess(
        ...maskedCommand(args.authorityMask, bin, argv),
        { cwd: args.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] },
        args,
      );
      const child = proc.child;
      let stderr = '',
        timedOut = false;
      const exited = new Promise<{ code: number | null; error?: Error }>((resolve) => {
        child.once('error', (error) => resolve({ code: null, error }));
        child.once('close', (code) => resolve({ code }));
      });
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-65536);
      });
      // EPIPE arrives when the CLI rejects configuration before reading stdin.
      child.stdin?.on('error', () => {});
      const unsubscribe = killOnAbort(args.signal, proc.target, 100);
      const timer = setTimeout(
        () => {
          timedOut = true;
          proc.target.kill('SIGTERM');
          const escalation = setTimeout(() => proc.target.kill('SIGKILL'), 100);
          escalation.unref();
        },
        this.options.timeoutMs ?? 2 * 60 * 60 * 1000,
      );
      let output = false;
      const seen = new Set<string>();
      const totals: Pick<
        AgentMessage,
        | 'input_tokens'
        | 'output_tokens'
        | 'cache_read_input_tokens'
        | 'cache_creation_input_tokens'
        | 'cost_usd'
      > = {};
      try {
        const text =
          typeof prompt === 'string' ? prompt : (prompt?.message?.content ?? String(prompt ?? ''));
        child.stdin?.end(args.systemPrompt ? `${args.systemPrompt}\n\n${text}` : text);
        const lines = createInterface({
          input: child.stdout!,
          crlfDelay: Infinity,
        });
        for await (const line of lines) {
          if (!line.trim()) continue;
          if (line.length > 1024 * 1024)
            throw new RunnerTransportError('bad-frame', 'Kilo JSON frame exceeded 1 MiB.');
          let frame: any;
          try {
            frame = JSON.parse(line);
          } catch {
            throw new RunnerTransportError('bad-frame', 'Kilo emitted malformed JSON.');
          }
          if (!frame || typeof frame.type !== 'string')
            throw new RunnerTransportError('bad-frame', 'Kilo frame has no event type.');
          if (typeof frame.sessionID === 'string') session = frame.sessionID;
          const part = frame.part;
          if (frame.type === 'error') {
            const message =
              typeof frame.error === 'string'
                ? frame.error
                : (frame.error?.data?.message ?? frame.error?.name ?? 'Kilo provider failed');
            const { code } = execErrorCode(undefined, `${frame.error?.name ?? ''}: ${message}`);
            throw new RunnerTransportError(
              frame.error?.name === 'AuthError' ||
                /unauthorized|authentication|invalid api key/i.test(message)
                ? 'auth'
                : code,
              message,
            );
          }
          if (!part) continue;
          const key = `${frame.type}:${part.id ?? ''}`;
          if (part.id && seen.has(key)) continue;
          if (part.id) seen.add(key);
          if (frame.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
            output = true;
            yield { type: 'assistant', text: part.text, session_id: session };
          }
          if (
            frame.type === 'tool_use' &&
            typeof part.callID === 'string' &&
            typeof part.tool === 'string'
          ) {
            proc.sampleNow();
            yield {
              type: 'tool_use',
              tool_use_id: part.callID,
              tool: part.tool,
              input: part.state?.input ?? {},
              session_id: session,
            };
            yield {
              type: 'tool_result',
              tool_use_id: part.callID,
              tool: part.tool,
              is_error: part.state?.status === 'error',
              text: part.state?.output ?? part.state?.error ?? '',
              session_id: session,
            };
          }
          if (frame.type === 'step_finish') {
            const metrics = {
              input_tokens: part.tokens?.input,
              output_tokens: part.tokens?.output,
              cache_read_input_tokens: part.tokens?.cache?.read,
              cache_creation_input_tokens: part.tokens?.cache?.write,
              cost_usd: part.cost,
            };
            for (const [key, value] of Object.entries(metrics))
              if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                const name = key as keyof typeof totals;
                totals[name] = (totals[name] ?? 0) + value;
              }
          }
        }
        const result = await exited;
        if (args.signal?.aborted) throw new RunnerTransportError('cancelled', 'Kilo cancelled.');
        if (timedOut)
          throw new RunnerTransportError('timeout', 'Kilo turn exceeded its execution timeout.');
        if (result.error) throw result.error;
        if (result.code !== 0) {
          const message = stderr || `Kilo exited ${result.code}`;
          throw new RunnerTransportError(execErrorCode(undefined, message).code, message);
        }
        if (!output)
          throw new RunnerTransportError(
            'runner-error',
            'Kilo completed without assistant output.',
          );
        if (totals.cost_usd !== undefined) sessionCost = (sessionCost ?? 0) + totals.cost_usd;
        yield {
          type: 'result',
          subtype: 'success',
          session_id: session,
          ...totals,
          ...(sessionCost !== undefined ? { cost_usd: sessionCost } : {}),
        };
      } finally {
        clearTimeout(timer);
        unsubscribe();
        proc.target.kill('SIGTERM');
        const escalation = setTimeout(() => proc.target.kill('SIGKILL'), 100);
        escalation.unref();
        proc.stop();
      }
    }
  }
}

/**
 * CLI Providers Command
 * Manage AI providers, models, and configurations
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { configManager } from '../services/config-file-manager.js';

// Configure subcommand
const configureCommand: Command = {
  name: 'configure',
  description: 'Configure provider settings and API keys',
  options: [
    { name: 'provider', short: 'p', type: 'string', description: 'Provider name', required: true },
    { name: 'key', short: 'k', type: 'string', description: 'API key' },
    { name: 'model', short: 'm', type: 'string', description: 'Default model' },
    { name: 'endpoint', short: 'e', type: 'string', description: 'Custom endpoint URL' },
  ],
  examples: [
    { command: 'monomind providers configure -p openai -k sk-...', description: 'Set OpenAI key' },
    { command: 'monomind providers configure -p anthropic -m claude-3.5-sonnet', description: 'Set default model' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const provider = ((ctx.flags.provider as string) || (ctx.args && ctx.args[0]) || '').slice(0, 64);
      const apiKey = (ctx.flags.key as string | undefined)?.slice(0, 256);
      const model = (ctx.flags.model as string | undefined)?.slice(0, 128);
      const endpoint = (ctx.flags.endpoint as string | undefined)?.slice(0, 512);

      if (!provider) {
        output.printError('Provider name is required. Use -p <name> or pass as first argument.');
        return { success: false, exitCode: 1 };
      }

      const cwd = process.cwd();
      const config = configManager.getConfig(cwd);

      // Ensure agents.providers array exists
      const agents = (config.agents ?? {}) as Record<string, unknown>;
      const providers = (agents.providers ?? []) as Array<Record<string, unknown>>;

      // Find existing provider entry or create a new one
      let entry = providers.find(
        (p) => typeof p.name === 'string' && p.name.toLowerCase() === provider.toLowerCase(),
      );

      if (!entry) {
        entry = { name: provider, enabled: true };
        providers.push(entry);
      }

      // Warn when key is supplied via CLI flag (visible in process table and shell history)
      if (apiKey !== undefined) {
        output.writeln(output.warning('  Warning: passing API keys via --key exposes them in process listings and shell history. Prefer setting the environment variable instead.'));
      }
      if (apiKey !== undefined) entry.apiKey = apiKey;
      if (model !== undefined) entry.model = model;
      if (endpoint !== undefined) entry.baseUrl = endpoint;

      agents.providers = providers;
      configManager.set(cwd, 'agents.providers', providers);

      output.writeln();
      output.writeln(output.bold(`Configured: ${provider}`));
      output.writeln(output.dim('─'.repeat(40)));

      if (apiKey) output.writeln(`  API Key : ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`);
      if (model) output.writeln(`  Model   : ${model}`);
      if (endpoint) output.writeln(`  Endpoint: ${endpoint}`);
      if (!apiKey && !model && !endpoint) {
        output.writeln(`  Provider "${provider}" registered (no settings changed).`);
      }

      output.writeln();
      output.writeln(output.success(`Provider "${provider}" configuration saved.`));
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Failed to configure provider: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Test subcommand
const testCommand: Command = {
  name: 'test',
  description: 'Test provider connectivity and API access',
  options: [
    { name: 'provider', short: 'p', type: 'string', description: 'Provider to test' },
    { name: 'all', short: 'a', type: 'boolean', description: 'Test all configured providers' },
  ],
  examples: [
    { command: 'monomind providers test -p openai', description: 'Test OpenAI connection' },
    { command: 'monomind providers test --all', description: 'Test all providers' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const provider = ((ctx.flags.provider as string) || (ctx.args && ctx.args[0]) || '').slice(0, 64);
      const testAll = ctx.flags.all as boolean;

      output.writeln();
      output.writeln(output.bold('Provider Connectivity Test'));
      output.writeln(output.dim('─'.repeat(50)));

      const cwd = process.cwd();
      const config = configManager.getConfig(cwd);
      const agents = (config.agents ?? {}) as Record<string, unknown>;
      const configuredProviders = (agents.providers ?? []) as Array<Record<string, unknown>>;

      // Build list of providers to test
      interface ProviderCheck {
        name: string;
        test: () => Promise<{ pass: boolean; reason: string }>;
      }

      const getConfigApiKey = (name: string): string | undefined => {
        const entry = configuredProviders.find(
          (p) => typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase(),
        );
        return entry?.apiKey as string | undefined;
      };

      const knownChecks: ProviderCheck[] = [
        {
          name: 'Anthropic',
          test: async () => {
            const key = process.env.ANTHROPIC_API_KEY || getConfigApiKey('anthropic');
            if (key) return { pass: true, reason: 'API key found' };
            return { pass: false, reason: 'ANTHROPIC_API_KEY not set and no apiKey in config' };
          },
        },
        {
          name: 'OpenAI',
          test: async () => {
            const key = process.env.OPENAI_API_KEY || getConfigApiKey('openai');
            if (key) return { pass: true, reason: 'API key found' };
            return { pass: false, reason: 'OPENAI_API_KEY not set and no apiKey in config' };
          },
        },
        {
          name: 'Google',
          test: async () => {
            const key = process.env.GOOGLE_API_KEY || getConfigApiKey('google');
            if (key) return { pass: true, reason: 'API key found' };
            return { pass: false, reason: 'GOOGLE_API_KEY not set and no apiKey in config' };
          },
        },
        {
          name: 'Ollama',
          test: async () => {
            const entry = configuredProviders.find(
              (p) => typeof p.name === 'string' && p.name.toLowerCase() === 'ollama',
            );
            const baseUrl = (entry?.baseUrl as string) || 'http://localhost:11434';
            let parsedBaseUrl: URL;
            try {
              parsedBaseUrl = new URL(baseUrl);
            } catch {
              return { pass: false, reason: 'Invalid URL in Ollama config' };
            }
            if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
              return { pass: false, reason: 'Only http/https URLs are permitted for Ollama endpoint' };
            }
            // SSRF defense: block cloud-metadata + RFC1918 private ranges by default.
            // Ollama is conventionally local, so allow loopback by default but
            // refuse metadata IPs and link-local. Set MONOMIND_OLLAMA_ALLOW_REMOTE=1
            // to opt into hitting non-loopback hosts (useful for dev clusters).
            const host = parsedBaseUrl.hostname;
            const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
              host === '0.0.0.0' || /^127\./.test(host);
            const isMetadata = host === '169.254.169.254' || /^169\.254\./.test(host) ||
              /^fe80:/i.test(host);
            const isPrivateV4 = /^10\./.test(host) ||
              /^192\.168\./.test(host) ||
              /^172\.(1[6-9]|2\d|3[01])\./.test(host);
            if (isMetadata) {
              return { pass: false, reason: `Refusing to fetch metadata IP ${host}` };
            }
            const allowRemote = process.env.MONOMIND_OLLAMA_ALLOW_REMOTE === '1';
            if (!isLoopback && (isPrivateV4 || !allowRemote)) {
              return { pass: false, reason: `Refusing non-loopback Ollama host ${host}. Set MONOMIND_OLLAMA_ALLOW_REMOTE=1 to override.` };
            }
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 3000);
              const res = await fetch(parsedBaseUrl.href, { signal: controller.signal });
              clearTimeout(timeout);
              if (res.ok) return { pass: true, reason: `Reachable at ${parsedBaseUrl.href}` };
              return { pass: false, reason: `HTTP ${res.status} from ${parsedBaseUrl.href}` };
            } catch {
              return { pass: false, reason: `Unreachable at ${parsedBaseUrl.href}` };
            }
          },
        },
      ];

      // Filter to requested provider or test all
      let checksToRun: ProviderCheck[];
      if (testAll || !provider) {
        checksToRun = knownChecks;
      } else {
        const match = knownChecks.find(
          (c) => c.name.toLowerCase() === provider.toLowerCase(),
        );
        if (match) {
          checksToRun = [match];
        } else {
          // Unknown provider -- check if it has a config entry with an apiKey
          checksToRun = [
            {
              name: provider,
              test: async () => {
                const key = getConfigApiKey(provider);
                if (key) return { pass: true, reason: 'API key found in config' };
                return { pass: false, reason: 'No API key in environment or config' };
              },
            },
          ];
        }
      }

      let anyPassed = false;
      const results: Array<{ name: string; pass: boolean; reason: string }> = [];

      for (const check of checksToRun) {
        const result = await check.test();
        results.push({ name: check.name, ...result });
        if (result.pass) anyPassed = true;
      }

      output.writeln();
      for (const r of results) {
        const icon = r.pass ? output.success('PASS') : output.error('FAIL');
        output.writeln(`  ${icon}  ${r.name}: ${r.reason}`);
      }

      output.writeln();
      if (anyPassed) {
        output.writeln(output.success(`${results.filter((r) => r.pass).length}/${results.length} provider(s) passed.`));
      } else {
        output.writeln(output.warning('No providers passed connectivity checks.'));
      }

      return { success: anyPassed };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Provider test failed: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Main providers command
export const providersCommand: Command = {
  name: 'providers',
  description: 'Manage AI providers, models, and configurations',
  subcommands: [configureCommand, testCommand],
  examples: [
    { command: 'monomind providers configure -p openai -k sk-...', description: 'Configure OpenAI' },
    { command: 'monomind providers test --all', description: 'Test all providers' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('MonoMind Provider Management'));
    output.writeln(output.dim('Multi-provider AI orchestration'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'configure - Configure provider settings and API keys',
      'test      - Test provider connectivity',
    ]);
    output.writeln();
    output.writeln(output.dim('github.com/monoes/monomind'));
    return { success: true };
  },
};

export default providersCommand;

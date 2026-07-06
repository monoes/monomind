/**
 * `monomind report-crash` — files a GitHub issue for a crash (or saves it
 * locally if no GitHub auth is available). Called by monomind's own
 * uncaught-exception handler, and shelled out to by mono-agent (Go),
 * monotask, and mono-clip (Rust) from their own panic/recover handlers.
 */

import { readFileSync, existsSync } from 'fs';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { reportCrash } from '../services/crash-reporter.js';

export const reportCrashCommand: Command = {
  name: 'report-crash',
  description: 'File a GitHub issue for a crash (used internally by monoes tools\' panic/exception handlers)',
  hidden: true,
  options: [
    { name: 'repo', description: 'GitHub repo, e.g. monoes/mono-agent', type: 'string', required: true },
    { name: 'title', description: 'Issue title', type: 'string', required: true },
    { name: 'body', description: 'Issue body text', type: 'string' },
    { name: 'body-file', description: 'Path to a file containing the issue body', type: 'string' },
    { name: 'signature', description: 'Stable dedup key for this crash type (derived from title if omitted)', type: 'string' },
  ],
  examples: [
    { command: 'monomind report-crash --repo monoes/mono-agent --title "panic: nil pointer in workflow.Run" --body-file /tmp/crash.txt', description: 'File a crash from a Go panic handler' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const repo = ctx.flags.repo as string;
    const title = ctx.flags.title as string;
    const bodyFile = ctx.flags['body-file'] as string | undefined;
    const signature = ctx.flags.signature as string | undefined;

    if (!repo || !title) {
      output.printError('--repo and --title are required');
      return { success: false, exitCode: 1 };
    }

    let body = (ctx.flags.body as string) || '';
    if (bodyFile) {
      if (!existsSync(bodyFile)) {
        output.printError(`--body-file not found: ${bodyFile}`);
        return { success: false, exitCode: 1 };
      }
      body = readFileSync(bodyFile, 'utf8');
    }

    const result = await reportCrash({ repo, title, body, signature });

    switch (result.status) {
      case 'created':
        output.printSuccess(result.message);
        break;
      case 'duplicate':
        output.printInfo(result.message);
        break;
      case 'saved-locally':
        output.printWarning(result.message);
        break;
      case 'disabled':
        output.printInfo(result.message);
        break;
      case 'rate-limited':
        output.printWarning(result.message);
        break;
      case 'error':
        output.printError(result.message);
        break;
    }

    return { success: result.status !== 'error', data: result };
  },
};

export default reportCrashCommand;

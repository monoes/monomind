// packages/@monomind/cli/src/commands/org-attach.ts
// `monomind org attach <org> <role>` — connects this terminal to a live
// pty-mode role's session (see orgrt/pty-runner.ts for the relay protocol).
// Kept out of org.ts to respect the 500-line file ceiling, matching how
// logs/report live in org-observe.ts.
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { ORG_DIR } from '../orgrt/types.js';
import { attachSocketPath, encodeDataFrame, encodeResizeFrame } from '../orgrt/pty-runner.js';
import { validateOrgName } from './org.js';

const log = (text: string): void => { console.log(text); };

export const attachAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const v = validateOrgName(ctx.args[0]);
  if (!v.ok) return v.result;
  const role = ctx.args[1];
  if (!role) return { success: false, message: 'usage: monomind org attach <org> <role>' };

  const orgsDir = join(ctx.cwd || process.cwd(), ORG_DIR);
  const path = attachSocketPath(orgsDir, v.name, role);
  if (!existsSync(path)) {
    return {
      success: false,
      message: `no live pty session for ${v.name}/${role} — the role must be running with pty: true (see role config) and currently active`,
    };
  }

  return new Promise<CommandResult>((resolve) => {
    const socket = createConnection(path);
    let cleanedUp = false;
    const restoreAndExit = (result: CommandResult) => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onStdin);
      process.stdout.removeListener('resize', onResize);
      socket.destroy();
      resolve(result);
    };

    const onStdin = (chunk: Buffer) => {
      // Ctrl-] (0x1d) detaches without killing the role.
      if (chunk.length === 1 && chunk[0] === 0x1d) {
        log('\n' + output.info('[monomind] detached'));
        restoreAndExit({ success: true, message: 'detached' });
        return;
      }
      socket.write(encodeDataFrame(chunk));
    };
    const onResize = () => {
      if (process.stdout.columns && process.stdout.rows) {
        socket.write(encodeResizeFrame(process.stdout.columns, process.stdout.rows));
      }
    };

    socket.on('connect', () => {
      log(output.info(`[monomind] attached to ${v.name}/${role} — Ctrl-] to detach`));
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onStdin);
      process.stdout.on('resize', onResize);
      onResize(); // sync initial size
    });
    // Server → client is raw pty bytes, meant for direct terminal rendering.
    socket.on('data', (chunk: Buffer) => { process.stdout.write(chunk); });
    socket.on('close', () => restoreAndExit({ success: true, message: 'session ended' }));
    socket.on('error', (err: Error) => restoreAndExit({ success: false, message: `attach failed: ${err.message}` }));
  });
};

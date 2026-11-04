/**
 * `monomind init --dry-run`: report every file init would create, modify or
 * skip, without writing anything to the project.
 *
 * The real init runs into a scratch directory (with HOME pointed there too,
 * so nothing global is registered); its output is then compared with the
 * project's current files. Nothing under the project root is touched.
 *
 * @module @monomind/cli/commands/init-dry-run
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeInit } from '../init/index.js';
import { resolveInitOptions } from '../init/resolve-options.js';
import { snapshotInitFiles } from '../init/written-files.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';

export type DryRunAction = 'create' | 'modify' | 'skip';
export interface DryRunEntry {
  path: string;
  action: DryRunAction;
}

function sameContent(a: string, b: string): boolean {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** Compare the files a scratch init produced with what the project has now. */
export function planDryRun(
  scratch: string,
  cwd: string,
  opts: { force: boolean; ifMissing: boolean; initialized: boolean },
): DryRunEntry[] {
  const files = [...snapshotInitFiles(scratch).files].sort();
  return files.map((rel) => {
    const target = path.join(cwd, rel);
    if (!fs.existsSync(target)) return { path: rel, action: 'create' };
    if (sameContent(path.join(scratch, rel), target)) return { path: rel, action: 'skip' };
    const keeps = opts.ifMissing || (opts.initialized && !opts.force);
    return { path: rel, action: keeps ? 'skip' : 'modify' };
  });
}

export async function runInitDryRun(ctx: CommandContext, cwd: string): Promise<CommandResult> {
  const json = ctx.flags.json === true || ctx.flags.format === 'json';
  const resolved = resolveInitOptions(ctx, cwd);
  if (!resolved.ok) return { success: false, exitCode: 1, message: resolved.message };

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-dry-run-'));
  const scratchHome = path.join(scratch, '.home');
  const project = path.join(scratch, 'project');
  fs.mkdirSync(scratchHome);
  fs.mkdirSync(project);
  const options = resolved.options;
  const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const realWrite = process.stdout.write.bind(process.stdout);
  let entries: DryRunEntry[];
  try {
    process.env.HOME = scratchHome;
    process.env.USERPROFILE = scratchHome;
    // executeInit prints as it goes; a preview shows only the plan.
    process.stdout.write = (() => true) as typeof process.stdout.write;
    const result = await executeInit({
      ...options,
      targetDir: project,
      installClaudeCode: false,
      deferDoctor: true,
      initMemory: false,
      interactive: false,
      components: { ...options.components, monograph: false },
    });
    process.stdout.write = realWrite;
    if (!result.success) {
      return { success: false, exitCode: 1, message: result.errors.join('; ') || 'dry run failed' };
    }
    const initialized =
      fs.existsSync(path.join(cwd, '.claude', 'settings.json')) ||
      fs.existsSync(path.join(cwd, '.monomind', 'config.yaml'));
    entries = planDryRun(project, cwd, {
      force: options.force === true,
      ifMissing: options.ifMissing === true,
      initialized,
    });
  } finally {
    process.stdout.write = realWrite;
    for (const [key, value] of Object.entries(realHome)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const count = (action: DryRunAction) => entries.filter((e) => e.action === action).length;
  const summary = { create: count('create'), modify: count('modify'), skip: count('skip') };
  if (json) {
    output.printJson({ dry_run: true, root: cwd, files: entries, summary });
  } else {
    output.writeln(output.bold('monomind init --dry-run (nothing was written)'));
    for (const e of entries) output.writeln(`  ${e.action.padEnd(6)} ${e.path}`);
    output.writeln();
    output.writeln(
      `Would create ${summary.create}, modify ${summary.modify}, skip ${summary.skip} files in ${cwd}`,
    );
    output.writeln(`Run ${output.highlight('monomind init')} to write them.`);
  }
  return { success: true, data: { dryRun: true, files: entries, summary } };
}

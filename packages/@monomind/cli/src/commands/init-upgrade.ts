/**
 * Init upgrade subcommand — update helpers without losing user data
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  executeUpgrade,
  executeUpgradeWithMissing,
  findMonomindProjects,
} from '../init/index.js';

export const upgradeCommand: Command = {
  name: 'upgrade',
  description: 'Update statusline and helpers while preserving existing data',
  options: [
    {
      name: 'verbose',
      short: 'v',
      description: 'Show detailed output',
      type: 'boolean',
      default: false,
    },
    {
      name: 'add-missing',
      short: 'a',
      description: 'Add any new skills, agents, and commands that are missing',
      type: 'boolean',
      default: false,
    },
    {
      name: 'settings',
      short: 's',
      description: 'Merge new settings (Agent Teams, hooks) into existing settings.json',
      type: 'boolean',
      default: false,
    },
    {
      name: 'all',
      description: 'Upgrade all known monomind projects on this machine (scans ~/Desktop, ~/projects, etc.)',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const addMissing = (ctx.flags['add-missing'] || ctx.flags.addMissing) as boolean;
    const upgradeSettings = (ctx.flags.settings) as boolean;
    const upgradeAll = (ctx.flags.all) as boolean;

    if (upgradeAll) {
      output.writeln();
      output.writeln(output.bold('Upgrading all monomind projects'));
      output.writeln(output.dim('Scanning ~/Desktop, ~/projects, ~/code… (this may take a moment)'));
      output.writeln();
      const projects = findMonomindProjects();
      if (projects.length === 0) {
        output.printInfo('No monomind projects found. Install monomind in a project first: npx monomind init');
        return { success: true, exitCode: 0 };
      }
      output.printInfo(`Found ${projects.length} project(s). Upgrading…`);
      output.writeln();
      let succeeded = 0; let failed = 0;

      // Try to read control URL for dashboard progress events (best-effort)
      let controlUrl = 'http://localhost:4242';
      try {
        const ctrlPath = path.join(process.cwd(), '.monomind', 'control.json');
        if (fs.existsSync(ctrlPath) && fs.statSync(ctrlPath).size <= 4096) {
          const ctrlCfg = JSON.parse(fs.readFileSync(ctrlPath, 'utf-8'));
          // Only allow localhost/127.0.0.1 URLs to prevent SSRF via attacker-controlled control.json
          if (typeof ctrlCfg.url === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(ctrlCfg.url)) {
            controlUrl = ctrlCfg.url;
          }
        }
      } catch {}

      const emitUpgradeProgress = async (projDir: string, status: 'success' | 'failed', current: number, total: number): Promise<void> => {
        try {
          const { default: http } = await import('http');
          const payload = JSON.stringify({ type: 'upgrade:progress', project: projDir, status, current, total, ts: Date.now() });
          const url = new URL(controlUrl + '/api/mastermind/event');
          const req = http.request({ hostname: url.hostname, port: parseInt(url.port || '4242'), path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } });
          req.write(payload); req.end();
          req.on('error', () => {});
        } catch {}
      };

      for (const projDir of projects) {
        const projIdx = projects.indexOf(projDir) + 1;
        const spinner = output.createSpinner({ text: `[${projIdx}/${projects.length}] ${projDir}` });
        spinner.start();
        try {
          const res = addMissing
            ? await executeUpgradeWithMissing(projDir, upgradeSettings)
            : await executeUpgrade(projDir, upgradeSettings);
          if (res.success) {
            spinner.succeed(projDir + ' (' + res.updated.length + ' updated)');
            succeeded++;
            emitUpgradeProgress(projDir, 'success', projIdx, projects.length);
          } else {
            spinner.fail(projDir + ' — ' + (res.errors[0] || 'unknown error'));
            failed++;
            emitUpgradeProgress(projDir, 'failed', projIdx, projects.length);
          }
        } catch (e: unknown) {
          spinner.fail(projDir + ' — ' + (e instanceof Error ? e.message : String(e)));
          failed++;
          emitUpgradeProgress(projDir, 'failed', projIdx, projects.length);
        }
      }
      output.writeln();
      output.printInfo(`Done: ${succeeded} upgraded, ${failed} failed out of ${projects.length} projects.`);
      return { success: failed === 0, exitCode: failed > 0 ? 1 : 0 };
    }

    output.writeln();
    output.writeln(output.bold('Upgrading MonoMind'));
    if (addMissing && upgradeSettings) {
      output.writeln(output.dim('Updates helpers, settings, and adds any missing skills/agents/commands'));
    } else if (addMissing) {
      output.writeln(output.dim('Updates helpers and adds any missing skills/agents/commands'));
    } else if (upgradeSettings) {
      output.writeln(output.dim('Updates helpers and merges new settings (Agent Teams, hooks)'));
    } else {
      output.writeln(output.dim('Updates helpers while preserving your existing data'));
    }
    output.writeln();

    const spinnerText = upgradeSettings
      ? 'Upgrading helpers and settings...'
      : (addMissing ? 'Upgrading and adding missing assets...' : 'Upgrading...');
    const spinner = output.createSpinner({ text: spinnerText });
    spinner.start();

    try {
      const result = addMissing
        ? await executeUpgradeWithMissing(ctx.cwd, upgradeSettings)
        : await executeUpgrade(ctx.cwd, upgradeSettings);

      if (!result.success) {
        spinner.fail('Upgrade failed');
        for (const error of result.errors) {
          output.printError(error);
        }
        return { success: false, exitCode: 1 };
      }

      spinner.succeed('Upgrade complete!');
      output.writeln();

      if (result.updated.length > 0) {
        output.printBox(
          result.updated.map(f => `✓ ${f}`).join('\n'),
          'Updated (latest version)'
        );
        output.writeln();
      }

      if (result.created.length > 0) {
        output.printBox(
          result.created.map(f => `+ ${f}`).join('\n'),
          'Created (new files)'
        );
        output.writeln();
      }

      if (result.preserved.length > 0 && ctx.flags.verbose) {
        output.printBox(
          result.preserved.map(f => `• ${f}`).join('\n'),
          'Preserved (existing data kept)'
        );
        output.writeln();
      } else if (result.preserved.length > 0) {
        output.printInfo(`Preserved ${result.preserved.length} existing data files`);
        output.writeln();
      }

      if (result.addedSkills && result.addedSkills.length > 0) {
        output.printBox(
          result.addedSkills.map(s => `+ ${s}`).join('\n'),
          `Added Skills (${result.addedSkills.length} new)`
        );
        output.writeln();
      }

      if (result.addedAgents && result.addedAgents.length > 0) {
        output.printBox(
          result.addedAgents.map(a => `+ ${a}`).join('\n'),
          `Added Agents (${result.addedAgents.length} new)`
        );
        output.writeln();
      }

      if (result.addedCommands && result.addedCommands.length > 0) {
        output.printBox(
          result.addedCommands.map(c => `+ ${c}`).join('\n'),
          `Added Commands (${result.addedCommands.length} new)`
        );
        output.writeln();
      }

      if (result.settingsUpdated && result.settingsUpdated.length > 0) {
        output.printBox(
          result.settingsUpdated.map(s => `+ ${s}`).join('\n'),
          'Settings Updated'
        );
        output.writeln();
      }

      output.printSuccess('Your statusline helper has been updated to the latest version');
      output.printInfo('Existing metrics and learning data were preserved');

      if (upgradeSettings && result.settingsUpdated && result.settingsUpdated.length > 0) {
        output.printSuccess('Settings.json updated with new Agent Teams configuration');
      }

      if (addMissing) {
        const totalAdded = (result.addedSkills?.length || 0) + (result.addedAgents?.length || 0) + (result.addedCommands?.length || 0);
        if (totalAdded > 0) {
          output.printSuccess(`Added ${totalAdded} missing assets to your project`);
        } else {
          output.printInfo('All skills, agents, and commands are already up to date');
        }
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Upgrade failed');
      output.printError(`Failed to upgrade: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

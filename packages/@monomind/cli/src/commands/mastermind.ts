/**
 * Portable Mastermind workflow fallback.
 *
 * Platforms without native skill loading can print a canonical procedure and
 * provide it to their agent without relying on any platform-specific prompt
 * injection or environment variable.
 */

import {
  MASTERMIND_SKILLS,
  renderSkillPackage,
  resolveMastermindSkill,
} from '../mastermind/manifest.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

function printSkillList(): void {
  for (const skill of MASTERMIND_SKILLS) {
    const aliases = skill.aliases.length > 0 ? ` (aliases: ${skill.aliases.join(', ')})` : '';
    output.writeln(`${skill.name}${aliases}\n  ${skill.description}`);
  }
}

export const mastermindCommand: Command = {
  name: 'mastermind',
  description: 'List or print portable Mastermind workflows for platforms without native skills',
  options: [
    {
      name: 'list',
      description: 'List canonical Mastermind workflows and aliases',
      type: 'boolean',
      default: false,
    },
    {
      name: 'print',
      description: 'Print the selected workflow package to standard output',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'monomind mastermind --list', description: 'List available workflows' },
    { command: 'monomind mastermind run plan --print', description: 'Print the planning workflow' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    if (ctx.flags.list === true) {
      printSkillList();
      return { success: true, data: MASTERMIND_SKILLS };
    }

    const [verb, requestedSkill] = ctx.args;
    if (verb !== 'run' || !requestedSkill) {
      output.error('Usage: monomind mastermind run <skill> --print, or monomind mastermind --list');
      return { success: false, exitCode: 1 };
    }

    const skill = resolveMastermindSkill(requestedSkill);
    if (!skill) {
      output.error(`Unknown Mastermind workflow: ${requestedSkill}`);
      output.info('Available workflows:');
      printSkillList();
      return { success: false, exitCode: 1 };
    }
    if (ctx.flags.print !== true) {
      output.error(
        'Only --print is supported for `mastermind run`; use --list to browse workflows',
      );
      return { success: false, exitCode: 1 };
    }

    output.writeln(renderSkillPackage(skill));
    return { success: true, data: { name: skill.name } };
  },
};

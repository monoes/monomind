// packages/@monomind/cli/src/orgrt/skill-tools.ts
/**
 * A role's skill tools: org_skill_load serves the full text of one of the
 * role's own skills (and reports the load, so the daemon can record it
 * against a task whose dispatch suggested it); org_skill_search searches the
 * org's whole skill library by name and description when none of the role's
 * skills covers the work. A role with no skills gets neither.
 */

import { z } from 'zod';
import type { OrgToolDef } from './agent-runner.js';
import { loadSkillText, roleSkillNames, skillSearchText } from './skill-library.js';
import type { OrgRole } from './types.js';

export function skillTools(
  role: OrgRole,
  skillRoot: string,
  onSkillLoad?: (role: string, name: string) => void,
): OrgToolDef[] {
  const allowedSkills = roleSkillNames(role, skillRoot);
  if (!allowedSkills.length) return [];
  const text = (t: string): { text: string } => ({ text: t });
  return [
    {
      name: 'org_skill_load',
      description: `Load the full text of one of your skills (or one of its reference files) when the work in front of you calls for it. Your skills: ${allowedSkills.join(', ')}.`,
      schema: { name: z.string(), file: z.string().optional() },
      handler: async (args) => {
        const name = args.name as string;
        if (!allowedSkills.includes(name)) {
          return text(
            `ERROR: "${name}" is not one of your skills. Yours: ${allowedSkills.join(', ')}`,
          );
        }
        const loaded = loadSkillText(name, args.file as string | undefined, skillRoot);
        if (!loaded.startsWith('ERROR')) onSkillLoad?.(role.id, name);
        return text(loaded);
      },
    },
    {
      name: 'org_skill_search',
      description:
        "Search the org's whole skill library (names and descriptions only) when none of your skills covers the work in front of you. Only your own skills can be loaded; for a match outside your pool, ask your coordinator to add it.",
      schema: { query: z.string() },
      handler: async (args) =>
        text(skillSearchText(args.query as string, allowedSkills, skillRoot)),
    },
  ];
}

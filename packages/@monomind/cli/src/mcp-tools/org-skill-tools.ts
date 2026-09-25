/**
 * `org_skill_show` — read one Org-library skill over MCP
 * (mcp__monomind__org_skill_show), the `invoke` of every Org skill that
 * `pick` and the prompt hook suggest. Same lookup as `monomind org skills
 * show`, so it works when monomind runs through npx and is not on PATH.
 * Read-only and local: catalog skills are served only while active for `org`
 * with a verifying package (getSkill's own gate).
 */
import { z } from 'zod';
import { getSkill, SKILL_NAME_RE } from '../orgrt/skill-library.js';
import { getProjectCwd, type MCPTool, type MCPToolResult } from './types.js';

/** An error the MCP client sees as one (isError), `{ error }` as its text. */
function toolError(error: string): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error }) }], isError: true };
}

const OrgSkillShowInput = z.object({
  name: z.string().regex(SKILL_NAME_RE, 'must be a skill name (a-z, 0-9, -)'),
});

export const orgSkillShowTool: MCPTool = {
  name: 'org_skill_show',
  description:
    'Read one Org-library skill by name — the `invoke` of an Org skill that `pick` suggests ' +
    '(`source: "org"`). Returns name, description, tags, tools, origin, the markdown body to ' +
    'follow, and `files` (extra reference .md files). Read-only and local.',
  category: 'org',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name, e.g. "systematic-debugging"' },
    },
    required: ['name'],
  },
  handler: async (input) => {
    const parsed = OrgSkillShowInput.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
      return toolError(`invalid input — ${issues.join('; ')}`);
    }
    const s = getSkill(parsed.data.name, getProjectCwd());
    if (!s) return toolError(`unknown org skill: ${parsed.data.name}`);
    const { name, description, tags, tools, origin, body, files } = s;
    return { name, description, tags, tools, origin, body, files };
  },
};

export const orgSkillTools: MCPTool[] = [orgSkillShowTool];

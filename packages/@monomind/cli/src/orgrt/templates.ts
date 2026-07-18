// packages/@monomind/cli/src/orgrt/templates.ts
// Starter org configs for `monomind org create <name> --template <t>`.
// Each validates against OrgDefSchema; goal is a placeholder the user edits
// (or supplies via --goal).
import { OrgDefSchema, type OrgDef } from './types.js';

interface TemplateRole { id: string; title: string; type: string; reports_to: string | null; responsibilities: string[] }
interface Template { goal: string; roles: TemplateRole[] }

export const ORG_TEMPLATES: Record<string, Template> = {
  'content-team': {
    goal: 'Produce and publish high-quality content on a steady cadence',
    roles: [
      { id: 'editor-in-chief', title: 'Editor in Chief', type: 'boss', reports_to: null,
        responsibilities: ['Own the content calendar and quality bar', 'Assign pieces to the writer and route drafts to review', 'Approve final drafts for publishing'] },
      { id: 'writer', title: 'Staff Writer', type: 'specialist', reports_to: 'editor-in-chief',
        responsibilities: ['Draft articles from assigned briefs', 'Incorporate review feedback', 'Hand finished drafts to the reviewer'] },
      { id: 'reviewer', title: 'Content Reviewer', type: 'reviewer', reports_to: 'editor-in-chief',
        responsibilities: ['Review drafts for accuracy, clarity, and tone', 'Return actionable feedback to the writer', 'Flag anything needing human judgment via ask_human'] },
    ],
  },
  'dev-team': {
    goal: 'Deliver features and fixes from a continuously groomed backlog',
    roles: [
      { id: 'tech-lead', title: 'Tech Lead', type: 'boss', reports_to: null,
        responsibilities: ['Break the goal into concrete tasks and assign them', 'Arbitrate design questions', 'Merge only work that passed review and tests'] },
      { id: 'developer', title: 'Developer', type: 'specialist', reports_to: 'tech-lead',
        responsibilities: ['Implement assigned tasks with tests', 'Keep changes small and focused', 'Send diffs to the reviewer before reporting done'] },
      { id: 'code-reviewer', title: 'Code Reviewer', type: 'reviewer', reports_to: 'tech-lead',
        responsibilities: ['Review diffs for correctness and maintainability', 'Verify claimed test results', 'Reject unverified work'] },
      { id: 'qa', title: 'QA Engineer', type: 'specialist', reports_to: 'tech-lead',
        responsibilities: ['Exercise delivered features end-to-end', 'File precise reproduction steps for defects'] },
    ],
  },
  'research-pod': {
    goal: 'Produce a recurring intelligence brief on a defined topic',
    roles: [
      { id: 'lead-analyst', title: 'Lead Analyst', type: 'boss', reports_to: null,
        responsibilities: ['Define research questions for each cycle', 'Synthesize findings into the final brief', 'Decide what merits deeper follow-up'] },
      { id: 'researcher', title: 'Researcher', type: 'researcher', reports_to: 'lead-analyst',
        responsibilities: ['Gather primary sources on assigned questions', 'Separate observed facts from inference', 'Deliver structured findings with citations'] },
      { id: 'fact-checker', title: 'Fact Checker', type: 'reviewer', reports_to: 'lead-analyst',
        responsibilities: ['Verify claims in draft briefs against sources', 'Flag unverifiable claims for removal or hedging'] },
    ],
  },
};

export function buildFromTemplate(templateName: string, orgName: string, goal?: string): OrgDef | null {
  const t = ORG_TEMPLATES[templateName];
  if (!t) return null;
  // Parse through the schema so a template can never produce an unrunnable config.
  return OrgDefSchema.parse({
    name: orgName,
    goal: goal ?? t.goal,
    status: 'stopped',
    schedule: null,
    run_config: { max_concurrent_agents: 4, budget_tokens: 1_000_000, memory_namespace: `org:${orgName}`, max_turns_per_message: 30 },
    roles: t.roles,
  });
}

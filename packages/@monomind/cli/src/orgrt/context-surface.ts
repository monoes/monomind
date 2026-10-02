// packages/@monomind/cli/src/orgrt/context-surface.ts
/**
 * The opt-in surface of org sections spec 6.8 (Phase 2): typed brief fields,
 * notes and the session cap exist only for an org that sets a
 * `run_config.context` key. Tool definitions are part of the cached prompt
 * prefix, so an org that adopts nothing keeps its tool list and prompt byte
 * for byte; adopting is a configuration change that starts new prefixes.
 *
 * The typed brief fields extend the existing free-text `brief` rather than add
 * a second one: they are rendered with the free text into one brief, bounded
 * by the same MAX_TASK_BRIEF and delivered by the same dispatch line.
 */
import { z } from 'zod';
import { MAX_TASK_BRIEF } from './task-dag.js';
import type { OrgDef } from './types.js';

export interface ContextSurface {
  /** Any context key adopted: the Phase 2 tools, fields and injection exist. */
  enabled: boolean;
  /** A task missing `objective` or `acceptance` is rejected, not warned about. */
  requireBrief: boolean;
  notes: boolean;
  sessionCap?: { tasks?: number; tokens?: number };
}

export function contextSurface(def: Pick<OrgDef, 'run_config'> | undefined): ContextSurface {
  const c = (def?.run_config as { context?: Record<string, unknown> } | undefined)?.context;
  const requireBrief = c?.require_brief;
  const notes = c?.notes === true;
  const sessionCap = c?.session_cap as ContextSurface['sessionCap'];
  return {
    enabled: requireBrief !== undefined || notes || sessionCap !== undefined,
    requireBrief: requireBrief === true,
    notes,
    ...(sessionCap ? { sessionCap } : {}),
  };
}

/** The longest `result` a delegated task may return (R20: a summary, never a transcript). */
export const MAX_TASK_RESULT = 1000;

/** Appended to org_task_done's description for an org on the surface. */
export const TASK_RESULT_HELP = ` With this org's context surface, \`result\` is a short summary of at most ${MAX_TASK_RESULT.toLocaleString('en-US')} characters plus the ids and file paths of what you produced. Put detail in a file and name its path; never paste your transcript. A longer result is rejected, not truncated, and the task stays open.`;

/** The rejection for an over-long result, or undefined. */
export function checkTaskResult(result: string | undefined): string | undefined {
  if (result === undefined || result.length <= MAX_TASK_RESULT) return undefined;
  return `result is ${result.length} characters, over the ${MAX_TASK_RESULT} allowed; return a short summary with the ids and file paths of what you produced, and put the detail in a file (nothing is truncated; the task is still open)`;
}

/** The typed brief fields, in the order they are rendered. */
export const BRIEF_FIELDS = ['objective', 'output', 'tools', 'boundaries', 'acceptance'] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
export type BriefFields = Partial<Record<BriefField, string>>;

const LABELS: Record<BriefField, string> = {
  objective: 'Objective',
  output: 'Output',
  tools: 'Tools',
  boundaries: 'Boundaries',
  acceptance: 'Acceptance',
};

/** Argument schemas for the typed fields, added to org_task and org_plan_graph
 *  nodes only when the surface is enabled. */
export function briefFieldArgs(): Record<BriefField, z.ZodType> {
  const text = z.string().max(MAX_TASK_BRIEF).optional();
  return { objective: text, output: text, tools: text, boundaries: text, acceptance: text };
}

/** The guidance appended to org_task's description when the surface is on. */
export const BRIEF_FIELD_HELP =
  ' Also give the typed brief fields: `objective` (what the task is for), `output` (what to hand back and in what format), `tools` (what to use and what to avoid), `boundaries` (what is out of scope) and `acceptance` (how it is judged done). They are rendered with `brief` into the one brief the assignee receives.';

export interface BriefCheck {
  /** The rendered brief to store and dispatch; absent when the task is rejected. */
  brief?: string;
  error?: string;
  warnings: string[];
}

const blank = (v: string | undefined): boolean => v === undefined || v.trim() === '';

/** Render and check one task's brief. `label` names the task in messages. */
export function checkBrief(
  surface: ContextSurface,
  fields: BriefFields,
  free: string | undefined,
  label = 'task',
): BriefCheck {
  const warnings: string[] = [];
  const must: BriefField[] = ['objective', 'acceptance'];
  const missingRequired = must.filter((f) => blank(fields[f]));
  if (surface.requireBrief && missingRequired.length)
    return {
      error: `${label}: this org requires a brief with ${must.join(' and ')}; missing ${missingRequired.join(' and ')}`,
      warnings,
    };
  for (const f of missingRequired) warnings.push(`${label}: no ${f} given`);
  if (surface.requireBrief)
    for (const f of BRIEF_FIELDS)
      if (!must.includes(f) && blank(fields[f])) warnings.push(`${label}: no ${f} given`);

  const lines = BRIEF_FIELDS.filter((f) => !blank(fields[f])).map(
    (f) => `${LABELS[f]}: ${fields[f]!.trim()}`,
  );
  const brief = lines.length
    ? free?.trim()
      ? `${lines.join('\n')}\n\n${free}`
      : lines.join('\n')
    : free;
  if (brief !== undefined && brief.length > MAX_TASK_BRIEF)
    return {
      error: `${label}: the rendered brief is ${brief.length} characters, over ${MAX_TASK_BRIEF}; shorten it or move detail into a file and name its path (nothing is truncated)`,
      warnings,
    };
  return { brief, warnings };
}

/** Add `warnings` to a tool result that is JSON, or append them to plain text. */
export function withWarnings(result: string, warnings: string[]): string {
  if (!warnings.length) return result;
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return JSON.stringify({ ...parsed, warnings });
  } catch {
    /* not JSON */
  }
  return `${result}\nwarnings: ${warnings.join('; ')}`;
}

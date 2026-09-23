// packages/@monomind/cli/src/orgrt/org-harness-tools.ts
/** Claude Code harness tools a headless org role must not reach: each
 *  one waits on a human who isn't there (AskUserQuestion, plan mode), or
 *  schedules and tracks work outside the org's own task DAG, where no other
 *  role or the daemon can see it (ScheduleWakeup, Cron*, Task*). The org
 *  equivalents are ask_human, org_task / org_tasks and org_task_block.
 *  Removed from the model's tool list for every claude-runtime role. */
export const ORG_DISALLOWED_HARNESS_TOOLS = [
  'AskUserQuestion',
  'ScheduleWakeup',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'CronCreate',
  'CronDelete',
  'CronList',
  'EnterPlanMode',
  'ExitPlanMode',
];

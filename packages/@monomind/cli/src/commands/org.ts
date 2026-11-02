// packages/@monomind/cli/src/commands/org.ts

import { output } from '../output.js';
import type { Command, CommandResult } from '../types.js';
import { approvePathsSubcommand } from './org-approve-paths.js';
import { memorySubcommand } from './org-memory-command.js';
import { drillGrantSubcommand } from './org-drill-grant.js';
import { signSubcommand } from './org-sign.js';
import {
  createSubcommand,
  deleteSubcommand,
  listSubcommand,
  markCompleteSubcommand,
  migrateSubcommand,
  validateSubcommand,
} from './org-subcommands-config.js';
import {
  answerSubcommand,
  approvalsSubcommand,
  approveSubcommand,
  denySubcommand,
  gateApproveSubcommand,
  gateRejectSubcommand,
  gatesSubcommand,
  inboxSubcommand,
  questionsSubcommand,
} from './org-subcommands-hil.js';
import {
  branchSubcommand,
  costsSubcommand,
  decisionsSubcommand,
  eventsSubcommand,
  flowSubcommand,
  logsSubcommand,
  replaySubcommand,
  reportSubcommand,
  resumeFromSubcommand,
  watchSubcommand,
} from './org-subcommands-observe.js';
import { roleSubcommand } from './org-subcommands-role.js';
import {
  pauseSubcommand,
  reloadSubcommand,
  resumeSubcommand,
  runSubcommand,
  serveSubcommand,
  skillsSubcommand,
  statusSubcommand,
  stopSubcommand,
  supervisorSubcommand,
  testLoopSubcommand,
} from './org-subcommands-runtime.js';

export {
  checkServeLock,
  classifyRun,
  clearReloadfile,
  clearStaleControlFiles,
  clearStopfile,
  isOrgPaused,
  listOrgConfigFiles,
  type RunLiveEvidence,
  type RunState,
  type ServeLockCheck,
  validateOrgName,
} from './org-control.js';
export {
  pollReloadfiles,
  pollRunfiles,
  pollStopfiles,
  runOutcomeResult,
  waitForRunEnd,
} from './org-poll.js';

const log = (text: string): void => {
  console.log(text);
};

export const orgCommand: Command = {
  name: 'org',
  description: 'SDK-based org runtime — run agent organizations as a controlled daemon',
  subcommands: [
    skillsSubcommand,
    runSubcommand,
    stopSubcommand,
    pauseSubcommand,
    resumeSubcommand,
    reloadSubcommand,
    statusSubcommand,
    serveSubcommand,
    supervisorSubcommand,
    testLoopSubcommand,
    logsSubcommand,
    eventsSubcommand,
    watchSubcommand,
    reportSubcommand,
    memorySubcommand,
    costsSubcommand,
    inboxSubcommand,
    flowSubcommand,
    questionsSubcommand,
    approvalsSubcommand,
    answerSubcommand,
    approveSubcommand,
    denySubcommand,
    gatesSubcommand,
    gateApproveSubcommand,
    gateRejectSubcommand,
    replaySubcommand,
    resumeFromSubcommand,
    branchSubcommand,
    decisionsSubcommand,
    createSubcommand,
    validateSubcommand,
    migrateSubcommand,
    listSubcommand,
    deleteSubcommand,
    markCompleteSubcommand,
    roleSubcommand,
    signSubcommand,
    drillGrantSubcommand,
    approvePathsSubcommand,
  ],
  examples: [
    { command: 'monomind org run my-org', description: 'Run an org under full daemon control' },
  ],
  action: async (): Promise<CommandResult> => {
    // index.ts's dispatcher never prints result.message on a failed action —
    // it only exits with result.exitCode — so this must log itself or bare
    // `monomind org` exits silently with code 1 and zero output.
    const message =
      'usage: monomind org <run|stop|status|serve|test-loop|logs|report|costs|inbox|questions|answer|approve|deny|replay|resume-from|branch|decisions|create|validate|migrate|list|delete|mark-complete|role|sign|approve-paths>';
    log(output.error(message));
    return { success: false, message };
  },
};

export default orgCommand;

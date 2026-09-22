/**
 * Browse Command — Native browser automation via Chrome DevTools Protocol
 * Provides ref-based element model and token-efficient accessibility snapshots
 *
 * This file is the command CATALOGUE: it assembles the `browse` root command
 * from the subcommand modules beside it and stays the single import point for
 * the package. The subcommands themselves are grouped by what the user is
 * doing:
 *
 *  - `session.ts`            the live CDP session every subcommand acts on,
 *                            plus the shared flag/output helpers.
 *  - `commands-session.ts`   open / connect / close / resize.
 *  - `commands-context.ts`   frame / tab / window / state.
 *  - `commands-page.ts`      snapshot / get / diff.
 *  - `commands-navigate.ts`  wait / scroll / navigate / set / pushstate.
 *  - `commands-input.ts`     mouse, keyboard, touch and drag input.
 *  - `commands-element.ts`   find / is / isvisible / isenabled / ischecked /
 *                            highlight.
 *  - `commands-files.ts`     screenshot / pdf / upload / download.
 *  - `commands-data.ts`      storage / cookies / clipboard / dialog /
 *                            console / errors.
 *  - `commands-trace.ts`     network / record / trace / profiler / vitals / har.
 *  - `commands-script.ts`    eval / batch / init scripts.
 *  - `commands-report.ts`    the one-command page report.
 */

import { createActionCommand } from './action.js';
import { wrapCommanderCommand } from './commander-adapter.js';
import { frameCommand, stateCommand, tabCommand, windowCommand } from './commands-context.js';
import {
  clipboardCommand,
  consoleLogCommand,
  cookiesCommand,
  dialogCommand,
  errorsCommand,
  storageCommand,
} from './commands-data.js';
import {
  findCommand,
  highlightCommand,
  isCommand,
  ischeckedCommand,
  isenabledCommand,
  isvisibleCommand,
} from './commands-element.js';
import { downloadCommand, pdfCommand, screenshotCommand, uploadCommand } from './commands-files.js';
import {
  checkCommand,
  clickCommand,
  dblclickCommand,
  dragCommand,
  fillCommand,
  focusCommand,
  hoverCommand,
  keyboardCommand,
  keydownCommand,
  keyupCommand,
  mouseCommand,
  pressCommand,
  scrollIntoViewCommand,
  selectCommand,
  swipeCommand,
  tapCommand,
  typeCommand,
  uncheckCommand,
} from './commands-input.js';
import {
  navigateCommand,
  pushstateCommand,
  scrollCommand,
  setCommand,
  waitCommand,
} from './commands-navigate.js';
import { diffCommand, getCommand, snapshotCommand } from './commands-page.js';
import { reportCommand } from './commands-report.js';
import {
  addinitscriptCommand,
  evalCommand,
  parseBatchCommandLine,
  removeinitscriptCommand,
} from './commands-script.js';
import { closeCommand, connectCommand, openCommand, resizeCommand } from './commands-session.js';
import {
  harCommand,
  networkCommand,
  profilerCommand,
  recordCommand,
  traceCommand,
  vitalsCommand,
} from './commands-trace.js';
import { output } from './output.js';
import { createPlatformCommand } from './platform.js';
import { applySessionPortFlag } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

// Re-exported for direct unit testing — these were exported from this file
// before the subcommands were split out, and the tests import them from here.
export { deriveBoxOutput } from './commands-page.js';
export { parseBatchCommandLine } from './commands-script.js';

// ---------------------------------------------------------------------------
// batch — dispatches over this file's own subcommand catalogue, which is why
// it lives here rather than with the other script commands.
// ---------------------------------------------------------------------------

const batchCommand: Command = {
  name: 'batch',
  description:
    'Execute multiple commands. Usage: monomind browse batch "open url" "snapshot -i" "click @e1"',
  options: [
    { name: 'bail', type: 'boolean', description: 'Stop on first error', default: false },
    { name: 'json', type: 'boolean', description: 'Input from JSON stdin', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const commands = ctx.args as string[];
    if (commands.length === 0) throw new Error('Usage: monomind browse batch "cmd1" "cmd2" ...');

    const results: Array<{ command: string; success: boolean; error?: string }> = [];
    for (const cmdStr of commands) {
      const { subName, subArgs, flags: preParsedFlags } = parseBatchCommandLine(cmdStr);

      const subCmd = browseCommand.subcommands?.find((s) => s.name === subName);
      if (!subCmd?.action) {
        const err = `Unknown command: ${subName}`;
        results.push({ command: cmdStr, success: false, error: err });
        if (ctx.flags.bail) break;
        continue;
      }

      try {
        const parsedFlags: CommandContext['flags'] = { _: [], ...preParsedFlags };
        const consumedIndices = new Set<number>();
        // Parse --flags from subArgs, tracking which indices are flag names/values
        for (let i = 0; i < subArgs.length; i++) {
          if (subArgs[i].startsWith('--')) {
            consumedIndices.add(i);
            const key = subArgs[i].slice(2);
            const next = subArgs[i + 1];
            const optDef = subCmd.options?.find((o) => o.name === key);
            const isBooleanFlag = optDef?.type === 'boolean';
            if (next && (!next.startsWith('-') || /^-\d/.test(next)) && !isBooleanFlag) {
              // Non-boolean flags consume the next token as their value (allow negative numbers like -1)
              consumedIndices.add(i + 1);
              if (optDef?.type === 'number') {
                parsedFlags[key] = Number(next);
              } else {
                parsedFlags[key] = next;
              }
              i++;
            } else if (isBooleanFlag && (next === 'true' || next === 'false')) {
              // Explicit boolean value token
              consumedIndices.add(i + 1);
              parsedFlags[key] = next !== 'false';
              i++;
            } else {
              parsedFlags[key] = true;
            }
          } else if (
            subArgs[i].startsWith('-') &&
            subArgs[i].length === 2 &&
            /[a-zA-Z]/.test(subArgs[i][1])
          ) {
            consumedIndices.add(i);
            const shortKey = subArgs[i][1];
            const optDef = subCmd.options?.find((o) => o.short === shortKey);
            if (optDef) {
              const key = optDef.name;
              const next = subArgs[i + 1];
              const isBooleanFlag = optDef.type === 'boolean';
              if (next && (!next.startsWith('-') || /^-\d/.test(next)) && !isBooleanFlag) {
                consumedIndices.add(i + 1);
                parsedFlags[key] = optDef.type === 'number' ? Number(next) : next;
                i++;
              } else if (isBooleanFlag && (next === 'true' || next === 'false')) {
                consumedIndices.add(i + 1);
                parsedFlags[key] = next !== 'false';
                i++;
              } else {
                parsedFlags[key] = true;
              }
            }
          }
        }
        const fakeCtx: CommandContext = {
          args: subArgs.filter((_, i) => !consumedIndices.has(i)),
          flags: parsedFlags,
          cwd: ctx.cwd,
          interactive: false,
        };

        const cmdResult = await subCmd.action(fakeCtx);
        const succeeded = cmdResult?.success !== false;
        results.push({
          command: cmdStr,
          success: succeeded,
          error: succeeded ? undefined : 'Command returned failure',
        });
        if (!succeeded && ctx.flags.bail) break;
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        results.push({ command: cmdStr, success: false, error: err });
        output.printWarning(`Batch error in "${cmdStr}": ${err}`);
        if (ctx.flags.bail) break;
      }
    }

    const failed = results.filter((r) => !r.success).length;
    output.printInfo(`Batch: ${results.length - failed}/${results.length} succeeded`);
    return { success: failed === 0, data: { results } };
  },
};

const actionSubcommand: Command = wrapCommanderCommand(createActionCommand);
const platformSubcommand: Command = wrapCommanderCommand(createPlatformCommand);

// ---------------------------------------------------------------------------
// Session selector
//
// Sessions are per-port (#318), so `--port N` is how any command says which
// one it means; without it a command resolves the newest live session in this
// directory. Wiring it here, once, gives every subcommand the selector
// without each action having to read the flag: session.port is set before the
// action runs, and that is what every ensureConnected(session.port) resolves.
// ---------------------------------------------------------------------------

const PORT_OPTION = {
  name: 'port',
  short: 'p',
  type: 'number',
  description: 'Act on the browse session on this CDP port (default: the newest live session)',
} as const;

function withSessionSelector(cmd: Command): Command {
  const action = cmd.action;
  return {
    ...cmd,
    options: cmd.options?.some((o) => o.name === 'port')
      ? cmd.options
      : [...(cmd.options ?? []), { ...PORT_OPTION }],
    action: action
      ? async (ctx: CommandContext) => {
          applySessionPortFlag(ctx.flags);
          return action(ctx);
        }
      : undefined,
    subcommands: cmd.subcommands?.map(withSessionSelector),
  };
}

// ---------------------------------------------------------------------------
// Root browse command
// ---------------------------------------------------------------------------

// Every subcommand gets the `--port` session selector (see
// withSessionSelector). batchCommand dispatches over this same array, so a
// batched command honours the selector too.
const subcommands: Command[] = [
  openCommand,
  snapshotCommand,
  clickCommand,
  dblclickCommand,
  fillCommand,
  typeCommand,
  pressCommand,
  keyboardCommand,
  keydownCommand,
  keyupCommand,
  hoverCommand,
  focusCommand,
  selectCommand,
  checkCommand,
  uncheckCommand,
  isvisibleCommand,
  isenabledCommand,
  ischeckedCommand,
  tapCommand,
  swipeCommand,
  scrollIntoViewCommand,
  dragCommand,
  uploadCommand,
  downloadCommand,
  mouseCommand,
  clipboardCommand,
  waitCommand,
  screenshotCommand,
  getCommand,
  scrollCommand,
  navigateCommand,
  setCommand,
  stateCommand,
  networkCommand,
  evalCommand,
  dialogCommand,
  frameCommand,
  tabCommand,
  windowCommand,
  consoleLogCommand,
  errorsCommand,
  storageCommand,
  cookiesCommand,
  pdfCommand,
  isCommand,
  findCommand,
  highlightCommand,
  diffCommand,
  pushstateCommand,
  batchCommand,
  addinitscriptCommand,
  removeinitscriptCommand,
  connectCommand,
  recordCommand,
  traceCommand,
  profilerCommand,
  vitalsCommand,
  reportCommand,
  harCommand,
  resizeCommand,
  closeCommand,
  actionSubcommand,
  platformSubcommand,
].map(withSessionSelector);

const browseCommand: Command = {
  name: 'browse',
  description: 'Native browser automation via Chrome DevTools Protocol',
  subcommands,
  options: [
    { ...PORT_OPTION },
    { name: 'session', short: 's', type: 'string', description: 'Named session to use' },
  ],
  examples: [
    { command: 'monomind browse open https://example.com', description: 'Open a URL' },
    {
      command: 'monomind browse snapshot -i',
      description: 'Interactive-only snapshot (93% token reduction)',
    },
    { command: 'monomind browse click @e3', description: 'Click element by ref' },
    { command: 'monomind browse fill @e1 "user@example.com"', description: 'Fill an input' },
    { command: 'monomind browse press Enter', description: 'Press Enter key' },
    { command: 'monomind browse wait --url "**/dashboard"', description: 'Wait for URL pattern' },
    { command: 'monomind browse wait --text "Success"', description: 'Wait for text' },
    { command: 'monomind browse wait --load networkidle', description: 'Wait for network idle' },
    { command: 'monomind browse screenshot ./output.png', description: 'Take screenshot' },
    { command: 'monomind browse get url', description: 'Get current URL' },
    { command: 'monomind browse scroll down', description: 'Scroll down 300px' },
    { command: 'monomind browse set viewport 375 812', description: 'Set mobile viewport' },
    { command: 'monomind browse state save my-session', description: 'Save session state' },
    { command: 'monomind browse navigate back', description: 'Navigate back' },
    { command: 'monomind browse eval "document.title"', description: 'Evaluate JavaScript' },
    {
      command: 'monomind browse network route --pattern "https://api.*" --abort',
      description: 'Abort API calls',
    },
    {
      command: 'monomind browse report https://example.com',
      description: 'One-command page report with a pass/fail verdict',
    },
    { command: 'monomind browse close', description: 'Close browser session' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.printInfo('Native browser automation via Chrome DevTools Protocol.');
    output.printInfo('');
    output.printInfo('Usage: monomind browse <subcommand> [options]');
    output.printInfo('');
    output.printInfo('Subcommands:');
    output.printInfo('  open           Open a URL');
    output.printInfo('  snapshot       Capture accessibility snapshot with refs');
    output.printInfo('  click          Click an element by ref');
    output.printInfo('  dblclick       Double-click an element');
    output.printInfo('  fill           Fill an input (clears first)');
    output.printInfo('  type           Type into element (appends)');
    output.printInfo('  press          Press a keyboard key');
    output.printInfo('  keyboard       Insert text directly');
    output.printInfo('  keydown        Hold a key down');
    output.printInfo('  keyup          Release a held key');
    output.printInfo('  hover          Hover over element');
    output.printInfo('  focus          Focus an element');
    output.printInfo('  select         Select a dropdown option');
    output.printInfo('  check          Check a checkbox');
    output.printInfo('  uncheck        Uncheck a checkbox');
    output.printInfo('  isvisible      Check if element is visible');
    output.printInfo('  isenabled      Check if element is enabled');
    output.printInfo('  ischecked      Check if checkbox/radio is checked');
    output.printInfo('  tap            Tap element with touch event (mobile)');
    output.printInfo('  scrollintoview Scroll element into view');
    output.printInfo('  drag           Drag element to another element');
    output.printInfo('  upload         Upload file(s) to file input');
    output.printInfo('  mouse          Fine-grained mouse control');
    output.printInfo('  clipboard      Read/write clipboard');
    output.printInfo('  wait           Wait for a condition');
    output.printInfo('  screenshot     Take a screenshot');
    output.printInfo('  get            Get page info (url, title, text, html)');
    output.printInfo('  scroll         Scroll the page');
    output.printInfo('  navigate       Navigate history (back/forward/reload)');
    output.printInfo('  set            Configure viewport, device, user agent');
    output.printInfo('  state          Save/load/list session state');
    output.printInfo('  network        Network interception and cookies');
    output.printInfo('  eval           Evaluate JavaScript');
    output.printInfo('  dialog         Handle browser dialogs');
    output.printInfo('  frame          Switch to iframe');
    output.printInfo('  tab            Tab management');
    output.printInfo('  console        View captured console messages');
    output.printInfo('  errors         View page JS errors');
    output.printInfo('  storage        localStorage/sessionStorage management');
    output.printInfo('  cookies        Cookie management');
    output.printInfo('  pdf            Save page as PDF');
    output.printInfo('  is             Check element state (visible/enabled/checked)');
    output.printInfo('  find           Find elements by semantic locators');
    output.printInfo('  highlight      Highlight an element visually');
    output.printInfo('  pushstate      SPA navigation via pushState');
    output.printInfo('  batch          Execute multiple commands');
    output.printInfo('  addinitscript  Add script to run before page navigation');
    output.printInfo('  removeinitscript Remove a previously added init script');
    output.printInfo('  report         Test a page and write an HTML report');
    output.printInfo('  close          Close the browser session');
    return { success: true };
  },
};

export default browseCommand;

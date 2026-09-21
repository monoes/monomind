/**
 * Acting on elements — mouse, keyboard, touch and drag input.
 *
 * Every command here targets an element by `@eN` ref or CSS selector and
 * performs a real input event through CDP, rather than scripting the DOM.
 */

import { output } from './output.js';
import { ensureConnected, getBrowser, session } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const clickCommand: Command = {
  name: 'click',
  description: 'Click an element by ref (@e1) or coordinates. Usage: monomind browse click @e1',
  options: [
    { name: 'right', type: 'boolean', description: 'Right-click', default: false },
    { name: 'double', type: 'boolean', description: 'Double-click', default: false },
    { name: 'x', type: 'number', description: 'X coordinate (for point click)' },
    { name: 'y', type: 'number', description: 'Y coordinate (for point click)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg && ctx.flags.x === undefined) throw new Error('Ref (@e1) or --x/--y required');

    if (ctx.flags.x !== undefined && ctx.flags.y !== undefined) {
      await browser.clickPoint(client, sessionId, ctx.flags.x as number, ctx.flags.y as number);
      output.printSuccess(`Clicked at (${ctx.flags.x}, ${ctx.flags.y})`);
      return { success: true };
    }

    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);

    await browser.clickElement(client, sessionId, ref, {
      button: ctx.flags.right ? 'right' : 'left',
      clickCount: ctx.flags.double ? 2 : 1,
    });

    output.printSuccess(`Clicked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const fillCommand: Command = {
  name: 'fill',
  description: 'Fill an input element. Usage: monomind browse fill @e1 "text value"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const refArg = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    if (!refArg || value === undefined) throw new Error('Usage: monomind browse fill @e1 "value"');

    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);

    await browser.fillElement(client, sessionId, ref, value);
    output.printSuccess(`Filled: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const pressCommand: Command = {
  name: 'press',
  description: 'Press a keyboard key. Usage: monomind browse press Enter',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const key = ctx.args[0] as string;
    if (!key) throw new Error('Key required. E.g.: monomind browse press Enter');

    await browser.pressKey(client, sessionId, key);
    output.printSuccess(`Pressed: ${key}`);
    return { success: true };
  },
};

export const dblclickCommand: Command = {
  name: 'dblclick',
  description: 'Double-click an element. Usage: monomind browse dblclick @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse dblclick @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.clickElement(client, sessionId, ref, { clickCount: 2 });
    output.printSuccess(`Double-clicked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const focusCommand: Command = {
  name: 'focus',
  description: 'Focus an element. Usage: monomind browse focus @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse focus @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.focusElement(client, sessionId, ref);
    output.printSuccess(`Focused: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const typeCommand: Command = {
  name: 'type',
  description:
    'Type text into element (appends, does not clear). Usage: monomind browse type @e1 "text"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    if (!refArg || value === undefined) throw new Error('Usage: monomind browse type @e1 "value"');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.typeIntoElement(client, sessionId, ref, value);
    output.printSuccess(`Typed into: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const keyboardCommand: Command = {
  name: 'keyboard',
  description: 'Keyboard commands. Usage: monomind browse keyboard type "text" | inserttext "text"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    const text = ctx.args[1] as string;
    if (!action || !text) throw new Error('Usage: monomind browse keyboard type|inserttext "text"');
    await browser.typeText(client, sessionId, text);
    output.printSuccess(`Keyboard ${action}: ${text.length} chars`);
    return { success: true };
  },
};

export const keydownCommand: Command = {
  name: 'keydown',
  description: 'Hold key down. Usage: monomind browse keydown Shift',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const key = ctx.args[0] as string;
    if (!key) throw new Error('Usage: monomind browse keydown <key>');
    await browser.keyDown(client, sessionId, key);
    output.printSuccess(`Key down: ${key}`);
    return { success: true };
  },
};

export const keyupCommand: Command = {
  name: 'keyup',
  description: 'Release held key. Usage: monomind browse keyup Shift',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const key = ctx.args[0] as string;
    if (!key) throw new Error('Usage: monomind browse keyup <key>');
    await browser.keyUp(client, sessionId, key);
    output.printSuccess(`Key up: ${key}`);
    return { success: true };
  },
};

export const hoverCommand: Command = {
  name: 'hover',
  description: 'Hover over an element. Usage: monomind browse hover @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse hover @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.hoverElement(client, sessionId, ref);
    output.printSuccess(`Hovered: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const selectCommand: Command = {
  name: 'select',
  description: 'Select a dropdown option. Usage: monomind browse select @e1 "Option text"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    if (!refArg || !value) throw new Error('Usage: monomind browse select @e1 "value"');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.selectOption(client, sessionId, ref, value);
    output.printSuccess(`Selected: "${value}"`);
    return { success: true };
  },
};

export const checkCommand: Command = {
  name: 'check',
  description: 'Check a checkbox. Usage: monomind browse check @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse check @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.checkElement(client, sessionId, ref, true);
    output.printSuccess(`Checked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const uncheckCommand: Command = {
  name: 'uncheck',
  description: 'Uncheck a checkbox. Usage: monomind browse uncheck @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse uncheck @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.checkElement(client, sessionId, ref, false);
    output.printSuccess(`Unchecked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const tapCommand: Command = {
  name: 'tap',
  description:
    'Tap element with a touch event (mobile testing). Usage: monomind browse tap @e1|"selector"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const arg = ctx.args[0] as string;
    if (!arg) throw new Error('Usage: monomind browse tap @e1|".selector"');
    // Get element center position
    let x: number, y: number;
    if (arg.startsWith('@') || /^e\d+$/.test(arg)) {
      const key = arg.startsWith('@') ? arg.slice(1) : arg;
      const ref = await browser.resolveRef(client, sessionId, session.refs, key);
      const box = await browser.getElementBox(client, sessionId, ref);
      if (!box) throw new Error(`Cannot get bounds for @${key}`);
      // box.x/box.y from getElementBox() ARE already the center point (see
      // its own doc comment) — adding width/2 here double-offset the tap
      // target away from the element (issue #15).
      x = Math.round(box.x);
      y = Math.round(box.y);
    } else {
      const posJson = (await browser.evaluateJs(
        client,
        sessionId,
        `(function(){var el=document.querySelector(${JSON.stringify(arg)});if(!el)return null;var r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`,
      )) as string | null;
      if (!posJson) throw new Error(`Selector not found: ${arg}`);
      const pos = JSON.parse(posJson) as { x: number; y: number };
      x = Math.round(pos.x);
      y = Math.round(pos.y);
    }
    await client.send(
      'Input.dispatchTouchEvent',
      { type: 'touchStart', touchPoints: [{ x, y }] },
      sessionId,
    );
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    output.printSuccess(`Tapped at (${x}, ${y})`);
    return { success: true, data: { x, y } };
  },
};

export const swipeCommand: Command = {
  name: 'swipe',
  description:
    'Swipe gesture (mobile). Usage: monomind browse swipe up|down|left|right [distance] [--x N] [--y N]',
  options: [
    {
      name: 'x',
      type: 'number',
      description: 'Start X coordinate (default: center)',
      default: 200,
    },
    {
      name: 'y',
      type: 'number',
      description: 'Start Y coordinate (default: center)',
      default: 400,
    },
    {
      name: 'distance',
      short: 'd',
      type: 'number',
      description: 'Swipe distance in pixels',
      default: 300,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const direction = ctx.args[0] as string as 'up' | 'down' | 'left' | 'right';
    if (!['up', 'down', 'left', 'right'].includes(direction)) {
      throw new Error(
        'Usage: monomind browse swipe up|down|left|right [--x N] [--y N] [--distance N]',
      );
    }
    const startX = (ctx.flags.x as number) ?? 200;
    const startY = (ctx.flags.y as number) ?? 400;
    const positionalDistance =
      ctx.args[1] !== undefined ? parseInt(ctx.args[1] as string, 10) : undefined;
    const distance =
      positionalDistance && Number.isFinite(positionalDistance)
        ? positionalDistance
        : ((ctx.flags.distance as number) ?? 300);
    const dx = direction === 'right' ? distance : direction === 'left' ? -distance : 0;
    const dy = direction === 'down' ? distance : direction === 'up' ? -distance : 0;

    await client.send(
      'Input.dispatchTouchEvent',
      { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] },
      sessionId,
    );
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(startX + (dx * i) / steps);
      const y = Math.round(startY + (dy * i) / steps);
      await client.send(
        'Input.dispatchTouchEvent',
        { type: 'touchMove', touchPoints: [{ x, y }] },
        sessionId,
      );
      await new Promise((r) => setTimeout(r, 16));
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);

    output.printSuccess(`Swiped ${direction} ${distance}px from (${startX},${startY})`);
    return { success: true, data: { direction, distance, startX, startY } };
  },
};

export const scrollIntoViewCommand: Command = {
  name: 'scrollintoview',
  description: 'Scroll element into view. Usage: monomind browse scrollintoview @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse scrollintoview @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.scrollIntoView(client, sessionId, ref);
    output.printSuccess(`Scrolled into view: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

export const dragCommand: Command = {
  name: 'drag',
  description: 'Drag element to another element. Usage: monomind browse drag @e1 @e2',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const srcArg = ctx.args[0] as string;
    const tgtArg = ctx.args[1] as string;
    if (!srcArg || !tgtArg) throw new Error('Usage: monomind browse drag @e1 @e2');
    const srcKey = srcArg.startsWith('@') ? srcArg.slice(1) : srcArg;
    const tgtKey = tgtArg.startsWith('@') ? tgtArg.slice(1) : tgtArg;
    const src = await browser.resolveRef(client, sessionId, session.refs, srcKey);
    const tgt = await browser.resolveRef(client, sessionId, session.refs, tgtKey);
    await browser.dragAndDrop(client, sessionId, src, tgt);
    output.printSuccess(`Dragged @${srcKey} to @${tgtKey}`);
    return { success: true };
  },
};

export const mouseCommand: Command = {
  name: 'mouse',
  description: 'Fine-grained mouse control. Usage: monomind browse mouse move|down|up|wheel <args>',
  options: [
    { name: 'button', type: 'string', description: 'Button: left|right|middle', default: 'left' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;

    switch (action) {
      case 'move': {
        const x = parseFloat(ctx.args[1] as string);
        const y = parseFloat(ctx.args[2] as string);
        await browser.mouseMove(client, sessionId, x, y);
        output.printSuccess(`Mouse moved to (${x}, ${y})`);
        break;
      }
      case 'down': {
        const x = parseFloat(ctx.args[1] as string) || 0;
        const y = parseFloat(ctx.args[2] as string) || 0;
        const button = (ctx.flags.button as 'left' | 'right' | 'middle') ?? 'left';
        await browser.mouseDown(client, sessionId, x, y, button);
        output.printSuccess(`Mouse down at (${x}, ${y})`);
        break;
      }
      case 'up': {
        const x = parseFloat(ctx.args[1] as string) || 0;
        const y = parseFloat(ctx.args[2] as string) || 0;
        const button = (ctx.flags.button as 'left' | 'right' | 'middle') ?? 'left';
        await browser.mouseUp(client, sessionId, x, y, button);
        output.printSuccess(`Mouse up at (${x}, ${y})`);
        break;
      }
      case 'wheel': {
        const x = parseFloat(ctx.args[1] as string) || 0;
        const y = parseFloat(ctx.args[2] as string) || 0;
        const dy = parseFloat(ctx.args[3] as string) || 0;
        const dx = parseFloat(ctx.args[4] as string) || 0;
        await browser.mouseWheel(client, sessionId, x, y, dy, dx);
        output.printSuccess(`Mouse wheel (${dx}, ${dy})`);
        break;
      }
      default:
        throw new Error('Usage: monomind browse mouse move|down|up|wheel <args>');
    }
    return { success: true };
  },
};

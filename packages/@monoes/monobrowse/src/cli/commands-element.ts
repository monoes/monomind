/**
 * Asking about elements — locating them by semantic query, and reading back
 * whether one is visible, enabled or checked.
 *
 * These answer questions; they never change the page (`highlight` aside, which
 * draws a temporary overlay).
 */

import type { ElementRef, FindAction } from '../index.js';
import { output } from './output.js';
import { ensureConnected, getBrowser, print, resolveElementObjectId, session } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const isvisibleCommand: Command = {
  name: 'isvisible',
  description: 'Check if element is visible. Usage: monomind browse isvisible @e1|"selector"',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const arg = ctx.args[0] as string;
    if (!arg) throw new Error('Usage: monomind browse isvisible @e1|".selector"');
    const objectId = await resolveElementObjectId(client, sessionId, session.refs, arg);
    const r = await client.send<{ result: { value?: boolean } }>(
      'Runtime.callFunctionOn',
      {
        functionDeclaration: `function(){var r=this.getBoundingClientRect(),s=window.getComputedStyle(this);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&parseFloat(s.opacity)>0;}`,
        objectId,
        returnByValue: true,
      },
      sessionId,
    );
    const visible = r.result?.value ?? false;
    if (ctx.flags.json) {
      print(JSON.stringify({ visible }));
    } else {
      output.printSuccess(`isvisible: ${visible}`);
    }
    return { success: true, data: { visible } };
  },
};

export const isenabledCommand: Command = {
  name: 'isenabled',
  description:
    'Check if element is enabled (not disabled). Usage: monomind browse isenabled @e1|"selector"',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const arg = ctx.args[0] as string;
    if (!arg) throw new Error('Usage: monomind browse isenabled @e1|".selector"');
    const objectId = await resolveElementObjectId(client, sessionId, session.refs, arg);
    const r = await client.send<{ result: { value?: boolean } }>(
      'Runtime.callFunctionOn',
      {
        functionDeclaration: `function(){return !this.disabled;}`,
        objectId,
        returnByValue: true,
      },
      sessionId,
    );
    const enabled = r.result?.value ?? true;
    if (ctx.flags.json) {
      print(JSON.stringify({ enabled }));
    } else {
      output.printSuccess(`isenabled: ${enabled}`);
    }
    return { success: true, data: { enabled } };
  },
};

export const ischeckedCommand: Command = {
  name: 'ischecked',
  description:
    'Check if checkbox/radio is checked. Usage: monomind browse ischecked @e1|"selector"',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const arg = ctx.args[0] as string;
    if (!arg) throw new Error('Usage: monomind browse ischecked @e1|".selector"');
    const objectId = await resolveElementObjectId(client, sessionId, session.refs, arg);
    const r = await client.send<{ result: { value?: boolean } }>(
      'Runtime.callFunctionOn',
      {
        functionDeclaration: `function(){var el=this,tag=el.tagName&&el.tagName.toUpperCase();if(tag==='INPUT'&&(el.type==='checkbox'||el.type==='radio'))return el.checked;var role=el.getAttribute&&el.getAttribute('role');if(role&&['checkbox','radio','switch','menuitemcheckbox','menuitemradio','option','treeitem'].indexOf(role)!==-1)return el.getAttribute('aria-checked')==='true';var label=tag!=='LABEL'?el.closest&&el.closest('label'):el;if(label&&label.control&&(label.control.type==='checkbox'||label.control.type==='radio'))return label.control.checked;var inp=el.querySelector&&el.querySelector('input[type="checkbox"],input[type="radio"]');return inp?inp.checked:false;}`,
        objectId,
        returnByValue: true,
      },
      sessionId,
    );
    const checked = r.result?.value ?? false;
    if (ctx.flags.json) {
      print(JSON.stringify({ checked }));
    } else {
      output.printSuccess(`ischecked: ${checked}`);
    }
    return { success: true, data: { checked } };
  },
};

export const isCommand: Command = {
  name: 'is',
  description: 'Check element state. Usage: monomind browse is visible|enabled|checked @e1',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const check = ctx.args[0] as string;
    const refArg = ctx.args[1] as string;
    if (!check || !refArg) throw new Error('Usage: monomind browse is visible|enabled|checked @e1');

    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);

    let result: boolean;
    switch (check) {
      case 'visible':
        result = await browser.isVisible(client, sessionId, ref);
        break;
      case 'enabled':
        result = await browser.isEnabled(client, sessionId, ref);
        break;
      case 'checked':
        result = await browser.isChecked(client, sessionId, ref);
        break;
      default:
        throw new Error(`Unknown check: ${check}. Use: visible|enabled|checked`);
    }

    if (ctx.flags.json) {
      print(JSON.stringify({ data: { [check]: result } }));
    } else {
      print(result ? 'true' : 'false');
    }
    return { success: true, data: { [check]: result } };
  },
};

export const findCommand: Command = {
  name: 'find',
  description:
    'Find elements by semantic locators. Usage: monomind browse find role|text|label|placeholder|testid|alttext|title|selector <value> [action]',
  options: [
    { name: 'name', type: 'string', description: 'Filter by accessible name' },
    { name: 'exact', type: 'boolean', description: 'Require exact match', default: false },
    { name: 'nth', type: 'number', description: 'Find nth match' },
    { name: 'last', type: 'boolean', description: 'Find last match', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const locator = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    const action = ctx.args[2] as FindAction | undefined;

    if (!locator || !value)
      throw new Error(
        'Usage: monomind browse find role|text|label|placeholder|testid|alttext|title|selector <value> [action]',
      );

    const opts = {
      name: ctx.flags.name as string,
      exact: ctx.flags.exact as boolean,
      nth: ctx.flags.nth as number,
      last: ctx.flags.last as boolean,
    };

    // alttext: find element by alt attribute (images, icons)
    if (locator === 'alttext') {
      // I2: use JS attribute comparison to avoid broken CSS selectors for values with spaces/quotes
      const valJson = JSON.stringify(value);
      const found = (await browser.evaluateJs(
        client,
        sessionId,
        `(function(v){var el=document.querySelector('img[alt]')||null;var all=document.querySelectorAll('[alt]');for(var i=0;i<all.length;i++){if(all[i].getAttribute('alt')===v){all[i].setAttribute('data-mm-located','true');return true;}}return false;})(${valJson})`,
      )) as boolean;
      if (!found) {
        output.printWarning(`alttext not found: ${value}`);
        return { success: false };
      }
      output.printSuccess(`Found element with alt="${value}"`);
      return { success: true, data: { alttext: value } };
    }

    // title: find element by title attribute
    if (locator === 'title') {
      // I2: use JS attribute comparison to avoid broken CSS selectors for values with spaces/quotes
      const valJson = JSON.stringify(value);
      const found = (await browser.evaluateJs(
        client,
        sessionId,
        `(function(v){var all=document.querySelectorAll('[title]');for(var i=0;i<all.length;i++){if(all[i].getAttribute('title')===v){all[i].setAttribute('data-mm-located','true');return true;}}return false;})(${valJson})`,
      )) as boolean;
      if (!found) {
        output.printWarning(`title not found: ${value}`);
        return { success: false };
      }
      output.printSuccess(`Found element with title="${value}"`);
      return { success: true, data: { title: value } };
    }

    let ref: ElementRef | null = null;
    switch (locator) {
      case 'role':
        ref = await browser.findByRole(client, sessionId, session.refs, value, opts);
        break;
      case 'text':
        ref = await browser.findByText(client, sessionId, session.refs, value, opts);
        break;
      case 'label':
        ref = await browser.findByLabel(client, sessionId, session.refs, value, opts);
        break;
      case 'placeholder':
        ref = await browser.findByPlaceholder(client, sessionId, session.refs, value, opts);
        break;
      case 'selector':
        ref = await browser.findBySelector(client, sessionId, session.refs, value, opts);
        break;
      case 'testid': {
        const sel = await browser.findByTestId(client, sessionId, value);
        if (!sel) {
          output.printWarning(`testid not found: ${value}`);
          return { success: false };
        }
        output.printSuccess(`Found testid selector: ${sel}`);
        return { success: true, data: { selector: sel } };
      }
      default:
        throw new Error(
          `Unknown locator: ${locator}. Use: role|text|label|placeholder|testid|alttext|title|selector`,
        );
    }

    if (!ref) {
      output.printWarning(`No element found: ${locator}="${value}"`);
      return { success: false };
    }

    output.printSuccess(`Found: ${ref.role} "${ref.name}" [@${ref.ref}]`);

    if (action) {
      switch (action) {
        case 'click':
          await browser.clickElement(client, sessionId, ref);
          break;
        case 'fill': {
          const fillValue = ctx.args[3] as string;
          await browser.fillElement(client, sessionId, ref, fillValue ?? '');
          break;
        }
        case 'type': {
          const typeValue = ctx.args[3] as string;
          await browser.typeIntoElement(client, sessionId, ref, typeValue ?? '');
          break;
        }
        case 'hover':
          await browser.hoverElement(client, sessionId, ref);
          break;
        case 'focus':
          await browser.focusElement(client, sessionId, ref);
          break;
        case 'check':
          await browser.checkElement(client, sessionId, ref, true);
          break;
        case 'uncheck':
          await browser.checkElement(client, sessionId, ref, false);
          break;
        case 'text': {
          const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
          if (objectId) {
            const r = await client.send<{ result: { value?: string } }>(
              'Runtime.callFunctionOn',
              {
                functionDeclaration:
                  'function() { return this.innerText || this.textContent || ""; }',
                objectId,
                returnByValue: true,
              },
              sessionId,
            );
            print(r.result?.value ?? '');
          }
          break;
        }
      }
    }

    return { success: true, data: { ref } };
  },
};

export const highlightCommand: Command = {
  name: 'highlight',
  description: 'Highlight an element for 2 seconds. Usage: monomind browse highlight @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse highlight @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.highlightElement(client, sessionId, ref);
    output.printSuccess(`Highlighted: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

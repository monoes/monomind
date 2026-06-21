import { resolve } from 'path';
import type { CdpClient } from './cdp.js';
import type { ElementRef, ClickOptions } from './types.js';
import { getObjectIdForRef, getElementBox } from './snapshot.js';

export async function clickElement(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef,
  options: ClickOptions = {}
): Promise<void> {
  const box = await getElementBox(client, sessionId, ref);

  if (box) {
    await clickPoint(client, sessionId, box.x, box.y, options);
    return;
  }

  // Fallback: use JS click via objectId
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (objectId) {
    await client.send('Runtime.callFunctionOn', {
      functionDeclaration: 'function() { this.click(); }',
      objectId,
      returnByValue: true,
    }, sessionId);
    return;
  }

  throw new Error(`Cannot click ref @${ref.ref}: element not found in DOM`);
}

export async function clickPoint(
  client: CdpClient,
  sessionId: string,
  x: number,
  y: number,
  options: ClickOptions = {}
): Promise<void> {
  const button = options.button ?? 'left';
  // Cap clickCount to prevent unbounded loop DoS
  const clickCount = Math.min(Math.max(1, Math.floor(options.clickCount ?? 1)), 100);
  const modifiers = options.modifiers ?? 0;

  const shared = { x, y, button, modifiers };
  const buttonsMask = button === 'right' ? 2 : button === 'middle' ? 4 : 1;

  for (let i = 0; i < clickCount; i++) {
    const count = i + 1;
    await client.send('Input.dispatchMouseEvent', { ...shared, type: 'mousePressed', buttons: buttonsMask, clickCount: count }, sessionId);
    await client.send('Input.dispatchMouseEvent', { ...shared, type: 'mouseReleased', buttons: i < clickCount - 1 ? buttonsMask : 0, clickCount: count }, sessionId);
  }
}

export async function fillElement(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef,
  value: string
): Promise<void> {
  const box = await getElementBox(client, sessionId, ref);

  if (box) {
    // Click to focus
    await clickPoint(client, sessionId, box.x, box.y);
  }

  // Select all and replace
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (objectId) {
    const fillSelectResult = await client.send<{ result: unknown; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.callFunctionOn', {
      functionDeclaration: `function() {
        this.focus();
        if (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA') {
          this.select();
        } else if (this.isContentEditable) {
          const range = document.createRange();
          range.selectNodeContents(this);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        }
      }`,
      objectId,
      returnByValue: true,
    }, sessionId);
    if (fillSelectResult.exceptionDetails) {
      throw new Error(`fillElement select-all failed: ${fillSelectResult.exceptionDetails.exception?.description ?? fillSelectResult.exceptionDetails.text}`);
    }
  } else if (box) {
    // Fallback for elements without a resolvable objectId: keyboard select-all clears existing content
    const mod = process.platform === 'darwin' ? 4 : 2;
    await pressKeyCombo(client, sessionId, 'a', mod);
  }

  if (!objectId && !box) throw new Error(`Cannot fill ref @${ref.ref}: element not found in DOM`);

  // Type the value character by character for natural input
  await typeText(client, sessionId, value);
}

export async function typeText(client: CdpClient, sessionId: string, text: string): Promise<void> {
  // Cap to 100 KB to prevent OOM in CDP message serializer
  const safeText = text.length > 102_400 ? text.slice(0, 102_400) : text;
  await client.send('Input.insertText', { text: safeText }, sessionId);
}

export async function pressKeyCombo(
  client: CdpClient,
  sessionId: string,
  key: string,
  modifiers: number
): Promise<void> {
  const { text: _text, ...keyInfo } = resolveKey(key);
  // rawKeyDown prevents Chrome from inserting the character text; only the shortcut fires
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyInfo, modifiers }, sessionId);
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyInfo, modifiers }, sessionId);
}

export async function pressKey(
  client: CdpClient,
  sessionId: string,
  key: string
): Promise<void> {
  const { text, ...keyInfo } = resolveKey(key);

  // rawKeyDown does not insert text; the explicit char event handles insertion
  await client.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...keyInfo,
  }, sessionId);

  if (text) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'char',
      text,
    }, sessionId);
  }

  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...keyInfo,
  }, sessionId);
}

function resolveKey(key: string): { key: string; code: string; text?: string; windowsVirtualKeyCode?: number } {
  const keyMap: Record<string, { key: string; code: string; text?: string; windowsVirtualKeyCode?: number }> = {
    Enter: { key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
    End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
    Space: { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 },
    ' ': { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 },
    Shift: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 },
    Control: { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 },
    Alt: { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
    Meta: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
    F1: { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 },
    F2: { key: 'F2', code: 'F2', windowsVirtualKeyCode: 113 },
    F3: { key: 'F3', code: 'F3', windowsVirtualKeyCode: 114 },
    F4: { key: 'F4', code: 'F4', windowsVirtualKeyCode: 115 },
    F5: { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 },
    F6: { key: 'F6', code: 'F6', windowsVirtualKeyCode: 117 },
    F7: { key: 'F7', code: 'F7', windowsVirtualKeyCode: 118 },
    F8: { key: 'F8', code: 'F8', windowsVirtualKeyCode: 119 },
    F9: { key: 'F9', code: 'F9', windowsVirtualKeyCode: 120 },
    F10: { key: 'F10', code: 'F10', windowsVirtualKeyCode: 121 },
    F11: { key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 },
    F12: { key: 'F12', code: 'F12', windowsVirtualKeyCode: 123 },
  };

  if (keyMap[key]) return keyMap[key];

  // Single printable character — windowsVirtualKeyCode required for rawKeyDown shortcut dispatch
  if (key.length === 1) {
    const charCode = key.charCodeAt(0);
    if (charCode >= 48 && charCode <= 57) {
      return { key, code: `Digit${key}`, text: key, windowsVirtualKeyCode: charCode };
    }
    if ((charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122)) {
      return { key, code: `Key${key.toUpperCase()}`, text: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
    }
    // Symbol keys: map to the physical key's code and Windows virtual key code
    const symbolMap: Record<string, { code: string; windowsVirtualKeyCode: number }> = {
      '!': { code: 'Digit1', windowsVirtualKeyCode: 49 },
      '@': { code: 'Digit2', windowsVirtualKeyCode: 50 },
      '#': { code: 'Digit3', windowsVirtualKeyCode: 51 },
      '$': { code: 'Digit4', windowsVirtualKeyCode: 52 },
      '%': { code: 'Digit5', windowsVirtualKeyCode: 53 },
      '^': { code: 'Digit6', windowsVirtualKeyCode: 54 },
      '&': { code: 'Digit7', windowsVirtualKeyCode: 55 },
      '*': { code: 'Digit8', windowsVirtualKeyCode: 56 },
      '(': { code: 'Digit9', windowsVirtualKeyCode: 57 },
      ')': { code: 'Digit0', windowsVirtualKeyCode: 48 },
      '-': { code: 'Minus', windowsVirtualKeyCode: 189 },
      '_': { code: 'Minus', windowsVirtualKeyCode: 189 },
      '=': { code: 'Equal', windowsVirtualKeyCode: 187 },
      '+': { code: 'Equal', windowsVirtualKeyCode: 187 },
      '[': { code: 'BracketLeft', windowsVirtualKeyCode: 219 },
      '{': { code: 'BracketLeft', windowsVirtualKeyCode: 219 },
      ']': { code: 'BracketRight', windowsVirtualKeyCode: 221 },
      '}': { code: 'BracketRight', windowsVirtualKeyCode: 221 },
      '\\': { code: 'Backslash', windowsVirtualKeyCode: 220 },
      '|': { code: 'Backslash', windowsVirtualKeyCode: 220 },
      ';': { code: 'Semicolon', windowsVirtualKeyCode: 186 },
      ':': { code: 'Semicolon', windowsVirtualKeyCode: 186 },
      "'": { code: 'Quote', windowsVirtualKeyCode: 222 },
      '"': { code: 'Quote', windowsVirtualKeyCode: 222 },
      '`': { code: 'Backquote', windowsVirtualKeyCode: 192 },
      '~': { code: 'Backquote', windowsVirtualKeyCode: 192 },
      ',': { code: 'Comma', windowsVirtualKeyCode: 188 },
      '<': { code: 'Comma', windowsVirtualKeyCode: 188 },
      '.': { code: 'Period', windowsVirtualKeyCode: 190 },
      '>': { code: 'Period', windowsVirtualKeyCode: 190 },
      '/': { code: 'Slash', windowsVirtualKeyCode: 191 },
      '?': { code: 'Slash', windowsVirtualKeyCode: 191 },
    };
    const sym = symbolMap[key];
    if (sym) return { key, code: sym.code, text: key, windowsVirtualKeyCode: sym.windowsVirtualKeyCode };
    // Unknown/non-ASCII character — omit code since no valid DOM KeyboardEvent.code exists
    return { key, code: '', text: key };
  }

  return { key, code: key };
}

export async function scrollElement(
  client: CdpClient,
  sessionId: string,
  direction: 'up' | 'down' | 'left' | 'right',
  amount = 300,
  ref?: ElementRef
): Promise<void> {
  // Cap scroll amount to prevent extreme delta values
  amount = Math.min(Math.max(1, Math.floor(amount)), 100_000);
  let x = 0;
  let y = 0;
  let deltaX = 0;
  let deltaY = 0;

  if (ref) {
    const box = await getElementBox(client, sessionId, ref);
    if (!box) throw new Error(`Cannot scroll: ref @${ref.ref} not found in DOM`);
    x = box.x; y = box.y;
  } else {
    // Center of viewport
    const vp = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: 'JSON.stringify({w: window.innerWidth, h: window.innerHeight})',
      returnByValue: true,
    }, sessionId);
    const dims = JSON.parse(vp.result?.value ?? '{"w":1280,"h":720}');
    x = dims.w / 2;
    y = dims.h / 2;
  }

  switch (direction) {
    case 'down': deltaY = amount; break;
    case 'up': deltaY = -amount; break;
    case 'right': deltaX = amount; break;
    case 'left': deltaX = -amount; break;
  }

  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
  }, sessionId);
}

export async function hoverElement(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef
): Promise<void> {
  const box = await getElementBox(client, sessionId, ref);
  if (!box) throw new Error(`Cannot hover ref @${ref.ref}: element not found in DOM`);

  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: box.x,
    y: box.y,
  }, sessionId);
}

export async function selectOption(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef,
  value: string
): Promise<void> {
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (!objectId) throw new Error(`Cannot select: ref @${ref.ref} not found in DOM`);

  const selectResult = await client.send<{ result: unknown; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.callFunctionOn', {
    functionDeclaration: `function(value) {
      if (this.tagName !== 'SELECT') throw new Error('Not a select element');
      for (const opt of this.options) {
        if (opt.value === value || opt.textContent.trim() === value) {
          this.value = opt.value;
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      throw new Error('Option not found: ' + value);
    }`,
    objectId,
    arguments: [{ value }],
    returnByValue: true,
  }, sessionId);
  if (selectResult.exceptionDetails) {
    throw new Error(`selectOption failed: ${selectResult.exceptionDetails.exception?.description ?? selectResult.exceptionDetails.text}`);
  }
}

export async function checkElement(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef,
  checked = true
): Promise<void> {
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (!objectId) throw new Error(`Cannot check: ref @${ref.ref} not found in DOM`);

  const checkResult = await client.send<{ result: unknown; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.callFunctionOn', {
    functionDeclaration: `function(checked) {
      if (this.checked !== checked) {
        this.click();
      }
    }`,
    objectId,
    arguments: [{ value: checked }],
    returnByValue: true,
  }, sessionId);
  if (checkResult.exceptionDetails) {
    throw new Error(`checkElement failed: ${checkResult.exceptionDetails.exception?.description ?? checkResult.exceptionDetails.text}`);
  }
}

export async function focusElement(client: CdpClient, sessionId: string, ref: ElementRef): Promise<void> {
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (objectId) {
    await client.send('Runtime.callFunctionOn', {
      functionDeclaration: 'function() { this.focus(); }',
      objectId,
      returnByValue: true,
    }, sessionId);
    return;
  }
  const box = await getElementBox(client, sessionId, ref);
  if (box) {
    await clickPoint(client, sessionId, box.x, box.y);
  } else {
    throw new Error(`Cannot focus ref @${ref.ref}: element not found in DOM`);
  }
}

export async function typeIntoElement(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef,
  text: string
): Promise<void> {
  await focusElement(client, sessionId, ref);
  await typeText(client, sessionId, text);
}

export async function keyDown(client: CdpClient, sessionId: string, key: string): Promise<void> {
  const { text: _text, ...keyInfo } = resolveKey(key);
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyInfo }, sessionId);
}

export async function keyUp(client: CdpClient, sessionId: string, key: string): Promise<void> {
  const { text: _text, ...keyInfo } = resolveKey(key);
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyInfo }, sessionId);
}

export async function mouseMove(client: CdpClient, sessionId: string, x: number, y: number): Promise<void> {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
}

export async function mouseDown(
  client: CdpClient,
  sessionId: string,
  x: number,
  y: number,
  button: 'left' | 'right' | 'middle' = 'left'
): Promise<void> {
  const buttonsMask = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: buttonsMask, clickCount: 1 }, sessionId);
}

export async function mouseUp(
  client: CdpClient,
  sessionId: string,
  x: number,
  y: number,
  button: 'left' | 'right' | 'middle' = 'left'
): Promise<void> {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 }, sessionId);
}

export async function mouseWheel(
  client: CdpClient,
  sessionId: string,
  x: number,
  y: number,
  deltaY: number,
  deltaX = 0
): Promise<void> {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY }, sessionId);
}

export async function dragAndDrop(
  client: CdpClient,
  sessionId: string,
  src: ElementRef,
  tgt: ElementRef
): Promise<void> {
  const srcBox = await getElementBox(client, sessionId, src);
  const tgtBox = await getElementBox(client, sessionId, tgt);
  if (!srcBox || !tgtBox) throw new Error('Cannot drag: one or both elements not found in DOM');

  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: srcBox.x, y: srcBox.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: srcBox.x, y: srcBox.y, button: 'left', buttons: 1 }, sessionId);

  // Move in steps for smooth drag
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = srcBox.x + (tgtBox.x - srcBox.x) * (i / steps);
    const y = srcBox.y + (tgtBox.y - srcBox.y) * (i / steps);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }, sessionId);
  }

  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tgtBox.x, y: tgtBox.y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
}

export async function uploadFile(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef,
  filePaths: string[]
): Promise<void> {
  if (!ref.backendDOMNodeId) throw new Error(`Cannot upload: ref @${ref.ref} has no DOM node`);

  await client.send('DOM.setFileInputFiles', {
    files: filePaths.map((f) => resolve(f)),
    backendNodeId: ref.backendDOMNodeId,
  }, sessionId);
}

export async function readClipboard(client: CdpClient, sessionId: string): Promise<string> {
  const result = await evaluateJs(client, sessionId, 'navigator.clipboard.readText()');
  return result as string;
}

export async function writeClipboard(client: CdpClient, sessionId: string, text: string): Promise<void> {
  // Cap to 100 KB to prevent OOM when serializing the CDP expression
  const safeText = text.length > 102_400 ? text.slice(0, 102_400) : text;
  await evaluateJs(client, sessionId, `navigator.clipboard.writeText(${JSON.stringify(safeText)})`);
}

export async function pushState(client: CdpClient, sessionId: string, url: string): Promise<void> {
  // Try Next.js router first, then fallback to history.pushState
  await evaluateJs(client, sessionId, `
    (function() {
      const url = ${JSON.stringify(url)};
      if (window.next && window.next.router) {
        window.next.router.push(url).catch(function() {});
        return;
      } else {
        history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    })()
  `);
}

export async function addInitScript(client: CdpClient, sessionId: string, script: string): Promise<string> {
  const result = await client.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
    source: script,
  }, sessionId);
  return result.identifier;
}

export async function removeInitScript(client: CdpClient, sessionId: string, identifier: string): Promise<void> {
  await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId);
}

export async function evaluateJs(
  client: CdpClient,
  sessionId: string,
  expression: string
): Promise<unknown> {
  const result = await client.send<{
    result: { value?: unknown; type: string; description?: string };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);

  if (result.exceptionDetails) {
    throw new Error(`JS evaluation error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  }

  return result.result?.value;
}

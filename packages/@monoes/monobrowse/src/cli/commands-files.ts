/**
 * Files in and out of the page — screenshots, PDFs, uploads and downloads.
 */

import { output } from './output.js';
import {
  ensureConnected,
  getBrowser,
  imageFormat,
  print,
  resolveElementObjectId,
  session,
} from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const screenshotCommand: Command = {
  name: 'screenshot',
  description:
    'Capture a screenshot. Usage: monomind browse screenshot [path] [--annotate] [--hide-scrollbars]',
  options: [
    { name: 'full', type: 'boolean', description: 'Full page screenshot', default: false },
    { name: 'format', type: 'string', description: 'Format: png|jpeg|webp', default: 'png' },
    { name: 'quality', type: 'number', description: 'Quality 0-100 for jpeg/webp', default: 80 },
    {
      name: 'annotate',
      type: 'boolean',
      description:
        'Overlay numbered labels keyed to @eN refs from last snapshot (viewport-only; do not combine with --full)',
      default: false,
    },
    {
      name: 'hide-scrollbars',
      type: 'boolean',
      description: 'Hide native scrollbars via CSS injection before capture',
      default: false,
    },
    { name: 'json', type: 'boolean', description: 'Output JSON with path', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const hideScrollbars = ctx.flags['hide-scrollbars'] as boolean;
    if (hideScrollbars) {
      await client
        .send(
          'Runtime.evaluate',
          {
            expression: `(function(){var s=document.getElementById('__mm_noscroll__');if(s)return;var el=document.createElement('style');el.id='__mm_noscroll__';el.textContent='*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important;-ms-overflow-style:none!important}';document.head.appendChild(el);})()`,
            returnByValue: false,
          },
          sessionId,
        )
        .catch(() => {});
    }

    const annotate = ctx.flags.annotate as boolean;
    // eslint-disable-next-line prefer-const
    let result!: { path: string; dataUrl: string };
    try {
      result = await browser.captureScreenshot(client, sessionId, {
        path: ctx.args[0] as string,
        fullPage: ctx.flags.full as boolean,
        format: imageFormat(ctx.flags.format, ['png', 'jpeg', 'webp'] as const, 'png'),
        quality: ctx.flags.quality as number,
        annotate,
        refs: annotate ? session.refs : undefined,
      });
    } finally {
      if (hideScrollbars) {
        await client
          .send(
            'Runtime.evaluate',
            {
              expression: `(function(){var s=document.getElementById('__mm_noscroll__');if(s)s.remove();})()`,
              returnByValue: false,
            },
            sessionId,
          )
          .catch(() => {});
      }
    }

    if (ctx.flags.json) {
      print(JSON.stringify({ data: { path: result.path } }));
    } else {
      output.printSuccess(`Screenshot saved: ${result.path}`);
    }

    return { success: true, data: result };
  },
};

export const uploadCommand: Command = {
  name: 'upload',
  description: 'Upload files to a file input. Usage: monomind browse upload @e1 ./file.pdf',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    const files = ctx.args.slice(1) as string[];
    if (!refArg || files.length === 0)
      throw new Error('Usage: monomind browse upload @e1 <file1> [file2...]');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, session.refs, refKey);
    await browser.uploadFile(client, sessionId, ref, files);
    output.printSuccess(`Uploaded ${files.length} file(s) to @${refKey}`);
    return { success: true };
  },
};

export const downloadCommand: Command = {
  name: 'download',
  description:
    'Click an element and capture the triggered file download. Usage: monomind browse download @e1 ./output.pdf',
  options: [
    {
      name: 'timeout',
      short: 't',
      type: 'number',
      description: 'Max wait for download in ms',
      default: 30000,
    },
    { name: 'json', type: 'boolean', description: 'Output result as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const _browser = await getBrowser();
    const refOrSel = ctx.args[0] as string;
    const savePath = ctx.args[1] as string;
    if (!refOrSel || !savePath)
      throw new Error('Usage: monomind browse download @e1|selector <save-path>');

    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const downloadDir = join(tmpdir(), `mm-download-${Date.now()}`);
    await mkdir(downloadDir, { recursive: true });

    // Enable Page.downloadWillBegin / Page.downloadProgress events
    await client
      .send(
        'Browser.setDownloadBehavior',
        {
          behavior: 'allow',
          downloadPath: downloadDir,
          eventsEnabled: true,
        },
        undefined,
      )
      .catch(() => {
        // Fallback: older Chrome API (session-scoped)
        return client
          .send(
            'Page.setDownloadBehavior',
            {
              behavior: 'allow',
              downloadPath: downloadDir,
            },
            sessionId,
          )
          .catch(() => {});
      });

    // Track when download completes
    const downloadPromise = new Promise<string>((resolve, reject) => {
      let guid = '';
      // C2: capture off() functions to avoid listener leaks in batch mode
      const offBegin = client.on('Browser.downloadWillBegin', (params: Record<string, unknown>) => {
        guid = params.guid as string;
      });
      let offProgress: (() => void) | undefined;
      // cleanup defined before setTimeout so the timeout callback can call it
      let timeout: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timeout);
        offBegin?.();
        offProgress?.();
      };
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Download timed out'));
      }, ctx.flags.timeout as number);
      offProgress = client.on(
        'Browser.downloadProgress',
        async (params: Record<string, unknown>) => {
          if (params.guid === guid && params.state === 'completed') {
            cleanup();
            // Find the downloaded file in downloadDir
            const { readdir, rename, rmdir } = await import('node:fs/promises');
            const files = await readdir(downloadDir);
            if (files.length > 0) {
              const src = join(downloadDir, files[0]);
              await mkdir(dirname(savePath), { recursive: true });
              await rename(src, savePath);
              await rmdir(downloadDir).catch(() => {}); // I1: cleanup temp dir
              resolve(savePath);
            } else {
              await rmdir(downloadDir).catch(() => {}); // I1: cleanup temp dir
              reject(new Error('Download completed but no file found'));
            }
          } else if (params.guid === guid && params.state === 'canceled') {
            cleanup();
            reject(new Error('Download was canceled'));
          }
        },
      );
    });

    // Click the element to trigger download
    const objectId = await resolveElementObjectId(client, sessionId, session.refs, refOrSel);
    await client.send<{ result: unknown }>(
      'Runtime.callFunctionOn',
      {
        functionDeclaration: 'function(){ this.click(); }',
        objectId,
        returnByValue: true,
      },
      sessionId,
    );

    const finalPath = await downloadPromise;
    if (ctx.flags.json) print(JSON.stringify({ data: { path: finalPath } }));
    else output.printSuccess(`Downloaded: ${finalPath}`);
    return { success: true, data: { path: finalPath } };
  },
};

export const pdfCommand: Command = {
  name: 'pdf',
  description: 'Save page as PDF. Usage: monomind browse pdf [path]',
  options: [
    { name: 'landscape', type: 'boolean', description: 'Landscape orientation', default: false },
    { name: 'background', type: 'boolean', description: 'Print background', default: true },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const path = await browser.capturePdf(client, sessionId, {
      path: ctx.args[0] as string,
      landscape: ctx.flags.landscape as boolean,
      printBackground: ctx.flags.background as boolean,
    });
    output.printSuccess(`PDF saved: ${path}`);
    return { success: true, data: { path } };
  },
};

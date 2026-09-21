/**
 * Recording what the page does — network interception and capture, HAR export,
 * video recording, DevTools traces, CPU profiles and Web Vitals.
 */

import type { NetworkRoute } from '../index.js';
import { output } from './output.js';
import { ensureConnected, getBrowser, imageFormat, print, session } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const networkCommand: Command = {
  name: 'network',
  description: 'Network interception and cookie management',
  options: [
    { name: 'pattern', type: 'string', description: 'URL pattern for route (glob)' },
    { name: 'abort', type: 'boolean', description: 'Abort matching requests' },
    { name: 'fulfill', type: 'string', description: 'JSON response body' },
    { name: 'status', type: 'number', description: 'HTTP status for fulfill', default: 200 },
    { name: 'headers', type: 'string', description: 'JSON headers object' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    {
      name: 'filter',
      type: 'string',
      description: 'Filter requests by URL substring (for network requests)',
    },
    {
      name: 'method',
      type: 'string',
      description: 'Filter by HTTP method, e.g. GET, POST (for network requests)',
    },
    {
      name: 'status-code',
      type: 'number',
      description: 'Filter by HTTP status code (for network requests)',
    },
    {
      name: 'type',
      type: 'string',
      description:
        'Filter by resource type: xhr|fetch|document|script|stylesheet|image (for network requests)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action)
      throw new Error('Usage: monomind browse network route|unroute|cookies|headers|requests');

    switch (action) {
      case 'route': {
        const pattern = ctx.flags.pattern as string;
        if (!pattern) throw new Error('--pattern required for network route');
        const routes: NetworkRoute[] = [
          {
            pattern,
            action: ctx.flags.abort ? 'abort' : ctx.flags.fulfill ? 'fulfill' : 'continue',
            response: ctx.flags.fulfill
              ? {
                  status: ctx.flags.status as number,
                  body: ctx.flags.fulfill as string,
                  headers: ctx.flags.headers ? JSON.parse(ctx.flags.headers as string) : {},
                }
              : undefined,
          },
        ];
        await browser.setupRoutes(client, sessionId, routes);
        output.printSuccess(`Network route set: ${pattern}`);
        break;
      }
      case 'unroute':
        await browser.disableInterception(client, sessionId);
        output.printSuccess('Network interception disabled');
        break;
      case 'cookies': {
        const cookies = await browser.getCookies(client, sessionId);
        print(JSON.stringify(cookies, null, 2));
        return { success: true, data: { cookies } };
      }
      case 'headers': {
        const headers = ctx.flags.headers as string;
        if (!headers) throw new Error('--headers required (JSON string)');
        await browser.setExtraHeaders(client, sessionId, JSON.parse(headers));
        output.printSuccess('Extra headers set');
        break;
      }
      case 'capture': {
        const subAction = (ctx.args[1] as string) ?? 'start';
        if (subAction === 'start') {
          browser.startRequestCapture(client, sessionId);
          output.printSuccess('Request capture started');
        } else if (subAction === 'stop') {
          browser.stopRequestCapture(sessionId);
          output.printSuccess('Request capture stopped');
        } else if (subAction === 'clear') {
          browser.clearCapturedRequests(sessionId);
          output.printSuccess('Captured requests cleared');
        }
        break;
      }
      case 'requests': {
        let reqs = browser.getCapturedRequests(sessionId);
        const filterUrl = ctx.flags.filter as string | undefined;
        const filterMethod = ctx.flags.method as string | undefined;
        const filterStatus = ctx.flags['status-code'] as number | undefined;
        const filterType = ctx.flags.type as string | undefined;
        if (filterUrl) reqs = reqs.filter((r) => r.url.includes(filterUrl));
        if (filterMethod)
          reqs = reqs.filter(
            (r) => (r.method ?? 'GET').toUpperCase() === filterMethod.toUpperCase(),
          );
        if (filterStatus) reqs = reqs.filter((r) => r.status === filterStatus);
        if (filterType)
          reqs = reqs.filter(
            (r) =>
              (r as Record<string, unknown>).resourceType === filterType ||
              (r as Record<string, unknown>).type === filterType,
          );
        if (ctx.flags.json) print(JSON.stringify({ data: reqs }));
        else {
          if (reqs.length === 0) {
            output.printInfo('No captured requests. Run: network capture start');
          } else for (const r of reqs) print(`  ${r.method ?? 'GET'} ${r.status ?? '-'} ${r.url}`);
        }
        return { success: true, data: { requests: reqs } };
      }
      case 'request': {
        const reqId = ctx.args[1] as string;
        if (!reqId) throw new Error('Usage: monomind browse network request <requestId>');
        const reqs = browser.getCapturedRequests(sessionId);
        const req = reqs.find(
          (r) =>
            (r as Record<string, unknown>).requestId === reqId ||
            (r as Record<string, unknown>).id === reqId,
        );
        if (!req) {
          output.printWarning(`Request not found: ${reqId}`);
          return { success: false };
        }
        if (ctx.flags.json) print(JSON.stringify({ data: req }));
        else print(JSON.stringify(req, null, 2));
        return { success: true, data: { request: req } };
      }
      default:
        throw new Error(
          `Unknown: ${action}. Use: route|unroute|cookies|headers|capture|requests|request`,
        );
    }

    return { success: true };
  },
};

// Default output cap for eval when --max-output isn't passed explicitly —
// print(String(result)) had NO limit at all (unlike snapshot's --max-output),
// so e.g. `eval "document.documentElement.outerHTML"` could dump megabytes
// straight into an agent's context. An explicit --max-output still overrides
// this default.

export const recordCommand: Command = {
  name: 'record',
  description: 'Screen recording. Usage: monomind browse record start|stop|restart|status [path]',
  options: [
    { name: 'format', type: 'string', description: 'jpeg|png', default: 'jpeg' },
    { name: 'quality', type: 'number', description: 'Quality 0-100', default: 80 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse record start|stop|restart|status');

    switch (action) {
      case 'start':
        await browser.startRecording(client, sessionId, {
          format: imageFormat(ctx.flags.format, ['jpeg', 'png'] as const, 'jpeg'),
          quality: ctx.flags.quality as number,
        });
        output.printSuccess('Recording started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopRecording(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Recording saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'restart': {
        const prevStatus = browser.getRecordingStatus(sessionId);
        let prevPath: string | undefined;
        if (prevStatus.recording || prevStatus.autoStopped) {
          prevPath = await browser.stopRecording(client, sessionId, ctx.args[1] as string);
          output.printInfo(`Previous recording saved: ${prevPath}`);
        }
        await browser.startRecording(client, sessionId, {
          format: imageFormat(ctx.flags.format, ['jpeg', 'png'] as const, 'jpeg'),
          quality: ctx.flags.quality as number,
        });
        output.printSuccess('Recording restarted');
        return { success: true, data: { previous: prevPath } };
      }
      case 'status': {
        const status = browser.getRecordingStatus(sessionId);
        if (ctx.flags.json) print(JSON.stringify({ data: status }));
        else
          print(
            `Recording: ${status.recording} | Frames: ${status.frames}${status.autoStopped ? ' (auto-stopped: buffer limit reached — run "record stop" to save)' : ''}`,
          );
        return { success: true, data: status };
      }
      default:
        throw new Error('Usage: monomind browse record start|stop|restart|status [path]');
    }
  },
};

export const traceCommand: Command = {
  name: 'trace',
  description: 'CDP performance trace. Usage: monomind browse trace start|stop [path]',
  options: [
    { name: 'screenshots', type: 'boolean', description: 'Include screenshots', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse trace start|stop [path]');

    switch (action) {
      case 'start':
        await browser.startTrace(client, sessionId, {
          screenshots: ctx.flags.screenshots as boolean,
        });
        output.printSuccess('Trace started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopTrace(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Trace saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'status':
        print(browser.getTraceStatus(sessionId) ? 'Tracing active' : 'Not tracing');
        return { success: true };
      default:
        throw new Error('Usage: monomind browse trace start|stop|status [path]');
    }
  },
};

export const profilerCommand: Command = {
  name: 'profiler',
  description: 'CPU profiler. Usage: monomind browse profiler start|stop|heap [path]',
  options: [
    { name: 'interval', type: 'number', description: 'Sampling interval µs', default: 1000 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse profiler start|stop|heap [path]');

    switch (action) {
      case 'start':
        await browser.startCpuProfile(client, sessionId, {
          samplingInterval: ctx.flags.interval as number,
        });
        output.printSuccess('CPU profiler started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopCpuProfile(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Profile saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'heap': {
        const path = await browser.startHeapSnapshot(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Heap snapshot saved: ${path}`);
        return { success: true, data: { path } };
      }
      default:
        throw new Error('Usage: monomind browse profiler start|stop|heap [path]');
    }
  },
};

export const vitalsCommand: Command = {
  name: 'vitals',
  description: 'Collect Core Web Vitals. Usage: monomind browse vitals [--wait 2000]',
  options: [
    { name: 'wait', type: 'number', description: 'Wait ms for observers', default: 2000 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const vitals = await browser.collectVitals(client, sessionId, ctx.flags.wait as number);
    if (ctx.flags.json) {
      print(JSON.stringify({ data: vitals }));
    } else {
      print(browser.formatVitals(vitals));
    }
    return { success: true, data: vitals };
  },
};

export const harCommand: Command = {
  name: 'har',
  description: 'HAR network recording. Usage: monomind browse har start|stop|status [path]',
  options: [
    { name: 'bodies', type: 'boolean', description: 'Capture response bodies', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse har start|stop|status [path]');

    switch (action) {
      case 'start':
        await browser.startHarRecording(client, sessionId);
        output.printSuccess('HAR recording started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopHarRecording(
          client,
          sessionId,
          ctx.args[1] as string,
          ctx.flags.bodies as boolean,
        );
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`HAR saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'status': {
        const status = browser.getHarStatus(sessionId);
        if (ctx.flags.json) print(JSON.stringify({ data: status }));
        else print(`Recording: ${status.recording} | Requests: ${status.requestCount}`);
        return { success: true, data: status };
      }
      default:
        throw new Error('Usage: monomind browse har start|stop|status [path]');
    }
  },
};

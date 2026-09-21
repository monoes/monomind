/**
 * RIG-01…04, RIG-09: the instrument half of the `browser_*` MCP surface.
 *
 * monobrowse has had console capture, network/HAR capture, web vitals, CPU
 * profiling, heap snapshots and device emulation for a while — none of it was
 * reachable from an MCP client, so an agent driving a web app could not see a
 * console error. These tests drive the tools that expose it.
 *
 * `@monoes/monobrowse` is mocked wholesale: the point under test is the tool
 * contract an agent sees (filtering, ordering, capping, error handling), not
 * CDP itself, and no Chrome is available in CI.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mb = vi.hoisted(() => ({
  consoleMessages: [] as Array<Record<string, unknown>>,
  pageErrors: [] as Array<Record<string, unknown>>,
  captured: [] as Array<Record<string, unknown>>,
  harRequests: [] as Array<Record<string, unknown>>,
  harRecording: false,
  vitals: {} as Record<string, number>,
  cpuProfile: null as unknown,
  connectFails: false,
  calls: [] as string[],
  clearedConsole: 0,
  clearedErrors: 0,
  emulated: [] as string[],
  screenshots: [] as string[],
  cdpSent: [] as string[],
}));

vi.mock('@monoes/monobrowse', () => {
  const listeners = new Map<string, Set<(p: any, sid?: string) => void>>();
  const client = {
    send: async (method: string) => {
      mb.cdpSent.push(method);
      return {};
    },
    on: (event: string, fn: (p: any, sid?: string) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => listeners.get(event)!.delete(fn);
    },
    close: () => {},
  };
  return {
    connectToTarget: async () => {
      if (mb.connectFails) throw new Error('Failed to connect to Chrome on port 9222');
      return { client, sessionId: 'CDP-1', target: { id: 't1' } };
    },
    enableConsoleCapture: async () => {
      mb.calls.push('enableConsoleCapture');
    },
    getConsoleMessages: () => [...mb.consoleMessages],
    getPageErrors: () => [...mb.pageErrors],
    clearConsoleMessages: () => {
      mb.clearedConsole++;
      mb.consoleMessages = [];
    },
    clearPageErrors: () => {
      mb.clearedErrors++;
      mb.pageErrors = [];
    },
    startRequestCapture: () => {
      mb.calls.push('startRequestCapture');
    },
    stopRequestCapture: () => {
      mb.calls.push('stopRequestCapture');
    },
    getCapturedRequests: () => [...mb.captured],
    clearCapturedRequests: () => {
      mb.captured = [];
    },
    startHarRecording: async () => {
      if (mb.harRecording) throw new Error('HAR recording already in progress');
      mb.harRecording = true;
    },
    stopHarRecording: async (_c: unknown, _s: string, outputPath?: string) => {
      mb.harRecording = false;
      const p = outputPath ?? '/tmp/fallback.har';
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ log: { entries: mb.harRequests } }));
      return p;
    },
    getHarStatus: () => ({ recording: mb.harRecording, requestCount: mb.harRequests.length }),
    getRequests: () => [...mb.harRequests],
    collectVitals: async () => ({ ...mb.vitals }),
    formatVitals: (v: Record<string, number>) => `  LCP: ${v.lcp}ms`,
    startCpuProfile: async () => {
      mb.calls.push('startCpuProfile');
    },
    stopCpuProfile: async (_c: unknown, _s: string, outputPath?: string) => {
      const p = outputPath!;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(mb.cpuProfile));
      return p;
    },
    startHeapSnapshot: async (_c: unknown, _s: string, outputPath?: string) => {
      const p = outputPath!;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, '{"snapshot":{"from":"monobrowse"}}');
      return p;
    },
    isProfilingActive: () => false,
    emulateDevice: async (_c: unknown, _s: string, name: string) => {
      if (name === 'Nokia 3310') throw new Error(`Unknown device: "${name}". Available: iPhone 14`);
      mb.emulated.push(name);
    },
    listDevices: () => ['iPhone 14', 'iPhone SE', 'iPad', 'Galaxy S21', 'Pixel 5'],
    captureScreenshot: async (_c: unknown, _s: string, opts: { path?: string }) => {
      mb.screenshots.push(opts.path!);
      return { path: opts.path, dataUrl: undefined };
    },
    getCurrentUrl: async () => 'https://example.test/app',
    getCurrentTitle: async () => 'Example',
    waitForLoad: async () => {},
  };
});

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

async function run(name: string, args: Record<string, unknown> = {}) {
  const { browserTools } = await import('../mcp-tools/browser-tools.js');
  const tool = browserTools.find((t) => t.name === name);
  expect(tool, `tool ${name} is not registered`).toBeDefined();
  const result = (await tool!.handler(args, undefined)) as ToolResult;
  return {
    isError: result.isError === true,
    body: JSON.parse(result.content[0].text ?? '{}') as Record<string, any>,
  };
}

/** Artifacts land under <cwd>/.monomind/<subdir>; clean up what a test made. */
const artifactRoots = ['.monomind/network', '.monomind/profiles', '.monomind/screenshots'];

beforeEach(async () => {
  const { connectionCache, browserSessions } = await import('../mcp-tools/browser-session.js');
  connectionCache.clear();
  browserSessions.clear();
  mb.consoleMessages = [];
  mb.pageErrors = [];
  mb.captured = [];
  mb.harRequests = [];
  mb.harRecording = false;
  mb.vitals = {};
  mb.cpuProfile = null;
  mb.connectFails = false;
  mb.calls = [];
  mb.clearedConsole = 0;
  mb.clearedErrors = 0;
  mb.emulated = [];
  mb.screenshots = [];
  mb.cdpSent = [];
});

afterEach(() => {
  for (const root of artifactRoots) rmSync(root, { recursive: true, force: true });
});

describe('browser_console (RIG-01)', () => {
  beforeEach(() => {
    mb.consoleMessages = [
      { type: 'log', text: 'boot', timestamp: 1 },
      { type: 'warn', text: 'deprecated api', timestamp: 2 },
      { type: 'error', text: 'TypeError: x is not a function', timestamp: 3 },
      { type: 'info', text: 'ready', timestamp: 4 },
    ];
    mb.pageErrors = [
      {
        text: 'Uncaught ReferenceError: foo is not defined',
        url: 'app.js',
        lineNumber: 12,
        timestamp: 2,
      },
    ];
  });

  it('returns counts, page errors and messages with errors first', async () => {
    const { body } = await run('browser_console');
    expect(body.success).toBe(true);
    expect(body.counts).toMatchObject({ error: 1, warning: 1, pageErrors: 1, total: 5 });
    expect(body.pageErrors[0].text).toContain('ReferenceError');
    // Worst offenders first: the error outranks the earlier log/warn entries.
    expect(body.messages[0].text).toContain('TypeError');
  });

  it('reports the capture window so an agent knows what it is not seeing', async () => {
    const { body } = await run('browser_console');
    expect(typeof body.capturedSince).toBe('string');
    expect(Number.isNaN(Date.parse(body.capturedSince))).toBe(false);
  });

  it('filters to errors only', async () => {
    const { body } = await run('browser_console', { level: 'error' });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].type).toBe('error');
    expect(body.pageErrors).toHaveLength(1);
  });

  it('level "warning" means warnings and worse', async () => {
    const { body } = await run('browser_console', { level: 'warning' });
    expect(body.messages.map((m: any) => m.type).sort()).toEqual(['error', 'warn']);
  });

  it('caps output at limit and says how much it dropped', async () => {
    const { body } = await run('browser_console', { limit: 2 });
    expect(body.messages).toHaveLength(2);
    expect(body.truncated).toBe(2);
  });

  it('clears both buffers when asked, after reporting them', async () => {
    const { body } = await run('browser_console', { clear: true });
    expect(body.counts.total).toBe(5);
    expect(body.cleared).toBe(true);
    expect(mb.clearedConsole).toBe(1);
    expect(mb.clearedErrors).toBe(1);
  });

  it('fails gracefully with no browser session', async () => {
    mb.connectFails = true;
    const { isError, body } = await run('browser_console');
    expect(isError).toBe(true);
    expect(body.success).toBe(false);
    expect(body.error).toContain('connect');
  });
});

describe('browser_network (RIG-02)', () => {
  beforeEach(() => {
    mb.captured = [
      {
        id: '1',
        url: 'https://example.test/',
        method: 'GET',
        status: 200,
        mimeType: 'text/html',
        startTime: 0,
        endTime: 120,
        encodedSize: 4000,
      },
      {
        id: '2',
        url: 'https://example.test/app.js',
        method: 'GET',
        status: 200,
        mimeType: 'application/javascript',
        startTime: 10,
        endTime: 900,
        encodedSize: 250000,
      },
      {
        id: '3',
        url: 'https://api.example.test/v1/user',
        method: 'POST',
        status: 500,
        mimeType: 'application/json',
        startTime: 20,
        endTime: 300,
        encodedSize: 120,
      },
      {
        id: '4',
        url: 'https://cdn.example.test/logo.png',
        method: 'GET',
        mimeType: 'image/png',
        startTime: 30,
        endTime: 60,
      },
    ];
  });

  it('starts capture and says what to do next', async () => {
    const { body } = await run('browser_network', { action: 'start' });
    expect(body.recording).toBe(true);
    expect(mb.calls).toContain('startRequestCapture');
    expect(String(body.note)).toMatch(/reload/i);
  });

  it('summarises requests worst-first with counts by type', async () => {
    await run('browser_network', { action: 'start' });
    const { body } = await run('browser_network');
    expect(body.total).toBe(4);
    expect(body.failed).toBe(2); // one 500, one that never got a response
    expect(body.byType).toMatchObject({ document: 1, script: 1, xhr: 1, image: 1 });
    expect(body.requests[0].url).toContain('/v1/user'); // failures lead
    expect(body.slowest[0].url).toContain('app.js');
    expect(body.largest[0].url).toContain('app.js');
  });

  it('filters to failures only', async () => {
    await run('browser_network', { action: 'start' });
    const { body } = await run('browser_network', { failedOnly: true });
    expect(body.requests).toHaveLength(2);
    expect(body.requests.every((r: any) => r.status === undefined || r.status >= 400)).toBe(true);
  });

  it('filters by method, resource type and URL glob', async () => {
    await run('browser_network', { action: 'start' });
    const byMethod = await run('browser_network', { method: 'post' });
    expect(byMethod.body.requests).toHaveLength(1);

    const byType = await run('browser_network', { type: 'script' });
    expect(byType.body.requests).toHaveLength(1);
    expect(byType.body.requests[0].url).toContain('app.js');

    const byGlob = await run('browser_network', { url: 'https://cdn.example.test/**' });
    expect(byGlob.body.requests).toHaveLength(1);
    expect(byGlob.body.requests[0].type).toBe('image');
  });

  it('tells the agent capture is off rather than pretending there was no traffic', async () => {
    mb.captured = [];
    const { body } = await run('browser_network');
    expect(body.recording).toBe(false);
    expect(String(body.note)).toMatch(/action.*start/i);
  });

  it('exports a HAR file under .monomind/network and returns the path', async () => {
    await run('browser_network', { action: 'start' });
    mb.harRequests = [{ id: '1', url: 'https://example.test/' }];
    const { body } = await run('browser_network', { action: 'har' });
    expect(body.path).toContain(join('.monomind', 'network') + sep);
    expect(body.path.endsWith('.har')).toBe(true);
    expect(existsSync(body.path)).toBe(true);
    expect(body.entries).toBe(1);
  });

  it('refuses a HAR path outside .monomind/network', async () => {
    await run('browser_network', { action: 'start' });
    const { isError, body } = await run('browser_network', {
      action: 'har',
      path: '../../escape.har',
    });
    expect(isError).toBe(true);
    expect(body.error).toContain('must be within');
  });

  it('fails gracefully with no browser session', async () => {
    mb.connectFails = true;
    const { isError } = await run('browser_network');
    expect(isError).toBe(true);
  });
});

describe('browser_vitals (RIG-03)', () => {
  it('returns structured numbers, the human-readable text and a verdict', async () => {
    mb.vitals = { lcp: 4200, fcp: 900, cls: 0.02, inp: 120, ttfb: 300 };
    const { body } = await run('browser_vitals');
    expect(body.vitals).toMatchObject({ lcp: 4200, cls: 0.02 });
    expect(body.formatted).toContain('LCP');
    expect(body.assessment.lcp).toBe('poor');
    expect(body.assessment.fcp).toBe('good');
    expect(body.worst[0]).toContain('LCP');
  });

  it('includes the heaviest resources when network capture has data', async () => {
    mb.vitals = { lcp: 1000 };
    mb.captured = [
      {
        id: '1',
        url: 'https://example.test/huge.js',
        method: 'GET',
        status: 200,
        mimeType: 'application/javascript',
        startTime: 0,
        endTime: 100,
        encodedSize: 900000,
      },
      {
        id: '2',
        url: 'https://example.test/small.css',
        method: 'GET',
        status: 200,
        mimeType: 'text/css',
        startTime: 0,
        endTime: 10,
        encodedSize: 900,
      },
    ];
    const { body } = await run('browser_vitals');
    expect(body.heaviestResources[0].url).toContain('huge.js');
    expect(body.heaviestResources[0].sizeBytes).toBe(900000);
  });

  it('says why heaviest resources are missing when nothing was captured', async () => {
    mb.vitals = { lcp: 1000 };
    const { body } = await run('browser_vitals');
    expect(body.heaviestResources).toBeUndefined();
    expect(String(body.note)).toMatch(/browser_network/);
  });

  it('fails gracefully with no browser session', async () => {
    mb.connectFails = true;
    const { isError } = await run('browser_vitals');
    expect(isError).toBe(true);
  });
});

describe('browser_profile (RIG-04)', () => {
  const profile = {
    startTime: 0,
    endTime: 1_000_000, // µs → 1000ms
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 }, hitCount: 0 },
      {
        id: 2,
        callFrame: { functionName: 'render', url: 'https://x.test/app.js', lineNumber: 41 },
        hitCount: 60,
      },
      {
        id: 3,
        callFrame: { functionName: '', url: 'https://x.test/app.js', lineNumber: 7 },
        hitCount: 30,
      },
      {
        id: 4,
        callFrame: { functionName: 'tick', url: 'https://x.test/app.js', lineNumber: 90 },
        hitCount: 10,
      },
    ],
  };

  it('starts a CPU profile', async () => {
    const { body } = await run('browser_profile', { action: 'start' });
    expect(body.profiling).toBe(true);
    expect(mb.calls).toContain('startCpuProfile');
  });

  it('stops, writes the .cpuprofile and summarises the top functions', async () => {
    mb.cpuProfile = profile;
    await run('browser_profile', { action: 'start' });
    const { body } = await run('browser_profile', { action: 'stop', topFunctions: 2 });
    expect(body.path).toContain(join('.monomind', 'profiles') + sep);
    expect(existsSync(body.path)).toBe(true);
    expect(body.durationMs).toBe(1000);
    expect(body.topFunctions).toHaveLength(2);
    expect(body.topFunctions[0]).toMatchObject({ functionName: 'render', selfMs: 600 });
    expect(body.topFunctions[1].functionName).toBe('(anonymous)');
    // The artifact is megabytes; the agent gets an answer without reading it.
    expect(JSON.parse(readFileSync(body.path, 'utf8')).nodes).toHaveLength(4);
  });

  it('adds up self time when one function appears under several call paths', async () => {
    // Real profiles have one node per call path, so a hot helper shows up
    // many times — the summary has to merge them or it under-reports it.
    mb.cpuProfile = {
      startTime: 0,
      endTime: 1_000_000,
      nodes: [
        {
          id: 1,
          callFrame: { functionName: 'parse', url: 'https://x.test/app.js', lineNumber: 5 },
          hitCount: 25,
        },
        {
          id: 2,
          callFrame: { functionName: 'parse', url: 'https://x.test/app.js', lineNumber: 5 },
          hitCount: 25,
        },
        {
          id: 3,
          callFrame: { functionName: 'draw', url: 'https://x.test/app.js', lineNumber: 80 },
          hitCount: 40,
        },
      ],
    };
    await run('browser_profile', { action: 'start' });
    const { body } = await run('browser_profile', { action: 'stop' });
    expect(body.totalSamples).toBe(90);
    // parse: 50 of 90 samples over a 1000ms window; draw: 40.
    expect(body.topFunctions[0]).toMatchObject({ functionName: 'parse', selfMs: 555.6 });
    expect(body.topFunctions[1]).toMatchObject({ functionName: 'draw', selfMs: 444.4 });
  });

  it("uses monobrowse's own snapshot, without capturing chunks itself", async () => {
    const { body } = await run('browser_profile', { action: 'heap' });
    expect(body.path.endsWith('.heapsnapshot')).toBe(true);
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(readFileSync(body.path, 'utf8')).toContain('monobrowse');
    expect(String(body.note)).toMatch(/DevTools/i);
    expect(mb.cdpSent).not.toContain('HeapProfiler.takeHeapSnapshot');
  });

  it('rejects an unknown action', async () => {
    const { isError, body } = await run('browser_profile', { action: 'explode' });
    expect(isError).toBe(true);
    expect(body.error).toContain('action');
  });

  it('fails gracefully with no browser session', async () => {
    mb.connectFails = true;
    const { isError } = await run('browser_profile', { action: 'start' });
    expect(isError).toBe(true);
  });
});

describe('browser_emulate (RIG-09)', () => {
  it('lists the available devices when called with no arguments', async () => {
    const { body } = await run('browser_emulate');
    expect(body.devices).toContain('iPhone 14');
    expect(mb.emulated).toEqual([]);
  });

  it('applies a single device profile', async () => {
    const { body } = await run('browser_emulate', { device: 'iPhone 14' });
    expect(body.device).toBe('iPhone 14');
    expect(mb.emulated).toEqual(['iPhone 14']);
  });

  it('reports the available devices when the name is unknown', async () => {
    const { isError, body } = await run('browser_emulate', { device: 'Nokia 3310' });
    expect(isError).toBe(true);
    expect(body.error).toContain('iPhone 14');
  });

  it('screenshots the current URL across a device matrix and returns the paths', async () => {
    const { body } = await run('browser_emulate', { devices: ['iPhone 14', 'iPad'] });
    expect(body.url).toBe('https://example.test/app');
    expect(body.screenshots).toHaveLength(2);
    expect(body.screenshots[0]).toMatchObject({ device: 'iPhone 14' });
    expect(body.screenshots[0].path).toContain(join('.monomind', 'screenshots') + sep);
    expect(body.screenshots.map((s: any) => s.device)).toEqual(['iPhone 14', 'iPad']);
    expect(mb.screenshots).toHaveLength(2);
    // Emulation must not leak into whatever the agent does next.
    expect(mb.cdpSent).toContain('Emulation.clearDeviceMetricsOverride');
  });

  it('keeps going when one device in the matrix fails', async () => {
    const { body } = await run('browser_emulate', { devices: ['iPhone 14', 'Nokia 3310'] });
    expect(body.screenshots).toHaveLength(2);
    expect(body.screenshots[1].error).toContain('Unknown device');
    expect(body.failed).toBe(1);
  });

  it('caps the matrix size', async () => {
    const { isError, body } = await run('browser_emulate', {
      devices: Array.from({ length: 12 }, () => 'iPad'),
    });
    expect(isError).toBe(true);
    expect(body.error).toMatch(/max/i);
  });

  it('fails gracefully with no browser session', async () => {
    mb.connectFails = true;
    const { isError } = await run('browser_emulate', { device: 'iPad' });
    expect(isError).toBe(true);
  });
});

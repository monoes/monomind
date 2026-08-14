import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('route-outcomes end-to-end correlation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-outcomes-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records routeId in last-route.json and route-outcomes.jsonl, then correlates outcome on session-end', async () => {
    const routeHandler = require('../../.claude/helpers/handlers/route-handler.cjs');
    const sessionHandler = require('../../.claude/helpers/handlers/session-handler.cjs');

    const hCtxRoute = {
      prompt: 'Refactor database models in typescript',
      hookInput: {},
      router: {
        routeTask: () => ({
          agent: 'backend-developer',
          confidence: 0.9,
          reason: 'database models task',
        }),
      },
      intelligence: {
        getContext: () => ({}),
      },
      CWD: tmpDir,
      isSimpleCommand: () => false,
    };

    await routeHandler.handle(hCtxRoute);

    const lastRoutePath = path.join(tmpDir, '.monomind', 'last-route.json');
    expect(fs.existsSync(lastRoutePath)).toBe(true);
    const lastRoute = JSON.parse(fs.readFileSync(lastRoutePath, 'utf-8'));
    expect(lastRoute.routeId).toBeDefined();
    expect(lastRoute.agent).toBe('backend-developer');

    const routeOutcomesPath = path.join(tmpDir, '.monomind', 'route-outcomes.jsonl');
    expect(fs.existsSync(routeOutcomesPath)).toBe(true);
    const roLines = fs.readFileSync(routeOutcomesPath, 'utf-8').trim().split('\n').map(JSON.parse);
    expect(roLines.length).toBe(1);
    expect(roLines[0].routeId).toBe(lastRoute.routeId);
    expect(roLines[0].recommendedAgent).toBe('backend-developer');
    expect(roLines[0].measuredSuccess).toBeUndefined();

    // Now trigger session-end with measured success
    const hCtxSession = {
      hookInput: { sessionId: 'sess-123' },
      intelligence: {},
      session: {},
      CWD: tmpDir,
    };

    // Simulate outcomes signal
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'data', 'intelligence-outcomes.jsonl'),
      JSON.stringify({ ts: Date.now(), success: true }) + '\n',
    );

    await sessionHandler.handleEnd(hCtxSession);

    const roLinesAfter = fs
      .readFileSync(routeOutcomesPath, 'utf-8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(roLinesAfter.length).toBe(1);
    expect(roLinesAfter[0].routeId).toBe(lastRoute.routeId);
    expect(roLinesAfter[0].measuredSuccess).toBe(true);
    expect(roLinesAfter[0].agentActuallyUsed).toBe('backend-developer');
  });
});

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('route-outcomes end-to-end correlation', () => {
  let tmpDir;
  let savedQuiet;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-outcomes-test-'));
    savedQuiet = process.env.MONOMIND_HOOK_QUIET;
    process.env.MONOMIND_HOOK_QUIET = '1';
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'coder', name: 'coder', description: 'Writes code' },
          {
            slug: 'engineering-security-engineer',
            name: 'Security Engineer',
            description: 'Threat modeling and vulnerability assessment',
          },
          { slug: 'devops-automator', name: 'DevOps Automator', description: 'CI/CD pipelines' },
        ],
      }),
    );
  });

  afterEach(() => {
    if (savedQuiet === undefined) delete process.env.MONOMIND_HOOK_QUIET;
    else process.env.MONOMIND_HOOK_QUIET = savedQuiet;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The session-end outcome is derived from a commit in the last 30 minutes.
  const commitInTmp = () => {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    };
    const run = (...args) => execFileSync('git', args, { cwd: tmpDir, env, stdio: 'ignore' });
    run('init', '-q');
    run('commit', '--allow-empty', '-q', '-m', 'work');
  };

  const readOutcomes = () =>
    fs
      .readFileSync(path.join(tmpDir, '.monomind', 'route-outcomes.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map(JSON.parse);

  it('joins the real spawned agent (adherence) and the session outcome onto the route by routeId', async () => {
    const routeHandler = require('../../.claude/helpers/handlers/route-handler.cjs');
    const sessionHandler = require('../../.claude/helpers/handlers/session-handler.cjs');
    const pickCore = require('../../.claude/helpers/handlers/pick-core.cjs');

    await routeHandler.handle({
      prompt: 'ask the devops automator to set up the CI/CD pipelines',
      hookInput: { session_id: 'sess-123' },
      CWD: tmpDir,
      isSimpleCommand: () => false,
    });

    const lastRoute = pickCore.readSessionRoute(tmpDir, 'sess-123');
    expect(lastRoute.routeId).toBeDefined();
    expect(lastRoute.agent).toBe('DevOps Automator');
    let [rec] = readOutcomes();
    expect(rec.routeId).toBe(lastRoute.routeId);
    expect(rec.recommendedAgent).toBe('DevOps Automator');
    expect(rec.agentActuallyUsed).toBeUndefined();

    // Claude spawns a different agent than recommended.
    pickCore.recordAdherence(tmpDir, {
      session_id: 'sess-123',
      tool_name: 'Task',
      tool_input: { subagent_type: 'coder' },
    });

    commitInTmp();
    await sessionHandler.handleEnd({
      hookInput: { sessionId: 'sess-123' },
      session: {},
      CWD: tmpDir,
    });

    const after = readOutcomes();
    expect(after).toHaveLength(1);
    [rec] = after;
    expect(rec.measuredSuccess).toBe(true);
    // The real spawn, not the recommendation.
    expect(rec.agentActuallyUsed).toBe('coder');
  });

  it('leaves agentActuallyUsed unset when no subagent ran', async () => {
    const routeHandler = require('../../.claude/helpers/handlers/route-handler.cjs');
    const sessionHandler = require('../../.claude/helpers/handlers/session-handler.cjs');
    await routeHandler.handle({
      prompt: 'ask the devops automator to set up the CI/CD pipelines',
      hookInput: { session_id: 'sess-9' },
      CWD: tmpDir,
      isSimpleCommand: () => false,
    });
    commitInTmp();
    await sessionHandler.handleEnd({
      hookInput: { sessionId: 'sess-9' },
      session: {},
      CWD: tmpDir,
    });
    const [rec] = readOutcomes();
    expect(rec.measuredSuccess).toBe(true);
    expect(rec.agentActuallyUsed).toBeUndefined();
  });
});

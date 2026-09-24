import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAgentRouter } from '../init/helpers-generator.js';

// The router.cjs fallback init writes when the full helper can't be copied.
// It must name only agents from the project's registry — never a built-in table.
describe('generateAgentRouter fallback', () => {
  let dir: string;
  let routerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'router-fallback-'));
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'helpers'), { recursive: true });
    routerPath = join(dir, '.claude', 'helpers', 'router.cjs');
    writeFileSync(routerPath, generateAgentRouter());
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function route(task: string): Record<string, unknown> {
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `console.log(JSON.stringify(require(${JSON.stringify(routerPath)}).routeTask(${JSON.stringify(task)})))`,
      ],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf-8' },
    );
    return JSON.parse(out);
  }

  it('carries no hardcoded agent table', () => {
    const src = generateAgentRouter();
    expect(src).not.toMatch(/backend-dev|frontend-dev|'coder'/);
  });

  it('picks a registry agent by frontmatter name on a strong match', () => {
    writeFileSync(
      join(dir, '.monomind', 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'devops-automator', name: 'DevOps Automator', description: 'CI/CD pipelines' },
          { slug: 'coder', name: 'coder', description: 'Writes code' },
        ],
      }),
    );
    expect(route('ask the devops automator to fix the deploy')).toMatchObject({
      agent: 'DevOps Automator',
      agentSlug: 'devops-automator',
    });
  });

  it('names no agent without a registry or a strong match', () => {
    expect(route('write unit tests for the parser')).toMatchObject({ agent: null });
  });

  it('matches skills from skill-registry.json', () => {
    writeFileSync(
      join(dir, '.claude', 'helpers', 'skill-registry.json'),
      JSON.stringify({
        skills: [{ skill: 'tokens', invoke: '/tokens', nameTerms: ['tokens'], keywords: ['cost'] }],
      }),
    );
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `console.log(JSON.stringify(require(${JSON.stringify(routerPath)}).matchSkills('show tokens cost')))`,
      ],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf-8' },
    );
    expect(JSON.parse(out)).toEqual([expect.objectContaining({ invoke: '/tokens', score: 3 })]);
  });
});

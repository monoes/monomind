// projectDataDir() puts a project's memory store under ~/.monomind/projects/<name>-<hash>. A
// harness that must keep a run's state out of the real home (the eval smoke tier) sets
// MONOMIND_PROJECTS_DIR to redirect that one parent directory; without it nothing changes.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getProjectRoot, projectDataDir } from '../src/memory/memory-bridge-paths.js';

const saved = process.env.MONOMIND_PROJECTS_DIR;
afterEach(() => {
  if (saved === undefined) delete process.env.MONOMIND_PROJECTS_DIR;
  else process.env.MONOMIND_PROJECTS_DIR = saved;
});

describe('projectDataDir', () => {
  it('is under ~/.monomind/projects by default', () => {
    delete process.env.MONOMIND_PROJECTS_DIR;
    expect(projectDataDir().startsWith(`${join(homedir(), '.monomind', 'projects')}/`)).toBe(true);
  });

  it('is under MONOMIND_PROJECTS_DIR when set, with the same <name>-<hash> leaf', () => {
    delete process.env.MONOMIND_PROJECTS_DIR;
    const leaf = projectDataDir().split('/').pop();
    process.env.MONOMIND_PROJECTS_DIR = '/work/state/projects';
    expect(projectDataDir()).toBe(join('/work/state/projects', leaf as string));
    expect(getProjectRoot()).toBe(getProjectRoot()); // the project identity does not depend on it
  });

  it('refuses a relative override, which would silently depend on the working directory', () => {
    process.env.MONOMIND_PROJECTS_DIR = 'relative/dir';
    expect(() => projectDataDir()).toThrow(/absolute/);
    expect(resolve('/x')).toBe('/x');
  });
});

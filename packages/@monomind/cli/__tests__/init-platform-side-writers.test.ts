/**
 * The pi, kilo and copilot side writers in init are tier 3 (docs/mastermind/plans/
 * 2026-11-surface-reduction.md, section 3): they run only when that platform is
 * selected or the project itself shows it uses it. A config directory in the
 * home directory says the user has the tool, not that this project uses it.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COPILOT_HOOKS_FILE, COPILOT_MESH_SCRIPT } from '../src/init/copilot-generator.js';
import { KILO_MESH_PLUGIN_FILE } from '../src/init/opencode-mesh-plugin.js';
import { PI_MESH_EXTENSION_FILE } from '../src/init/pi-generator.js';
import type { InitOptions, InitResult } from '../src/init/types.js';
import { writeCopilotMeshHooks } from '../src/init/write-copilot.js';
import { writeKiloMeshPlugin } from '../src/init/write-kilo.js';
import { writePiMeshExtension } from '../src/init/write-pi.js';

const dirs: string[] = [];
let home: string;
let project: string;
const savedHome = process.env.HOME;

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function result(): InitResult {
  return { created: { files: [] }, skipped: [], updated: [] } as unknown as InitResult;
}

function options(selectedPlatforms: InitOptions['selectedPlatforms'] = []): InitOptions {
  return { force: false, selectedPlatforms } as unknown as InitOptions;
}

beforeEach(() => {
  home = tmp('side-writers-home-');
  project = tmp('side-writers-project-');
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = savedHome;
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe('pi mesh extension', () => {
  it('is not written when only the home directory has ~/.pi', () => {
    mkdirSync(join(home, '.pi'));
    writePiMeshExtension(project, options(), result());
    expect(existsSync(join(project, PI_MESH_EXTENSION_FILE))).toBe(false);
    expect(existsSync(join(project, '.pi'))).toBe(false);
  });

  it('is written when the project has a .pi directory', () => {
    mkdirSync(join(project, '.pi'));
    const out = result();
    writePiMeshExtension(project, options(), out);
    expect(existsSync(join(project, PI_MESH_EXTENSION_FILE))).toBe(true);
    expect(out.created.files).toContain(PI_MESH_EXTENSION_FILE);
  });
});

describe('kilo mesh plugin', () => {
  it('is not written when only the home directory has ~/.kilo', () => {
    mkdirSync(join(home, '.kilo'));
    mkdirSync(join(home, '.kilocode'));
    writeKiloMeshPlugin(project, options(), result());
    expect(existsSync(join(project, KILO_MESH_PLUGIN_FILE))).toBe(false);
  });

  it.each(['.kilo', '.kilocode'])('is written when the project has %s', (dir) => {
    mkdirSync(join(project, dir));
    writeKiloMeshPlugin(project, options(), result());
    expect(existsSync(join(project, KILO_MESH_PLUGIN_FILE))).toBe(true);
  });
});

describe('copilot mesh hooks', () => {
  it('are not written when only the home directory has ~/.copilot', () => {
    mkdirSync(join(home, '.copilot'));
    mkdirSync(join(home, '.github'));
    writeFileSync(join(home, '.github', 'copilot-instructions.md'), '# mine\n');
    writeCopilotMeshHooks(project, options(['claude']), result());
    expect(existsSync(join(project, COPILOT_HOOKS_FILE))).toBe(false);
    expect(existsSync(join(project, COPILOT_MESH_SCRIPT))).toBe(false);
  });

  it.each(['copilot', 'hermes'] as const)('are written when %s is selected', (platform) => {
    writeCopilotMeshHooks(project, options([platform]), result());
    expect(existsSync(join(project, COPILOT_HOOKS_FILE))).toBe(true);
    expect(existsSync(join(project, COPILOT_MESH_SCRIPT))).toBe(true);
  });

  it('are written when the project has .github/copilot-instructions.md', () => {
    mkdirSync(join(project, '.github'));
    writeFileSync(join(project, '.github', 'copilot-instructions.md'), '# project\n');
    writeCopilotMeshHooks(project, options(), result());
    expect(existsSync(join(project, COPILOT_HOOKS_FILE))).toBe(true);
  });
});

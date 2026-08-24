import { describe, it, expect } from 'vitest';
import { platformsCommand, SUPPORTED_PLATFORMS } from '../../src/commands/platforms.js';
import { PLATFORM_IDS } from '../../src/platform-adapters/registry.js';

describe('platformsCommand', () => {
  it('is defined with correct name', () => {
    expect(platformsCommand).toBeDefined();
    expect(platformsCommand.name).toBe('platforms');
  });

  it('derives supported platforms from the canonical registry', () => {
    expect(SUPPORTED_PLATFORMS).toEqual(PLATFORM_IDS);
  });

  it('has subcommands', () => {
    expect(platformsCommand.subcommands).toBeDefined();
    expect(platformsCommand.subcommands!.length).toBeGreaterThanOrEqual(2);
  });

  it('subcommand names are install and uninstall', () => {
    const names = platformsCommand.subcommands!.map(s => s.name);
    expect(names).toContain('install');
    expect(names).toContain('uninstall');
    expect(names).toContain('doctor');
    expect(names).toContain('docs');
  });

  it('install subcommand has expected options', () => {
    const install = platformsCommand.subcommands!.find(s => s.name === 'install');
    expect(install).toBeDefined();
    const optionNames = install!.options!.map(o => o.name);
    expect(optionNames).toContain('platform');
    expect(optionNames).toContain('all');
    expect(optionNames).toContain('path');
  });
});

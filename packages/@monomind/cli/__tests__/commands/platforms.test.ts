import { describe, it, expect } from 'vitest';
import { platformsCommand, SUPPORTED_PLATFORMS } from '../../src/commands/platforms.js';

describe('platformsCommand', () => {
  it('is defined with correct name', () => {
    expect(platformsCommand).toBeDefined();
    expect(platformsCommand.name).toBe('platforms');
  });

  it('SUPPORTED_PLATFORMS has 14 platforms', () => {
    expect(SUPPORTED_PLATFORMS.length).toBe(14);
  });

  it('has subcommands', () => {
    expect(platformsCommand.subcommands).toBeDefined();
    expect(platformsCommand.subcommands!.length).toBeGreaterThanOrEqual(2);
  });

  it('subcommand names are install and uninstall', () => {
    const names = platformsCommand.subcommands!.map(s => s.name);
    expect(names).toContain('install');
    expect(names).toContain('uninstall');
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

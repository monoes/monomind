import { describe, expect, it } from 'vitest';
import { getCommandAsync, hasCommand } from '../../packages/@monomind/cli/src/commands/index.js';
import { uiCommand } from '../../packages/@monomind/cli/src/commands/ui.js';

describe('ui command', () => {
  it('is registered in command registry and accessible via alias', async () => {
    expect(hasCommand('ui')).toBe(true);
    expect(hasCommand('dashboard')).toBe(true);

    const cmd = await getCommandAsync('ui');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('ui');
    expect(cmd?.aliases).toContain('dashboard');
  });

  it('has expected flags for port, open, no-open, and project-dir', () => {
    const optNames = uiCommand.options?.map((o) => o.name) || [];
    expect(optNames).toContain('port');
    expect(optNames).toContain('open');
    expect(optNames).toContain('no-open');
    expect(optNames).toContain('project-dir');
  });
});

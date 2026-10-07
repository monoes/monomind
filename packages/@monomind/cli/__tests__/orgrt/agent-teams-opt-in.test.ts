// #655: Claude Code's experimental Agent Teams are opt-in.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTokenCostSettings } from '../../src/commands/doctor-cost-checks.js';
import { generateSettings } from '../../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../../src/init/types.js';
import { mergeSettingsForUpgrade } from '../../src/init/upgrade-steps.js';

const FLAG = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
const gen = (o = {}) =>
  generateSettings({ ...DEFAULT_INIT_OPTIONS, ...o }) as {
    env: Record<string, string>;
    monomind: Record<string, unknown>;
  };

describe('agent teams are opt-in', () => {
  it('init writes neither the flag nor monomind.agentTeams by default', () => {
    const s = gen();
    expect(s.env).not.toHaveProperty(FLAG);
    expect(s.monomind).not.toHaveProperty('agentTeams');
  });

  it('--agent-teams writes both', () => {
    const s = gen({ agentTeams: true });
    expect(s.env[FLAG]).toBe('1');
    expect(s.monomind).toHaveProperty('agentTeams');
  });

  it('upgrade does not add them, and keeps what a user already has', () => {
    const fresh = mergeSettingsForUpgrade({ env: {} }) as { env: Record<string, string>; monomind: object };
    expect(fresh.env).not.toHaveProperty(FLAG);
    expect(fresh.monomind).not.toHaveProperty('agentTeams');
    const kept = mergeSettingsForUpgrade({ env: { [FLAG]: '1' }, monomind: { agentTeams: { enabled: true } } }) as {
      env: Record<string, string>;
      monomind: object;
    };
    expect(kept.env[FLAG]).toBe('1');
    expect(kept.monomind).toHaveProperty('agentTeams');
  });

  it('doctor reports a leftover flag and the unused block', async () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'teams-'));
    const home = join(root, 'h');
    const proj = join(root, 'p');
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(proj, '.claude'), { recursive: true });
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      writeFileSync(
        join(proj, '.claude', 'settings.json'),
        JSON.stringify({ env: { [FLAG]: '1' }, monomind: { agentTeams: {} } }),
      );
      const r = await checkTokenCostSettings(proj);
      expect(r.message).toContain('AGENT_TEAMS=1');
      expect(r.message).toContain('monomind.agentTeams');
    } finally {
      process.env.HOME = saved;
    }
  });
});

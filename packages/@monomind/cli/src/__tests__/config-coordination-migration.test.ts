import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigFileManager } from '../services/config-file-manager.js';

describe('config: monoswarm.* -> coordination.* migration', () => {
  const dirs: string[] = [];
  const mk = (config?: object) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-mig-'));
    dirs.push(d);
    if (config) fs.writeFileSync(path.join(d, 'monomind.config.json'), JSON.stringify(config));
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('defaults use the neutral section', () => {
    const m = new ConfigFileManager();
    expect(m.getDefaults().coordination).toMatchObject({ topology: 'hierarchical', maxAgents: 8 });
    expect(m.getDefaults().monoswarm).toBeUndefined();
  });

  it('honours old keys in an existing file when reading', () => {
    const cwd = mk({ monoswarm: { topology: 'mesh', maxAgents: 12 } });
    const m = new ConfigFileManager();
    expect(m.get(cwd, 'coordination.topology')).toBe('mesh');
    expect(m.get(cwd, 'monoswarm.maxAgents')).toBe(12);
    expect(m.getConfig(cwd).monoswarm).toBeUndefined();
  });

  it('new section wins over the old one when both exist', () => {
    const cwd = mk({
      monoswarm: { topology: 'mesh', maxAgents: 12 },
      coordination: { maxAgents: 3 },
    });
    const m = new ConfigFileManager();
    expect(m.get(cwd, 'coordination.maxAgents')).toBe(3);
    expect(m.get(cwd, 'coordination.topology')).toBe('mesh');
  });

  it('setting an old key writes the neutral one and drops the legacy section', () => {
    const cwd = mk({ monoswarm: { topology: 'mesh', maxAgents: 12 } });
    new ConfigFileManager().set(cwd, 'monoswarm.maxAgents', 20);
    const onDisk = JSON.parse(fs.readFileSync(path.join(cwd, 'monomind.config.json'), 'utf8'));
    expect(onDisk.monoswarm).toBeUndefined();
    expect(onDisk.coordination).toEqual({ topology: 'mesh', maxAgents: 20 });
  });
});

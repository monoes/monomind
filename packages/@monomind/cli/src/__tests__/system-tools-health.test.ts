import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemTools } from '../mcp-tools/system-tools.js';

// Regression test for #239: system_health's deep memory/config checks used to
// look at paths that `monomind init` never creates (`.monomind/memory/store.json`,
// `.monomind/config.json`), so it reported "degraded"/"unhealthy" on every
// correctly-initialized project even though `monomind doctor` — which checks
// the real paths — passed on the same project at the same time.
describe('system_health deep checks (#239)', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'system-health-test-'));
    prevCwd = process.env.MONOMIND_CWD;
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  function getHealthTool() {
    const tool = systemTools.find((t) => t.name === 'system_health');
    if (!tool) throw new Error('system_health tool not found');
    return tool;
  }

  it('reports memory and config as healthy when the real init-created files are present', async () => {
    // Mirrors what `monomind init --force -y` actually creates.
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(join(dir, '.monomind', 'config.yaml'), 'version: 1\n');
    mkdirSync(join(dir, '.swarm'), { recursive: true });
    writeFileSync(join(dir, '.swarm', 'memory.db'), 'x');

    const result = (await getHealthTool().handler({ deep: true })) as {
      checks: Array<{ name: string; status: string; message?: string }>;
    };

    const memoryCheck = result.checks.find((c) => c.name === 'memory');
    const configCheck = result.checks.find((c) => c.name === 'config');
    expect(memoryCheck?.status).toBe('healthy');
    expect(configCheck?.status).toBe('healthy');
  });

  it('reports memory and config as degraded when neither real file exists', async () => {
    const result = (await getHealthTool().handler({ deep: true })) as {
      checks: Array<{ name: string; status: string; message?: string }>;
    };

    const memoryCheck = result.checks.find((c) => c.name === 'memory');
    const configCheck = result.checks.find((c) => c.name === 'config');
    expect(memoryCheck?.status).toBe('degraded');
    expect(configCheck?.status).toBe('degraded');
  });
});

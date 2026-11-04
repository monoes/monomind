import { describe, expect, it } from 'vitest';
import { VERSION } from '../index.js';
import { generateClaudeMd } from '../init/claudemd-generator.js';
import { generateCodexAgentsMd } from '../init/codex-generator.js';
import { generatePostCommitHook } from '../init/helpers-core-scripts.js';
import { generateKimiAgentsMd } from '../init/kimi-generator-agents-md.js';
import { generateAgentsMd, generateStatusCommand } from '../init/opencode-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';
import { generateAgentsOnlyMd } from '../init/write-agents.js';
import { clineInstallCommand, clineRule } from '../init/write-cline.js';
import { platformInstruction } from '../platform-adapters/core.js';
import { PLATFORM_REGISTRY } from '../platform-adapters/registry.js';
import { renderPlatformPlan } from '../platform-adapters/renderers/factory.js';

describe('init pins every executed monomind command (#419)', () => {
  it('post-commit hook pins to the installed version by default', () => {
    const s = generatePostCommitHook();
    expect(s).toContain(`--package=@monoes/monomindcli@${VERSION} monomind hooks notify`);
    expect(s).not.toContain('monomind@latest');
  });
  it('--pin latest keeps the hook floating, a version pins to it', () => {
    expect(generatePostCommitHook('latest')).toContain('npx -y monomind@latest hooks notify');
    expect(generatePostCommitHook('1.2.3')).toContain('monomindcli@1.2.3 monomind hooks notify');
  });
  it('cline install command and rule are pinned unless latest', () => {
    expect(clineInstallCommand()).toContain(`monomindcli@${VERSION} monomind mcp start`);
    expect(clineRule()).not.toContain('monomind@latest');
    expect(clineInstallCommand('latest')).toContain('npx -y monomind@latest mcp start');
    expect(clineRule('latest')).toContain('monomind@latest');
  });
});

describe('generated guidance names the same pinned command (#419)', () => {
  const pinned = `npx -y --package=@monoes/monomindcli@${VERSION} monomind`;
  const guidance: Array<[string, (pin?: string) => string]> = [
    ['agents-only AGENTS.md', generateAgentsOnlyMd],
    ['Codex AGENTS.md', generateCodexAgentsMd],
    ['kimi AGENTS.md', generateKimiAgentsMd],
    ['opencode AGENTS.md', generateAgentsMd],
    ['opencode status command', generateStatusCommand],
    ['platform instruction block', (pin) => platformInstruction(PLATFORM_REGISTRY.claude, pin)],
  ];

  it.each(guidance)('%s pins to the installed version by default', (_name, render) => {
    const text = render();
    expect(text).toContain(pinned);
    expect(text).not.toContain('monomind@latest');
  });

  it.each(guidance)('%s floats with --pin latest and follows an explicit pin', (_name, render) => {
    expect(render('latest')).toContain('npx -y monomind@latest');
    expect(render('latest')).not.toContain('--package=');
    expect(render('1.2.3')).toContain('npx -y --package=@monoes/monomindcli@1.2.3 monomind');
  });

  it('security-scan hints carry the pin', () => {
    expect(generateAgentsOnlyMd()).toContain(`\`${pinned} security scan\``);
    expect(generateCodexAgentsMd('latest')).toContain('`npx -y monomind@latest security scan`');
  });

  it('the platform plan threads the install pin into the instruction block', () => {
    const plan = (pin?: string) =>
      renderPlatformPlan(PLATFORM_REGISTRY.claude, { platform: 'claude', scope: 'project', pin });
    const instruction = (pin?: string) =>
      plan(pin).intents.find((intent) => intent.kind === 'instruction')?.content ?? '';
    expect(instruction()).toContain(pinned);
    expect(instruction('latest')).toContain('npx -y monomind@latest doctor');
  });

  it("CLAUDE.md's MCP setup hint follows init's pin", () => {
    const md = (pin?: string) =>
      generateClaudeMd(
        {
          ...DEFAULT_INIT_OPTIONS,
          targetDir: process.cwd(),
          mcp: { ...DEFAULT_INIT_OPTIONS.mcp, pin },
        },
        'full',
      );
    expect(md()).toContain(`claude mcp add monomind -- `);
    expect(md()).toContain(`@monoes/monomindcli@${VERSION} monomind mcp start`);
    expect(md('latest')).toContain('npx -y monomind@latest mcp start');
    expect(md('1.2.3')).toContain('@monoes/monomindcli@1.2.3 monomind mcp start');
  });
});

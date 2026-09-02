/** Codex project artifact writer. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CODEX_STATUS_LINE_ITEMS,
  codexHooksEnabled,
  generateCodexAgentsMd,
  generateCodexConfig,
  generateCodexHookScript,
  generateCodexHooksConfig,
  generateCodexStatusLineConfig,
} from './codex-generator.js';
import { atomicWriteFile } from './shared.js';
import type { InitOptions, InitResult } from './types.js';

function mergeCodexHooks(existing: string): string {
  const hooksConfig = generateCodexHooksConfig().trimEnd();
  const hookBlock = /# monomind:start native-hooks[\s\S]*?# monomind:end native-hooks\n?/m;
  const incompleteHookBlock = /# monomind:start native-hooks[\s\S]*$/m;
  let mergedExisting = existing;
  if (hookBlock.test(mergedExisting)) {
    mergedExisting = mergedExisting.replace(hookBlock, `${hooksConfig}\n`);
  } else if (incompleteHookBlock.test(mergedExisting)) {
    mergedExisting = mergedExisting.replace(incompleteHookBlock, `${hooksConfig}\n`);
  } else {
    mergedExisting = `${mergedExisting.trimEnd()}\n\n${hooksConfig}\n`;
  }
  if (!/^\[features\]\s*$/m.test(mergedExisting)) {
    mergedExisting = `[features]\nhooks = true\n\n${mergedExisting}`;
  } else if (!/^hooks\s*=\s*true\s*$/m.test(mergedExisting)) {
    const featureLines = mergedExisting.split(/\r?\n/);
    const featureStart = featureLines.findIndex((line) => /^\[features\]\s*$/.test(line));
    let featureEnd = featureStart + 1;
    while (featureEnd < featureLines.length && !/^\[/.test(featureLines[featureEnd])) featureEnd++;
    featureLines.splice(featureEnd, 0, 'hooks = true');
    mergedExisting = featureLines.join('\n');
  }
  return mergedExisting;
}

function mergeCodexConfig(existing: string, generated: string, enableHooks: boolean): string {
  const generatedLines = generated.split(/\r?\n/);
  const generatedStart = generatedLines.findIndex((line) =>
    /^\[mcp_servers\.monomind\]\s*$/.test(line),
  );
  let generatedEnd = generatedStart + 1;
  while (generatedEnd < generatedLines.length && !/^\[/.test(generatedLines[generatedEnd])) {
    generatedEnd++;
  }
  const section =
    generatedStart === -1 ? '' : generatedLines.slice(generatedStart, generatedEnd).join('\n');
  const statusLine = generateCodexStatusLineConfig().trimEnd();
  let mergedExisting = enableHooks
    ? mergeCodexHooks(existing)
    : existing.replace(/# monomind:start native-hooks[\s\S]*?# monomind:end native-hooks\n?/m, '');
  if (!/^\s*status_line\s*=/m.test(mergedExisting)) {
    const tuiHeader = /^\[tui\]\s*$/m;
    if (tuiHeader.test(mergedExisting)) {
      const lines = mergedExisting.split(/\r?\n/);
      const start = lines.findIndex((line) => /^\[tui\]\s*$/.test(line));
      let end = start + 1;
      while (end < lines.length && !/^\[\[?[^\]]+\]\]?\s*$/.test(lines[end])) end++;
      lines.splice(
        end,
        0,
        `status_line = [${CODEX_STATUS_LINE_ITEMS.map((item) => JSON.stringify(item)).join(', ')}]`,
      );
      mergedExisting = lines.join('\n');
    } else {
      mergedExisting = `${mergedExisting.trimEnd()}\n\n${statusLine}\n`;
    }
  }
  if (!section) return mergedExisting;
  const sectionStart = /^\[mcp_servers\.monomind\]\s*$/m;
  if (!sectionStart.test(mergedExisting)) {
    return `${mergedExisting.trimEnd()}\n\n${section.trimEnd()}\n`;
  }
  const lines = mergedExisting.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\[mcp_servers\.monomind\]\s*$/.test(line));
  let end = start + 1;
  while (end < lines.length) {
    const header = /^\[\[?([^\]]+)\]\]?\s*$/.exec(lines[end]);
    if (header && !header[1].startsWith('mcp_servers.monomind.')) break;
    end++;
  }
  const merged = [...lines.slice(0, start), section.trimEnd(), ...lines.slice(end)].join('\n');
  return merged.endsWith('\n') ? merged : `${merged}\n`;
}

export async function writeCodexFiles(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const codexDir = path.join(targetDir, '.codex');
  const configPath = path.join(codexDir, 'config.toml');
  fs.mkdirSync(codexDir, { recursive: true });
  const hooksDir = path.join(codexDir, 'hooks');
  const hookPath = path.join(hooksDir, 'monomind-hook.cjs');
  const enableHooks = codexHooksEnabled(options);

  if (enableHooks && (!fs.existsSync(hookPath) || options.force)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    atomicWriteFile(hookPath, generateCodexHookScript());
    result.created.files.push('.codex/hooks/monomind-hook.cjs');
  } else if (enableHooks) {
    result.skipped.push('.codex/hooks/monomind-hook.cjs');
  }

  if (!fs.existsSync(configPath)) {
    atomicWriteFile(configPath, generateCodexConfig(options));
    result.created.files.push('.codex/config.toml');
  } else if (options.force) {
    const current = fs.readFileSync(configPath, 'utf8');
    const merged = mergeCodexConfig(
      current,
      generateCodexConfig(options),
      enableHooks,
    );
    if (merged !== current) {
      atomicWriteFile(configPath, merged);
      result.updated.push('.codex/config.toml (merged monomind server)');
    } else {
      result.skipped.push('.codex/config.toml');
    }
  } else {
    const current = fs.readFileSync(configPath, 'utf8');
    const mergedHooks = enableHooks
      ? mergeCodexHooks(current)
      : current.replace(/# monomind:start native-hooks[\s\S]*?# monomind:end native-hooks\n?/m, '');
    if (mergedHooks !== current) {
      atomicWriteFile(configPath, mergedHooks);
      result.updated.push('.codex/config.toml (managed native hooks)');
    } else {
      result.skipped.push('.codex/config.toml');
    }
  }

  const agentsPath = path.join(targetDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    atomicWriteFile(agentsPath, generateCodexAgentsMd());
    result.created.files.push('AGENTS.md');
  } else {
    result.skipped.push('AGENTS.md');
  }
}

/** Codex project artifact writer. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODEX_STATUS_LINE_ITEMS, generateCodexAgentsMd, generateCodexConfig, generateCodexStatusLineConfig } from './codex-generator.js';
import { atomicWriteFile } from './shared.js';
import type { InitOptions, InitResult } from './types.js';

function mergeCodexConfig(existing: string, generated: string): string {
  const section = generated.match(/^\[mcp_servers\.monomind\][\s\S]*$/m)?.[0] ?? '';
  const statusLine = generateCodexStatusLineConfig().trimEnd();
  let mergedExisting = existing;
  if (!/^\s*status_line\s*=/m.test(existing)) {
    const tuiHeader = /^\[tui\]\s*$/m;
    if (tuiHeader.test(existing)) {
      const lines = existing.split(/\r?\n/);
      const start = lines.findIndex((line) => /^\[tui\]\s*$/.test(line));
      let end = start + 1;
      while (end < lines.length && !/^\[\[?[^\]]+\]\]?\s*$/.test(lines[end])) end++;
      lines.splice(end, 0, `status_line = [${CODEX_STATUS_LINE_ITEMS.map((item) => JSON.stringify(item)).join(', ')}]`);
      mergedExisting = lines.join('\n');
    } else {
      mergedExisting = `${existing.trimEnd()}\n\n${statusLine}\n`;
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

  if (!fs.existsSync(configPath)) {
    atomicWriteFile(configPath, generateCodexConfig(options));
    result.created.files.push('.codex/config.toml');
  } else if (options.force) {
    const current = fs.readFileSync(configPath, 'utf8');
    const merged = mergeCodexConfig(current, generateCodexConfig(options));
    if (merged !== current) {
      atomicWriteFile(configPath, merged);
      result.updated.push('.codex/config.toml (merged monomind server)');
    } else {
      result.skipped.push('.codex/config.toml');
    }
  } else {
    result.skipped.push('.codex/config.toml');
  }

  const agentsPath = path.join(targetDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    atomicWriteFile(agentsPath, generateCodexAgentsMd());
    result.created.files.push('AGENTS.md');
  } else {
    result.skipped.push('AGENTS.md');
  }
}

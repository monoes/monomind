/** Detection and safe cleanup rules for pre-adapter platform installations. */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { mergeManagedBlock, removeManagedMarker } from './merge.js';

export interface LegacySurface {
  id: string;
  path: string;
  scope: 'project' | 'user';
  ownership: 'marker' | 'named-entry' | 'monomind-file';
  action: 'remove-block' | 'remove-entry' | 'remove-file' | 'migrate';
}

export interface LegacyMigrationResult {
  changed: readonly string[];
  skipped: readonly string[];
  diagnostics: readonly string[];
}

/**
 * Every surface is explicit so detection can remain read-only and never infer
 * ownership from an arbitrary file name or config location.
 */
export const LEGACY_SURFACE_INVENTORY: readonly LegacySurface[] = Object.freeze([
  {
    id: 'codex-sessionstart',
    path: '.codex/config.toml',
    scope: 'user',
    ownership: 'marker',
    action: 'remove-block',
  },
  {
    id: 'codex-activate-script',
    path: '.codex/monomind-activate.cjs',
    scope: 'user',
    ownership: 'monomind-file',
    action: 'remove-file',
  },
  {
    id: 'cursor-sessionstart',
    path: '.cursor/settings.json',
    scope: 'project',
    ownership: 'named-entry',
    action: 'remove-entry',
  },
  {
    id: 'cursor-activate-script',
    path: '.cursor/monomind-activate.cjs',
    scope: 'user',
    ownership: 'monomind-file',
    action: 'remove-file',
  },
  {
    id: 'antigravity-plugin',
    path: '.gemini/antigravity-cli/plugins/monomind',
    scope: 'user',
    ownership: 'monomind-file',
    action: 'remove-file',
  },
  {
    id: 'shared-agent-skills',
    path: '.agents/skills',
    scope: 'project',
    ownership: 'monomind-file',
    action: 'remove-file',
  },
  {
    id: 'shared-gemini-skills',
    path: '.gemini/skills',
    scope: 'user',
    ownership: 'monomind-file',
    action: 'remove-file',
  },
  {
    id: 'openclaw-config',
    path: '.claw/config.md',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'cursor-rules',
    path: '.cursorrules',
    scope: 'project',
    ownership: 'marker',
    action: 'remove-block',
  },
  {
    id: 'droid-instructions',
    path: 'DROID.md',
    scope: 'project',
    ownership: 'marker',
    action: 'remove-block',
  },
  {
    id: 'antigravity-rules',
    path: '.agents/rules/monomind.md',
    scope: 'project',
    ownership: 'marker',
    action: 'remove-block',
  },
  {
    id: 'trae-rules',
    path: '.trae/rules/monomind.md',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'hermes-instructions',
    path: 'HERMES.md',
    scope: 'project',
    ownership: 'marker',
    action: 'remove-block',
  },
  {
    id: 'kiro-steering',
    path: '.kiro/steering/monomind.md',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'aider-corrupted-yaml',
    path: '.aider.conf.yml',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'bare-instruction-markers',
    path: 'AGENTS.md',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'claude-bare-instruction-markers',
    path: 'CLAUDE.md',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'gemini-bare-instruction-markers',
    path: 'GEMINI.md',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'copilot-bare-instruction-markers',
    path: '.github/copilot-instructions.md',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'cursor-bare-instruction-markers',
    path: '.cursor/rules/monomind.mdc',
    scope: 'project',
    ownership: 'marker',
    action: 'migrate',
  },
  {
    id: 'claude-global-instructions',
    path: '.claude/CLAUDE.md',
    scope: 'user',
    ownership: 'marker',
    action: 'remove-block',
  },
  {
    id: 'claude-global-sessionstart',
    path: '.claude/settings.json',
    scope: 'user',
    ownership: 'named-entry',
    action: 'remove-entry',
  },
]);

export function isMonomindOwned(content: string): boolean {
  return /(?:<!--\s*)?monomind:start|monomind-activate|name:\s*mastermind(?:-|$)/i.test(content);
}

export function findLegacySurfaces(root: string, scope: 'project' | 'user'): string[] {
  return LEGACY_SURFACE_INVENTORY.filter((surface) => surface.scope === scope)
    .filter((surface) => {
      const path = join(root, surface.path);
      if (!existsSync(path)) return false;
      if (surface.ownership === 'monomind-file') return true;
      try {
        return isMonomindOwned(readFileSync(path, 'utf8'));
      } catch {
        return false;
      }
    })
    .map((surface) => surface.id);
}

/** Remove only old marker blocks; callers retain unrelated content and keys. */
export function removeLegacyManagedBlocks(content: string): string {
  return removeManagedMarker(
    removeManagedMarker(content, 'instructions:codex'),
    'instructions:opencode',
  )
    .replace(/\n?<!--\s*monomind:start\s*-->[\s\S]*?<!--\s*monomind:end\s*-->\n?/g, '\n')
    .replace(/\n?#\s*monomind:start\s*[\s\S]*?#\s*monomind:end\s*\n?/g, '\n');
}

/** Recover a YAML file corrupted by the historical HTML comment installer. */
export function deCorruptAiderYaml(content: string): string {
  const cleaned = content
    .replace(/\n?<!--\s*monomind:start\s*-->[\s\S]*?<!--\s*monomind:end\s*-->\n?/g, '\n')
    .trimEnd();
  if (/^read:\s*/m.test(cleaned)) return `${cleaned}\n`;
  return `${cleaned ? `${cleaned}\n` : ''}read: CONVENTIONS.md\n`;
}

const BARE_BLOCK =
  /(?:<!--\s*)?monomind:start\s*-->(?:\r?\n)?([\s\S]*?)(?:<!--\s*)?monomind:end\s*-->(?:\r?\n)?/i;
const HASH_BARE_BLOCK = /#\s*monomind:start\s*(?:\r?\n)?([\s\S]*?)#\s*monomind:end\s*(?:\r?\n)?/i;

function takeLegacyBlock(content: string): { body: string; remainder: string } | undefined {
  const match = BARE_BLOCK.exec(content) ?? HASH_BARE_BLOCK.exec(content);
  if (!match) return undefined;
  return {
    body: match[1]!.trim(),
    remainder: `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`,
  };
}

function instructionMarker(surface: LegacySurface, body: string): string | undefined {
  switch (surface.id) {
    case 'trae-rules':
      return 'instructions:trae';
    case 'kiro-steering':
      return 'instructions:kiro';
    case 'claude-bare-instruction-markers':
      return 'instructions:claude';
    case 'gemini-bare-instruction-markers':
      return 'instructions:gemini';
    case 'copilot-bare-instruction-markers':
      return 'instructions:copilot';
    case 'cursor-bare-instruction-markers':
      return 'instructions:cursor';
    case 'bare-instruction-markers':
      // AGENTS.md is shared by several runtimes. Old installs did not retain
      // their writer id, so use only an explicit self-identification; the
      // conservative Codex fallback matches the legacy Codex writer.
      if (/\bopencode\b/i.test(body)) return 'instructions:opencode';
      if (/\bdroid\b/i.test(body)) return 'instructions:droid';
      if (/\bopenclaw\b/i.test(body)) return 'instructions:openclaw';
      if (/\bkimi\b/i.test(body)) return 'instructions:kimi';
      return 'instructions:codex';
    default:
      return undefined;
  }
}

function writeMigratedInstructions(
  root: string,
  surface: LegacySurface,
  original: string,
  beforeWrite: ((path: string) => void) | undefined,
): { changed: boolean; paths: string[] } {
  const extracted = takeLegacyBlock(original);
  if (!extracted) return { changed: false, paths: [] };

  if (surface.id === 'openclaw-config') {
    const target = join(root, 'AGENTS.md');
    const targetContent = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const migrated = mergeManagedBlock(targetContent, 'instructions:openclaw', extracted.body);
    beforeWrite?.(target);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, migrated, 'utf8');
    beforeWrite?.(join(root, surface.path));
    writeFileSync(join(root, surface.path), extracted.remainder, 'utf8');
    return { changed: true, paths: ['AGENTS.md', surface.path] };
  }

  const marker = instructionMarker(surface, extracted.body);
  if (!marker) return { changed: false, paths: [] };

  const migrated = mergeManagedBlock(extracted.remainder, marker, extracted.body);
  beforeWrite?.(join(root, surface.path));
  writeFileSync(join(root, surface.path), migrated, 'utf8');
  return { changed: true, paths: [surface.path] };
}

function isOwnedScript(path: string): boolean {
  try {
    return /monomind|mastermind/i.test(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
}

function removeLegacyCursorHook(content: string): {
  content: string;
  changed: boolean;
  diagnostic?: string;
} {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const hooks = parsed.hooks;
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))
      return { content, changed: false };
    const entries = (hooks as Record<string, unknown>).SessionStart;
    if (!Array.isArray(entries)) return { content, changed: false };
    const retained = entries.filter(
      (entry) => !JSON.stringify(entry).includes('monomind-activate'),
    );
    if (retained.length === entries.length) return { content, changed: false };
    (hooks as Record<string, unknown>).SessionStart = retained;
    return { content: `${JSON.stringify(parsed, null, 2)}\n`, changed: true };
  } catch {
    return {
      content,
      changed: false,
      diagnostic: 'ERROR: cursor legacy settings are malformed; left unchanged',
    };
  }
}

export function migrateLegacyArtifacts(
  root: string,
  scope: 'project' | 'user',
  options: {
    dryRun?: boolean;
    removeLegacy?: boolean;
    /** Called before a verified legacy artifact is changed or removed. */
    beforeWrite?: (path: string) => void;
  } = {},
): LegacyMigrationResult {
  const changed: string[] = [];
  const skipped: string[] = [];
  const diagnostics: string[] = [];

  for (const surface of LEGACY_SURFACE_INVENTORY.filter((item) => item.scope === scope)) {
    const path = join(root, surface.path);
    if (!existsSync(path)) {
      skipped.push(surface.path);
      continue;
    }

    if (surface.id === 'shared-agent-skills' || surface.id === 'shared-gemini-skills') {
      // The current manifest has no consumer-reference record. Preserve the
      // shared root and every package until one exists instead of guessing
      // whether another adapter still owns it.
      skipped.push(surface.path);
      continue;
    }

    if (surface.ownership === 'monomind-file') {
      if (statSync(path).isDirectory()) {
        const manifest = join(path, 'plugin.json');
        if (!existsSync(manifest) || !isOwnedScript(manifest)) {
          skipped.push(surface.path);
          continue;
        }
        if (!options.dryRun) {
          options.beforeWrite?.(path);
          rmSync(path, { recursive: true, force: false });
        }
      } else {
        if (!isOwnedScript(path)) {
          skipped.push(surface.path);
          continue;
        }
        if (!options.dryRun) {
          options.beforeWrite?.(path);
          unlinkSync(path);
        }
      }
      changed.push(surface.path);
      continue;
    }

    const original = readFileSync(path, 'utf8');
    if (!isMonomindOwned(original)) {
      skipped.push(surface.path);
      continue;
    }

    if (surface.id === 'cursor-sessionstart' || surface.id === 'claude-global-sessionstart') {
      const cursor = removeLegacyCursorHook(original);
      if (cursor.diagnostic) diagnostics.push(cursor.diagnostic);
      if (!cursor.changed) {
        skipped.push(surface.path);
        continue;
      }
      if (!options.dryRun) {
        options.beforeWrite?.(path);
        writeFileSync(path, cursor.content, 'utf8');
      }
      changed.push(surface.path);
      continue;
    }

    if (surface.id === 'aider-corrupted-yaml') {
      const next = deCorruptAiderYaml(original);
      if (next === original) {
        skipped.push(surface.path);
        continue;
      }
      if (!options.dryRun) {
        options.beforeWrite?.(path);
        writeFileSync(path, next, 'utf8');
      }
      changed.push(surface.path);
      continue;
    }

    if (surface.action === 'migrate') {
      if (options.dryRun) {
        const extracted = takeLegacyBlock(original);
        if (!extracted) {
          skipped.push(surface.path);
          continue;
        }
        changed.push(surface.path);
        continue;
      }
      const migrated = writeMigratedInstructions(root, surface, original, options.beforeWrite);
      if (!migrated.changed) {
        skipped.push(surface.path);
        continue;
      }
      changed.push(...migrated.paths);
      continue;
    }

    const next = removeLegacyManagedBlocks(original);
    if (next === original) {
      skipped.push(surface.path);
      continue;
    }
    if (!options.dryRun) {
      options.beforeWrite?.(path);
      writeFileSync(path, next, 'utf8');
    }
    changed.push(surface.path);
  }

  return { changed, skipped, diagnostics };
}

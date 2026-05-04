import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type InfraFileKind =
  | 'dockerfile'
  | 'docker-compose'
  | 'procfile'
  | 'fly-toml'
  | 'render-yaml'
  | 'railway-toml'
  | 'heroku-procfile';

export interface InfraEntryPoint {
  filePath: string;
  kind: InfraFileKind;
  discoveredEntries: string[];
}

const JSTS = /\.(js|ts|mjs|cjs)$/;

const STATIC_CANDIDATES: Array<{ filename: string; kind: InfraFileKind }> = [
  { filename: 'Dockerfile', kind: 'dockerfile' },
  { filename: 'Procfile', kind: 'heroku-procfile' },
  { filename: 'fly.toml', kind: 'fly-toml' },
  { filename: 'render.yaml', kind: 'render-yaml' },
  { filename: 'railway.toml', kind: 'railway-toml' },
  { filename: 'docker-compose.yml', kind: 'docker-compose' },
  { filename: 'docker-compose.yaml', kind: 'docker-compose' },
];

const COMMON_SUBDIRS = ['app', 'src', 'backend', 'server', 'api', 'services'];

function safeRead(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function safeLs(dir: string): string[] {
  try {
    return readdirSync(dir) as string[];
  } catch {
    return [];
  }
}

function parseByKind(kind: InfraFileKind, content: string): string[] {
  switch (kind) {
    case 'dockerfile':
      return parseDockerfileEntries(content);
    case 'heroku-procfile':
    case 'procfile':
      return parseProcfileEntries(content);
    case 'docker-compose':
      return parseDockerComposeEntries(content);
    case 'fly-toml':
    case 'render-yaml':
    case 'railway-toml':
      return parseTomlYamlCommandEntries(content);
  }
}

function parseDockerComposeEntries(content: string): string[] {
  const entries: string[] = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('command:') && !t.startsWith('entrypoint:')) continue;
    for (const token of t.split(/\s+/)) {
      if (JSTS.test(token)) entries.push(token);
    }
  }
  return entries;
}

function parseTomlYamlCommandEntries(content: string): string[] {
  const entries: string[] = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!/^(command|entrypoint)\s*[=:]/.test(t)) continue;
    for (const token of t.split(/\s+/)) {
      if (JSTS.test(token)) entries.push(token);
    }
  }
  return entries;
}

function probeDir(dir: string, seen: Set<string>, results: InfraEntryPoint[]): void {
  for (const { filename, kind } of STATIC_CANDIDATES) {
    const filePath = join(dir, filename);
    if (seen.has(filePath) || !existsSync(filePath)) continue;
    seen.add(filePath);
    const content = safeRead(filePath);
    if (content !== null) {
      results.push({ filePath, kind, discoveredEntries: parseByKind(kind, content) });
    }
  }

  for (const entry of safeLs(dir)) {
    if (entry.startsWith('Dockerfile.') || entry.startsWith('dockerfile.')) {
      const filePath = join(dir, entry);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const content = safeRead(filePath);
      if (content !== null) {
        results.push({ filePath, kind: 'dockerfile', discoveredEntries: parseDockerfileEntries(content) });
      }
    }
  }
}

export function detectInfraFiles(projectRoot: string): InfraEntryPoint[] {
  const results: InfraEntryPoint[] = [];
  const seen = new Set<string>();

  probeDir(projectRoot, seen, results);
  for (const sub of COMMON_SUBDIRS) {
    probeDir(join(projectRoot, sub), seen, results);
  }

  return results;
}

export function parseDockerfileEntries(content: string): string[] {
  const entries: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('CMD') && !trimmed.startsWith('ENTRYPOINT')) continue;

    const jsonMatch = trimmed.match(/\[([^\]]+)\]/);
    if (jsonMatch) {
      try {
        const parts = JSON.parse(`[${jsonMatch[1]}]`) as unknown[];
        for (const part of parts) {
          if (typeof part === 'string' && JSTS.test(part)) entries.push(part);
        }
      } catch {
        // malformed JSON array — fall through to shell-form parse below
        const rest = trimmed.replace(/^(CMD|ENTRYPOINT)\s+/, '');
        for (const token of rest.split(/\s+/)) {
          if (JSTS.test(token)) entries.push(token);
        }
      }
      continue;
    }

    const rest = trimmed.replace(/^(CMD|ENTRYPOINT)\s+/, '');
    for (const token of rest.split(/\s+/)) {
      if (JSTS.test(token)) entries.push(token);
    }
  }

  return entries;
}

export function parseProcfileEntries(content: string): string[] {
  const entries: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const command = trimmed.slice(colonIdx + 1).trim();
    for (const token of command.split(/\s+/)) {
      if (JSTS.test(token)) entries.push(token);
    }
  }

  return entries;
}

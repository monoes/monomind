import fs from 'fs';
import path from 'path';
import type { DirectoryScan, FileEntry, CapabilityScore, Fingerprint } from './types.js';

export interface ScanOptions {
  maxDepth?: number;          // default 3
  ignorePatterns?: string[];  // default: node_modules, .git, .monomind
}

const DEFAULT_IGNORE = new Set(['node_modules', '.git', '.monomind', '.claude', '__pycache__', '.venv', 'dist', 'build']);

const CODE_SIGNALS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.rb', '.php', '.swift', '.kt', '.scala', '.cs', '.vue', '.svelte']);
const CODE_MARKERS = new Set(['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Makefile', 'CMakeLists.txt', 'pom.xml', 'build.gradle']);
const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.md', '.txt', '.rtf', '.pages', '.odt', '.rst', '.tex', '.epub']);
const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.heic', '.heif', '.webp', '.svg', '.raw', '.cr2', '.nef', '.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.flac', '.aac', '.ogg']);
const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.jsonl', '.sqlite', '.db', '.parquet', '.xlsx', '.xls']);

function walkDir(dir: string, maxDepth: number, currentDepth: number, ignore: Set<string>, root: string): FileEntry[] {
  if (currentDepth > maxDepth) return [];
  const entries: FileEntry[] = [];

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const dirent of dirents) {
    if (ignore.has(dirent.name) || dirent.name.startsWith('.')) continue;

    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      entries.push(...walkDir(fullPath, maxDepth, currentDepth + 1, ignore, root));
    } else if (dirent.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        entries.push({
          path: path.relative(root, fullPath),
          absolutePath: fullPath,
          extension: path.extname(dirent.name).toLowerCase(),
          size: stat.size,
          modified: stat.mtime,
          created: stat.birthtime,
        });
      } catch {
        // skip unreadable files
      }
    }
  }
  return entries;
}

function computeScore(
  files: FileEntry[],
  totalFiles: number,
  extensions: Set<string>,
  markers: Set<string> | null,
  root: string,
): CapabilityScore {
  const matchingFiles = files.filter(f => extensions.has(f.extension));
  const signals: string[] = [];
  const seenExts = new Set<string>();

  for (const f of matchingFiles) {
    if (!seenExts.has(f.extension)) {
      seenExts.add(f.extension);
      signals.push(f.extension);
    }
  }

  if (markers) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(root, marker))) {
        signals.push(marker);
      }
    }
  }

  const markerBoost = markers ? signals.filter(s => !s.startsWith('.')).length * 0.15 : 0;
  const confidence = totalFiles > 0
    ? Math.min(1, (matchingFiles.length / totalFiles) + markerBoost)
    : 0;

  return { confidence, files: matchingFiles.length, signals };
}

export async function scanDirectory(root: string, options?: ScanOptions): Promise<DirectoryScan> {
  const maxDepth = options?.maxDepth ?? 3;
  const ignore = new Set([...DEFAULT_IGNORE, ...(options?.ignorePatterns ?? [])]);

  const files = walkDir(root, maxDepth, 0, ignore, root);
  const totalFiles = files.length;

  const filesByExtension: Record<string, number> = {};
  for (const f of files) {
    filesByExtension[f.extension] = (filesByExtension[f.extension] ?? 0) + 1;
  }

  const gitExists = fs.existsSync(path.join(root, '.git'));

  const codeScore = computeScore(files, totalFiles, CODE_SIGNALS, CODE_MARKERS, root);
  if (gitExists && !codeScore.signals.includes('.git')) {
    codeScore.signals.push('.git');
    codeScore.confidence = Math.min(1, codeScore.confidence + 0.15);
  }

  return {
    root,
    totalFiles,
    git: gitExists,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: codeScore,
      documents: computeScore(files, totalFiles, DOC_EXTENSIONS, null, root),
      media: computeScore(files, totalFiles, MEDIA_EXTENSIONS, null, root),
      data: computeScore(files, totalFiles, DATA_EXTENSIONS, null, root),
      graph: { confidence: 0, files: 0, signals: [] },   // activated by manager when 2+ caps active
      timeline: { confidence: 0, files: 0, signals: [] }, // activated by manager when 2+ caps active
    },
    filesByExtension,
  };
}

export async function saveFingerprint(scan: DirectoryScan, monomindDir: string): Promise<void> {
  const fp: Fingerprint = { version: 1, ...scan };
  const fpPath = path.join(monomindDir, 'fingerprint.json');
  fs.mkdirSync(monomindDir, { recursive: true });
  fs.writeFileSync(fpPath, JSON.stringify(fp, null, 2));
}

export async function loadFingerprint(monomindDir: string): Promise<Fingerprint | null> {
  const fpPath = path.join(monomindDir, 'fingerprint.json');
  try {
    const raw = fs.readFileSync(fpPath, 'utf-8');
    return JSON.parse(raw) as Fingerprint;
  } catch {
    return null;
  }
}

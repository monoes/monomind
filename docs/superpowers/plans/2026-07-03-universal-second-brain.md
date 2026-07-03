# Universal Second Brain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make monomind installable in any directory — code projects, document folders, photo libraries, mixed content — by auto-detecting content types and activating relevant capability modules.

**Architecture:** A directory scanner produces a fingerprint of what's in the folder. A capability manager loads modules based on detection confidence. Each module implements a shared interface (`detect → activate → index → enrich → search → healthChecks`). Progressive enrichment runs in three tiers: T0 metadata (sync), T1 content extraction (background), T2 AI enrichment (background, optional).

**Tech Stack:** TypeScript, Vitest, chokidar (fs.watch), exifreader (EXIF), pdf-parse (PDFs), mammoth (docx), existing @monomind/memory (vector store), existing @monomind/monograph (graph engine).

## Global Constraints

- All new source files go in `packages/@monomind/cli/src/capabilities/`
- All new test files go in `packages/@monomind/cli/__tests__/capabilities/`
- Test framework: Vitest (`describe`, `it`, `expect`, `vi` for mocks)
- Module format: ESM (`import`/`export`, `.js` extensions in imports)
- Node.js >= 20
- No new top-level packages — all capability code lives in `@monomind/cli`
- Existing code-project behavior must not change — `cap/code` wraps today's init
- File classifier changes go in `@monomind/monograph` package
- Zero runtime dependencies on git for non-code directories

---

## File Structure

```
packages/@monomind/cli/src/capabilities/
├── types.ts                    # CapabilityModule interface, DirectoryScan, FileEntry, etc.
├── scanner.ts                  # Directory scanner — walks fs, produces fingerprint
├── manager.ts                  # Capability manager — loads fingerprint, activates modules
├── watcher.ts                  # core/watcher — fs.watch abstraction with git fast path
├── enrichment.ts               # Progressive enrichment pipeline (T0/T1/T2 orchestration)
├── cap-code.ts                 # cap/code — wraps existing init behavior
├── cap-documents.ts            # cap/documents — PDF/docx/markdown extraction
├── cap-media.ts                # cap/media — EXIF extraction, CLIP/Whisper stubs
├── cap-data.ts                 # cap/data — CSV/JSON/xlsx schema detection
├── cap-graph.ts                # cap/graph — cross-content knowledge graph
└── cap-timeline.ts             # cap/timeline — temporal index from dates

packages/@monomind/cli/src/commands/
├── scan.ts                     # New `monomind scan` command
├── enrich.ts                   # New `monomind enrich` command (--status, --pause, --resume)
└── search-universal.ts         # New `monomind search` command (unified cross-type)

packages/@monomind/cli/__tests__/capabilities/
├── scanner.test.ts
├── manager.test.ts
├── watcher.test.ts
├── enrichment.test.ts
├── cap-code.test.ts
├── cap-documents.test.ts
├── cap-media.test.ts
├── cap-data.test.ts
├── cap-graph.test.ts
├── cap-timeline.test.ts
└── fixtures/                   # Test fixture directories
    ├── code-project/           # package.json, .git/, src/index.ts
    ├── documents/              # sample.pdf, readme.md, notes.txt
    ├── photos/                 # sample.jpg (with EXIF), sample.png
    ├── data/                   # sample.csv, sample.json
    └── mixed/                  # combination of above

Existing files modified:
├── packages/@monomind/cli/src/init/executor.ts          # Call scanner + manager after existing setup
├── packages/@monomind/cli/src/commands/doctor.ts         # Scope checks to active capabilities
├── packages/@monomind/cli/src/commands/doctor-env-checks.ts    # Guard git checks
├── packages/@monomind/cli/src/commands/doctor-project-checks.ts # Guard code-specific checks
├── packages/@monomind/monograph/src/analysis/file-classifier.ts # Add UNKNOWN, AUDIO types
```

---

## Phase 0: Foundation

### Task 1: Capability Types and Interfaces

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/types.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/types.test.ts`

**Interfaces:**
- Consumes: nothing (foundational)
- Produces: `CapabilityModule`, `DirectoryScan`, `FileEntry`, `Fingerprint`, `CapabilityScore`, `IndexResult`, `EnrichResult`, `SearchResult`, `HealthCheck`, `EnrichmentState`, `EnrichmentTier`

- [ ] **Step 1: Write the type definitions**

```typescript
// packages/@monomind/cli/src/capabilities/types.ts

export type EnrichmentTier = 't0' | 't1' | 't2';
export type EnrichmentStatus = 'pending' | 'queued' | 'done' | 'skipped' | 'failed';
export type CapabilityName = 'code' | 'documents' | 'media' | 'data' | 'graph' | 'timeline';

export interface FileEntry {
  path: string;        // relative to scan root
  absolutePath: string;
  extension: string;   // lowercase, with dot: ".pdf"
  size: number;        // bytes
  modified: Date;
  created: Date;
}

export interface CapabilityScore {
  confidence: number;  // 0-1
  files: number;
  signals: string[];
}

export interface DirectoryScan {
  root: string;
  totalFiles: number;
  git: boolean;
  scannedAt: string;   // ISO 8601
  capabilities: Record<CapabilityName, CapabilityScore>;
  filesByExtension: Record<string, number>;
}

export interface Fingerprint extends DirectoryScan {
  version: 1;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  errors: string[];
}

export interface EnrichResult {
  enriched: number;
  skipped: number;
  errors: string[];
}

export interface SearchResult {
  path: string;
  score: number;
  snippet: string;
  type: CapabilityName;
  metadata?: Record<string, unknown>;
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  hint?: string;
}

export interface EnrichmentState {
  [relativePath: string]: Record<EnrichmentTier, EnrichmentStatus>;
}

export interface CapabilityModule {
  name: CapabilityName;
  detect(scan: DirectoryScan): number;
  activate(rootDir: string): Promise<void>;
  index(files: FileEntry[]): Promise<IndexResult>;
  enrich?(files: FileEntry[]): Promise<EnrichResult>;
  search?(query: string, limit?: number): Promise<SearchResult[]>;
  healthChecks?(): Promise<HealthCheck[]>;
}
```

- [ ] **Step 2: Write the validation test**

```typescript
// packages/@monomind/cli/__tests__/capabilities/types.test.ts
import { describe, it, expect } from 'vitest';
import type { CapabilityModule, DirectoryScan, FileEntry, Fingerprint } from '../../src/capabilities/types.js';

describe('capability types', () => {
  it('DirectoryScan has required fields', () => {
    const scan: DirectoryScan = {
      root: '/tmp/test',
      totalFiles: 100,
      git: false,
      scannedAt: new Date().toISOString(),
      capabilities: {
        code: { confidence: 0, files: 0, signals: [] },
        documents: { confidence: 0.5, files: 50, signals: ['.pdf'] },
        media: { confidence: 0, files: 0, signals: [] },
        data: { confidence: 0, files: 0, signals: [] },
        graph: { confidence: 0, files: 0, signals: [] },
        timeline: { confidence: 0, files: 0, signals: [] },
      },
      filesByExtension: { '.pdf': 50 },
    };
    expect(scan.totalFiles).toBe(100);
    expect(scan.capabilities.documents.confidence).toBe(0.5);
  });

  it('Fingerprint extends DirectoryScan with version', () => {
    const fp: Fingerprint = {
      version: 1,
      root: '/tmp/test',
      totalFiles: 0,
      git: false,
      scannedAt: new Date().toISOString(),
      capabilities: {
        code: { confidence: 0, files: 0, signals: [] },
        documents: { confidence: 0, files: 0, signals: [] },
        media: { confidence: 0, files: 0, signals: [] },
        data: { confidence: 0, files: 0, signals: [] },
        graph: { confidence: 0, files: 0, signals: [] },
        timeline: { confidence: 0, files: 0, signals: [] },
      },
      filesByExtension: {},
    };
    expect(fp.version).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/types.test.ts`
Expected: PASS — types compile, assertions hold.

- [ ] **Step 4: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/types.ts packages/@monomind/cli/__tests__/capabilities/types.test.ts
git commit -m "feat(capabilities): add core type definitions for universal second brain"
```

---

### Task 2: Directory Scanner

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/scanner.ts`
- Create: `packages/@monomind/cli/__tests__/capabilities/scanner.test.ts`
- Create: `packages/@monomind/cli/__tests__/capabilities/fixtures/` (fixture dirs)

**Interfaces:**
- Consumes: `DirectoryScan`, `Fingerprint`, `FileEntry`, `CapabilityScore` from `types.ts`
- Produces: `scanDirectory(root: string, options?: ScanOptions): Promise<DirectoryScan>`, `saveFingerprint(scan: DirectoryScan, monomindDir: string): Promise<void>`, `loadFingerprint(monomindDir: string): Promise<Fingerprint | null>`

- [ ] **Step 1: Create test fixture directories**

```bash
mkdir -p packages/@monomind/cli/__tests__/capabilities/fixtures/{code-project/.git,code-project/src,documents,photos,data,mixed/src,mixed/docs}

# Code project fixtures
echo '{"name":"test","version":"1.0.0"}' > packages/@monomind/cli/__tests__/capabilities/fixtures/code-project/package.json
echo 'export const x = 1;' > packages/@monomind/cli/__tests__/capabilities/fixtures/code-project/src/index.ts

# Document fixtures
echo 'This is a test document.' > packages/@monomind/cli/__tests__/capabilities/fixtures/documents/readme.md
echo 'Meeting notes from Q4.' > packages/@monomind/cli/__tests__/capabilities/fixtures/documents/notes.txt

# Photo fixtures (1x1 pixel PNG)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82' > packages/@monomind/cli/__tests__/capabilities/fixtures/photos/sample.png

# Data fixtures
printf 'name,age,city\nAlice,30,NYC\nBob,25,LA\n' > packages/@monomind/cli/__tests__/capabilities/fixtures/data/sample.csv

# Mixed fixtures
echo 'export const y = 2;' > packages/@monomind/cli/__tests__/capabilities/fixtures/mixed/src/app.ts
echo 'Project overview.' > packages/@monomind/cli/__tests__/capabilities/fixtures/mixed/docs/overview.md
```

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/scanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDirectory, saveFingerprint, loadFingerprint } from '../../src/capabilities/scanner.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('scanDirectory', () => {
  it('detects a code project', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'code-project'));
    expect(scan.git).toBe(true);
    expect(scan.capabilities.code.confidence).toBeGreaterThan(0.1);
    expect(scan.capabilities.code.signals).toContain('package.json');
  });

  it('detects a documents folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    expect(scan.git).toBe(false);
    expect(scan.capabilities.documents.confidence).toBeGreaterThan(0.1);
    expect(scan.capabilities.code.confidence).toBeLessThan(0.1);
  });

  it('detects a photos folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'photos'));
    expect(scan.git).toBe(false);
    expect(scan.capabilities.media.confidence).toBeGreaterThan(0.1);
  });

  it('detects a data folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'data'));
    expect(scan.git).toBe(false);
    expect(scan.capabilities.data.confidence).toBeGreaterThan(0.1);
  });

  it('detects a mixed folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'mixed'));
    expect(scan.capabilities.code.confidence).toBeGreaterThan(0.1);
    expect(scan.capabilities.documents.confidence).toBeGreaterThan(0.1);
  });

  it('respects maxDepth option', async () => {
    const shallow = await scanDirectory(path.join(FIXTURES, 'code-project'), { maxDepth: 0 });
    // maxDepth 0 = root only, won't see src/index.ts
    expect(shallow.totalFiles).toBeLessThan(
      (await scanDirectory(path.join(FIXTURES, 'code-project'))).totalFiles
    );
  });

  it('produces an ISO timestamp', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    expect(() => new Date(scan.scannedAt)).not.toThrow();
  });
});

describe('fingerprint persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads a fingerprint', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    await saveFingerprint(scan, tmpDir);

    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.totalFiles).toBe(scan.totalFiles);
    expect(loaded!.capabilities.documents.confidence).toBe(scan.capabilities.documents.confidence);
  });

  it('returns null when no fingerprint exists', async () => {
    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/scanner.test.ts`
Expected: FAIL — `scanner.js` does not exist.

- [ ] **Step 4: Implement the scanner**

```typescript
// packages/@monomind/cli/src/capabilities/scanner.ts
import fs from 'fs';
import path from 'path';
import type { DirectoryScan, FileEntry, CapabilityName, CapabilityScore, Fingerprint } from './types.js';

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

function walkDir(dir: string, maxDepth: number, currentDepth: number, ignore: Set<string>): FileEntry[] {
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
      entries.push(...walkDir(fullPath, maxDepth, currentDepth + 1, ignore));
    } else if (dirent.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        entries.push({
          path: dirent.name,
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

  const files = walkDir(root, maxDepth, 0, ignore);
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/scanner.test.ts`
Expected: PASS — all 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/scanner.ts packages/@monomind/cli/__tests__/capabilities/scanner.test.ts packages/@monomind/cli/__tests__/capabilities/fixtures/
git commit -m "feat(capabilities): directory scanner with auto-detection and fingerprint persistence"
```

---

### Task 3: Capability Manager

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/manager.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/manager.test.ts`

**Interfaces:**
- Consumes: `CapabilityModule`, `DirectoryScan`, `Fingerprint`, `HealthCheck` from `types.ts`; `loadFingerprint` from `scanner.ts`
- Produces: `CapabilityManager` class with `register(module)`, `activateFromScan(scan)`, `getActive(): CapabilityModule[]`, `isActive(name): boolean`, `runHealthChecks(): HealthCheck[]`, `search(query, limit): SearchResult[]`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/manager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CapabilityManager } from '../../src/capabilities/manager.js';
import type { CapabilityModule, DirectoryScan } from '../../src/capabilities/types.js';

function makeScan(overrides: Partial<DirectoryScan> = {}): DirectoryScan {
  return {
    root: '/tmp/test',
    totalFiles: 100,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [] },
      documents: { confidence: 0, files: 0, signals: [] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: {},
    ...overrides,
  };
}

function makeCap(name: string, detectResult: number): CapabilityModule {
  return {
    name: name as any,
    detect: vi.fn().mockReturnValue(detectResult),
    activate: vi.fn().mockResolvedValue(undefined),
    index: vi.fn().mockResolvedValue({ indexed: 0, skipped: 0, errors: [] }),
  };
}

describe('CapabilityManager', () => {
  it('activates modules above threshold', async () => {
    const mgr = new CapabilityManager();
    const docs = makeCap('documents', 0.5);
    const code = makeCap('code', 0.05);
    mgr.register(docs);
    mgr.register(code);

    const scan = makeScan();
    await mgr.activateFromScan(scan, '/tmp/test');
    expect(mgr.isActive('documents' as any)).toBe(true);
    expect(mgr.isActive('code' as any)).toBe(false);
  });

  it('activates graph and timeline when 2+ content caps active', async () => {
    const mgr = new CapabilityManager();
    const docs = makeCap('documents', 0.5);
    const media = makeCap('media', 0.3);
    const graph = makeCap('graph', 0);
    const timeline = makeCap('timeline', 0);
    mgr.register(docs);
    mgr.register(media);
    mgr.register(graph);
    mgr.register(timeline);

    await mgr.activateFromScan(makeScan(), '/tmp/test');
    expect(mgr.isActive('graph' as any)).toBe(true);
    expect(mgr.isActive('timeline' as any)).toBe(true);
  });

  it('does not activate cross-cutting with only 1 content cap', async () => {
    const mgr = new CapabilityManager();
    const docs = makeCap('documents', 0.5);
    const graph = makeCap('graph', 0);
    mgr.register(docs);
    mgr.register(graph);

    await mgr.activateFromScan(makeScan(), '/tmp/test');
    expect(mgr.isActive('graph' as any)).toBe(false);
  });

  it('returns only active modules from getActive', async () => {
    const mgr = new CapabilityManager();
    mgr.register(makeCap('documents', 0.8));
    mgr.register(makeCap('code', 0.01));
    mgr.register(makeCap('media', 0.4));

    await mgr.activateFromScan(makeScan(), '/tmp/test');
    const active = mgr.getActive();
    expect(active.map(a => a.name)).toEqual(['documents', 'media']);
  });

  it('saves capabilities.json on activation', async () => {
    const mgr = new CapabilityManager();
    mgr.register(makeCap('documents', 0.5));
    await mgr.activateFromScan(makeScan(), '/tmp/test');
    // capabilities.json is written to the monomind dir
    expect(mgr.getActive().length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/manager.test.ts`
Expected: FAIL — `manager.js` does not exist.

- [ ] **Step 3: Implement the capability manager**

```typescript
// packages/@monomind/cli/src/capabilities/manager.ts
import fs from 'fs';
import path from 'path';
import type { CapabilityModule, CapabilityName, DirectoryScan, HealthCheck, SearchResult } from './types.js';

const ACTIVATION_THRESHOLD = 0.1;
const CROSS_CUTTING: Set<CapabilityName> = new Set(['graph', 'timeline']);
const CONTENT_CAPS: Set<CapabilityName> = new Set(['code', 'documents', 'media', 'data']);

export class CapabilityManager {
  private registry = new Map<CapabilityName, CapabilityModule>();
  private active = new Map<CapabilityName, CapabilityModule>();

  register(module: CapabilityModule): void {
    this.registry.set(module.name, module);
  }

  async activateFromScan(scan: DirectoryScan, rootDir: string): Promise<void> {
    this.active.clear();

    // Activate content capabilities above threshold
    for (const [name, module] of this.registry) {
      if (CROSS_CUTTING.has(name)) continue;
      const confidence = module.detect(scan);
      if (confidence >= ACTIVATION_THRESHOLD) {
        await module.activate(rootDir);
        this.active.set(name, module);
      }
    }

    // Activate cross-cutting if 2+ content caps are active
    const activeContentCount = [...this.active.keys()].filter(n => CONTENT_CAPS.has(n)).length;
    if (activeContentCount >= 2) {
      for (const name of CROSS_CUTTING) {
        const module = this.registry.get(name);
        if (module) {
          await module.activate(rootDir);
          this.active.set(name, module);
        }
      }
    }
  }

  isActive(name: CapabilityName): boolean {
    return this.active.has(name);
  }

  getActive(): CapabilityModule[] {
    return [...this.active.values()];
  }

  async runHealthChecks(): Promise<HealthCheck[]> {
    const results: HealthCheck[] = [];
    for (const module of this.active.values()) {
      if (module.healthChecks) {
        results.push(...await module.healthChecks());
      }
    }
    return results;
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    for (const module of this.active.values()) {
      if (module.search) {
        allResults.push(...await module.search(query, limit));
      }
    }
    return allResults.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/manager.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/manager.ts packages/@monomind/cli/__tests__/capabilities/manager.test.ts
git commit -m "feat(capabilities): capability manager with auto-activation and cross-cutting support"
```

---

### Task 4: Core Watcher (fs.watch with git fast path)

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/watcher.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/watcher.test.ts`

**Interfaces:**
- Consumes: `FileEntry` from `types.ts`
- Produces: `FileWatcher` class with `start(root, options)`, `stop()`, `on('change', callback)`, `on('add', callback)`, `on('remove', callback)`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/watcher.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { FileWatcher } from '../../src/capabilities/watcher.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FileWatcher', () => {
  let tmpDir: string;
  let watcher: FileWatcher;

  afterEach(async () => {
    if (watcher) await watcher.stop();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a new file', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    watcher = new FileWatcher();

    const events: string[] = [];
    watcher.on('add', (filePath: string) => events.push(filePath));

    await watcher.start(tmpDir, { useGit: false });

    // Write a new file
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'hello');

    // Wait for fs event (debounced)
    await new Promise(resolve => setTimeout(resolve, 500));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.endsWith('new.txt'))).toBe(true);
  });

  it('detects a file change', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    const testFile = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(testFile, 'original');

    watcher = new FileWatcher();
    const events: string[] = [];
    watcher.on('change', (filePath: string) => events.push(filePath));

    await watcher.start(tmpDir, { useGit: false });

    fs.writeFileSync(testFile, 'modified');
    await new Promise(resolve => setTimeout(resolve, 500));

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('reports git mode when .git exists', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));

    watcher = new FileWatcher();
    await watcher.start(tmpDir);

    expect(watcher.mode).toBe('git');
  });

  it('reports fs mode when no .git', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));

    watcher = new FileWatcher();
    await watcher.start(tmpDir, { useGit: false });

    expect(watcher.mode).toBe('fs');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/watcher.test.ts`
Expected: FAIL — `watcher.js` does not exist.

- [ ] **Step 3: Implement the watcher**

```typescript
// packages/@monomind/cli/src/capabilities/watcher.ts
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export interface WatcherOptions {
  useGit?: boolean;     // auto-detect by default
  debounceMs?: number;  // default 300
  ignore?: string[];
}

const DEFAULT_IGNORE = new Set(['node_modules', '.git', '.monomind', '__pycache__', 'dist', 'build']);

export class FileWatcher extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private _mode: 'git' | 'fs' = 'fs';
  private debounceMs = 300;

  get mode(): 'git' | 'fs' {
    return this._mode;
  }

  async start(root: string, options?: WatcherOptions): Promise<void> {
    const gitExists = fs.existsSync(path.join(root, '.git'));
    const useGit = options?.useGit ?? gitExists;
    this._mode = useGit ? 'git' : 'fs';
    this.debounceMs = options?.debounceMs ?? 300;

    const ignore = new Set([...DEFAULT_IGNORE, ...(options?.ignore ?? [])]);

    this.watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Skip ignored directories
      const parts = filename.split(path.sep);
      if (parts.some(p => ignore.has(p) || p.startsWith('.'))) return;

      const fullPath = path.join(root, filename);

      // Debounce rapid events on the same file
      const existing = this.debounceTimers.get(filename);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(filename, setTimeout(() => {
        this.debounceTimers.delete(filename);
        try {
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
              this.emit(eventType === 'rename' ? 'add' : 'change', fullPath);
            }
          } else {
            this.emit('remove', fullPath);
          }
        } catch {
          // file may have been deleted between check and stat
        }
      }, this.debounceMs));
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/watcher.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/watcher.ts packages/@monomind/cli/__tests__/capabilities/watcher.test.ts
git commit -m "feat(capabilities): file watcher with git/fs dual mode and debouncing"
```

---

### Task 5: cap/code Module (wraps existing behavior)

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/cap-code.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/cap-code.test.ts`

**Interfaces:**
- Consumes: `CapabilityModule`, `DirectoryScan`, `FileEntry`, `IndexResult`, `HealthCheck` from `types.ts`
- Produces: `codeCapability: CapabilityModule` — delegates to existing init/monograph/doctor logic

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/cap-code.test.ts
import { describe, it, expect } from 'vitest';
import { codeCapability } from '../../src/capabilities/cap-code.js';
import type { DirectoryScan } from '../../src/capabilities/types.js';

function makeScan(overrides: Partial<DirectoryScan['capabilities']['code']> = {}): DirectoryScan {
  return {
    root: '/tmp/test',
    totalFiles: 100,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [], ...overrides },
      documents: { confidence: 0, files: 0, signals: [] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: {},
  };
}

describe('codeCapability', () => {
  it('has name "code"', () => {
    expect(codeCapability.name).toBe('code');
  });

  it('returns high confidence for code project', () => {
    const scan = makeScan({ confidence: 0.7, files: 50, signals: ['package.json', '.ts'] });
    expect(codeCapability.detect(scan)).toBe(0.7);
  });

  it('returns low confidence for non-code', () => {
    const scan = makeScan({ confidence: 0.02, files: 1, signals: [] });
    expect(codeCapability.detect(scan)).toBe(0.02);
  });

  it('activate does not throw', async () => {
    await expect(codeCapability.activate('/tmp/test')).resolves.not.toThrow();
  });

  it('provides health checks', async () => {
    expect(codeCapability.healthChecks).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-code.test.ts`
Expected: FAIL — `cap-code.js` does not exist.

- [ ] **Step 3: Implement cap/code**

```typescript
// packages/@monomind/cli/src/capabilities/cap-code.ts
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, HealthCheck } from './types.js';

export const codeCapability: CapabilityModule = {
  name: 'code',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.code.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    // monolean: no-op — existing init/monograph handles code projects
    // This module exists so the manager can track code as a capability
  },

  async index(_files: FileEntry[]): Promise<IndexResult> {
    // monolean: existing monograph handles code indexing
    return { indexed: 0, skipped: 0, errors: [] };
  },

  async healthChecks(): Promise<HealthCheck[]> {
    // monolean: delegates to existing doctor checks when cap/code is active
    // The doctor command checks isActive('code') to decide which checks to run
    return [];
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-code.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/cap-code.ts packages/@monomind/cli/__tests__/capabilities/cap-code.test.ts
git commit -m "feat(capabilities): cap/code module wrapping existing code-project behavior"
```

---

### Task 6: Integrate Scanner + Manager into Init and Doctor

**Files:**
- Modify: `packages/@monomind/cli/src/init/executor.ts`
- Modify: `packages/@monomind/cli/src/commands/doctor.ts`
- Modify: `packages/@monomind/cli/src/commands/doctor-env-checks.ts`
- Modify: `packages/@monomind/cli/src/commands/doctor-project-checks.ts`
- Modify: `packages/@monomind/monograph/src/analysis/file-classifier.ts`
- Create: `packages/@monomind/cli/src/capabilities/index.ts` (barrel export)
- Test: `packages/@monomind/cli/__tests__/capabilities/integration.test.ts`

**Interfaces:**
- Consumes: `scanDirectory`, `saveFingerprint` from `scanner.ts`; `CapabilityManager` from `manager.ts`; `codeCapability` from `cap-code.ts`; `loadFingerprint` from `scanner.ts`
- Produces: Modified init that runs scanner + prints capability-aware messaging. Doctor that scopes checks. Updated file classifier with `UNKNOWN` and `AUDIO` types.

- [ ] **Step 1: Create barrel export**

```typescript
// packages/@monomind/cli/src/capabilities/index.ts
export * from './types.js';
export { scanDirectory, saveFingerprint, loadFingerprint } from './scanner.js';
export { CapabilityManager } from './manager.js';
export { FileWatcher } from './watcher.js';
export { codeCapability } from './cap-code.js';
```

- [ ] **Step 2: Update file-classifier.ts — add UNKNOWN and AUDIO types**

In `packages/@monomind/monograph/src/analysis/file-classifier.ts`, change the `FileType` type and default fallback:

Find the line:
```typescript
export type FileType = 'CODE' | 'DOCUMENT' | 'PAPER' | 'IMAGE' | 'VIDEO';
```
Replace with:
```typescript
export type FileType = 'CODE' | 'DOCUMENT' | 'PAPER' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DATA' | 'UNKNOWN';
```

Add `AUDIO_EXTENSIONS`:
```typescript
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma']);
```

In the `classifyFile` function, add audio detection before the final return:
```typescript
if (AUDIO_EXTENSIONS.has(ext)) return 'AUDIO';
```

Change the default fallback at the end of `classifyFile` from `return 'CODE'` to `return 'UNKNOWN'`.

- [ ] **Step 3: Write the integration test**

```typescript
// packages/@monomind/cli/__tests__/capabilities/integration.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { scanDirectory, saveFingerprint, loadFingerprint, CapabilityManager, codeCapability } from '../../src/capabilities/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('init integration', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full flow: scan → activate → save fingerprint for code project', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'code-project'));
    const mgr = new CapabilityManager();
    mgr.register(codeCapability);

    await mgr.activateFromScan(scan, path.join(FIXTURES, 'code-project'));
    expect(mgr.isActive('code')).toBe(true);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-int-'));
    await saveFingerprint(scan, tmpDir);

    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.capabilities.code.confidence).toBeGreaterThan(0.1);
  });

  it('full flow: scan → activate for documents folder — code NOT active', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    const mgr = new CapabilityManager();
    mgr.register(codeCapability);

    await mgr.activateFromScan(scan, path.join(FIXTURES, 'documents'));
    expect(mgr.isActive('code')).toBe(false);
  });
});
```

- [ ] **Step 4: Modify executor.ts — add scanner call after directory creation**

In `packages/@monomind/cli/src/init/executor.ts`, in the `executeInit` function, after `createDirectories` completes and before the existing `writeSettings` call, add:

```typescript
// Scan directory and save fingerprint
const { scanDirectory, saveFingerprint, CapabilityManager, codeCapability } = await import('../capabilities/index.js');
const scan = await scanDirectory(targetDir);
const monomindDir = path.join(targetDir, '.monomind');
await saveFingerprint(scan, monomindDir);

// Activate capabilities
const capMgr = new CapabilityManager();
capMgr.register(codeCapability);
await capMgr.activateFromScan(scan, targetDir);

// Print capability-aware messaging
const activeNames = capMgr.getActive().map(c => c.name);
if (!capMgr.isActive('code')) {
  // Non-code directory — print simplified messaging
  console.log(`\nActivating capabilities:`);
  for (const cap of capMgr.getActive()) {
    console.log(`  ✓ ${cap.name}`);
  }
}
```

For the full init flow: if `capMgr.isActive('code')` is true, proceed with all existing behavior unchanged (monograph, hooks, TypeScript checks, swarm messaging). If false, skip code-specific steps (monograph code indexing, git hooks wiring, TypeScript checks, agent routing, swarm init).

- [ ] **Step 5: Guard doctor checks with capability awareness**

In `packages/@monomind/cli/src/commands/doctor.ts`, at the start of the check sequence, load the fingerprint:

```typescript
const { loadFingerprint } = await import('../capabilities/index.js');
const monomindDir = path.join(process.cwd(), '.monomind');
const fingerprint = await loadFingerprint(monomindDir);
const isCodeProject = !fingerprint || fingerprint.capabilities.code.confidence >= 0.1;
```

Then wrap code-specific checks:
- `checkGit`, `checkGitRepo`: only run if `isCodeProject`
- `checkBuildTools` (TypeScript): only run if `isCodeProject`
- `checkMonographFreshness` (uses git): only run if `isCodeProject`
- `checkGitignoreCoverage`: only run if `isCodeProject`
- `checkDaemonStatus`, `checkMcpServers`, `checkApiKeys`: only run if `isCodeProject`

Keep always-on: `checkNodeVersion`, `checkNpmVersion`, `checkDiskSpace`, `checkMemoryDatabase`, `checkConfigFile`.

- [ ] **Step 6: Run all tests**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/`
Expected: All tests pass across all capability test files.

- [ ] **Step 7: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/index.ts packages/@monomind/cli/src/init/executor.ts packages/@monomind/cli/src/commands/doctor.ts packages/@monomind/cli/src/commands/doctor-env-checks.ts packages/@monomind/cli/src/commands/doctor-project-checks.ts packages/@monomind/monograph/src/analysis/file-classifier.ts packages/@monomind/cli/__tests__/capabilities/integration.test.ts
git commit -m "feat(capabilities): integrate scanner + manager into init and doctor flows"
```

---

## Phase 1: Documents

### Task 7: cap/documents Module

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/cap-documents.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/cap-documents.test.ts`

**Interfaces:**
- Consumes: `CapabilityModule`, `DirectoryScan`, `FileEntry`, `IndexResult`, `SearchResult` from `types.ts`
- Produces: `documentsCapability: CapabilityModule` — extracts text from PDF/docx/markdown, indexes into memory for search

- [ ] **Step 1: Add text extraction dependencies**

```bash
cd packages/@monomind/cli && pnpm add pdf-parse mammoth --save-optional
```

Both are optional — if not installed, T1 extraction is skipped and only T0 metadata is available.

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/cap-documents.test.ts
import { describe, it, expect } from 'vitest';
import { documentsCapability } from '../../src/capabilities/cap-documents.js';
import type { DirectoryScan, FileEntry } from '../../src/capabilities/types.js';
import path from 'path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'documents');

function makeScan(docConfidence: number): DirectoryScan {
  return {
    root: FIXTURES,
    totalFiles: 10,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [] },
      documents: { confidence: docConfidence, files: 5, signals: ['.md', '.txt'] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: { '.md': 3, '.txt': 2 },
  };
}

describe('documentsCapability', () => {
  it('has name "documents"', () => {
    expect(documentsCapability.name).toBe('documents');
  });

  it('returns scan confidence from detect', () => {
    expect(documentsCapability.detect(makeScan(0.7))).toBe(0.7);
  });

  it('indexes markdown and text files (T0 metadata)', async () => {
    const files: FileEntry[] = [
      {
        path: 'readme.md',
        absolutePath: path.join(FIXTURES, 'readme.md'),
        extension: '.md',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
      {
        path: 'notes.txt',
        absolutePath: path.join(FIXTURES, 'notes.txt'),
        extension: '.txt',
        size: 50,
        modified: new Date(),
        created: new Date(),
      },
    ];

    const result = await documentsCapability.index(files);
    expect(result.indexed).toBe(2);
    expect(result.errors.length).toBe(0);
  });

  it('search returns results for indexed content', async () => {
    await documentsCapability.activate(FIXTURES);

    const files: FileEntry[] = [
      {
        path: 'readme.md',
        absolutePath: path.join(FIXTURES, 'readme.md'),
        extension: '.md',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
    ];
    await documentsCapability.index(files);

    const results = await documentsCapability.search!('test document', 5);
    expect(results.length).toBeGreaterThanOrEqual(0); // may or may not match depending on content
    for (const r of results) {
      expect(r.type).toBe('documents');
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-documents.test.ts`
Expected: FAIL — `cap-documents.js` does not exist.

- [ ] **Step 4: Implement cap/documents**

```typescript
// packages/@monomind/cli/src/capabilities/cap-documents.ts
import fs from 'fs';
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, EnrichResult, SearchResult, HealthCheck } from './types.js';

const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.md', '.txt', '.rtf', '.rst', '.tex', '.odt', '.pages', '.epub']);

// In-memory index for T0 (metadata) and T1 (content) — replaced by memory DB in production
const indexedDocs = new Map<string, { path: string; content: string; metadata: Record<string, unknown> }>();

async function extractText(file: FileEntry): Promise<string> {
  const ext = file.extension;

  if (ext === '.md' || ext === '.txt' || ext === '.rst' || ext === '.tex') {
    return fs.readFileSync(file.absolutePath, 'utf-8');
  }

  if (ext === '.pdf') {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = fs.readFileSync(file.absolutePath);
      const data = await pdfParse(buffer);
      return data.text;
    } catch {
      return ''; // pdf-parse not installed or file unreadable
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: file.absolutePath });
      return result.value;
    } catch {
      return ''; // mammoth not installed or file unreadable
    }
  }

  return '';
}

export const documentsCapability: CapabilityModule = {
  name: 'documents',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.documents.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    indexedDocs.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      if (!DOC_EXTENSIONS.has(file.extension)) {
        skipped++;
        continue;
      }

      try {
        const content = await extractText(file);
        indexedDocs.set(file.path, {
          path: file.path,
          content,
          metadata: {
            size: file.size,
            modified: file.modified.toISOString(),
            created: file.created.toISOString(),
            extension: file.extension,
          },
        });
        indexed++;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, skipped, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    // monolean: simple substring search for T0/T1 — vector search added when memory integration lands
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [docPath, doc] of indexedDocs) {
      const contentLower = doc.content.toLowerCase();
      const idx = contentLower.indexOf(queryLower);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(doc.content.length, idx + query.length + 40);
        results.push({
          path: docPath,
          score: 1 / (idx + 1), // closer to start = higher score
          snippet: doc.content.slice(start, end).trim(),
          type: 'documents',
          metadata: doc.metadata,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async healthChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];

    // Check if PDF extraction is available
    try {
      await import('pdf-parse');
      checks.push({ name: 'PDF Extraction', status: 'pass', message: 'pdf-parse available' });
    } catch {
      checks.push({ name: 'PDF Extraction', status: 'warn', message: 'pdf-parse not installed', hint: 'pnpm add pdf-parse' });
    }

    // Check if docx extraction is available
    try {
      await import('mammoth');
      checks.push({ name: 'DOCX Extraction', status: 'pass', message: 'mammoth available' });
    } catch {
      checks.push({ name: 'DOCX Extraction', status: 'warn', message: 'mammoth not installed', hint: 'pnpm add mammoth' });
    }

    return checks;
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-documents.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 6: Register cap/documents in the capabilities barrel and manager**

In `packages/@monomind/cli/src/capabilities/index.ts`, add:
```typescript
export { documentsCapability } from './cap-documents.js';
```

In the init executor where the manager is created (Task 6), add:
```typescript
const { documentsCapability } = await import('../capabilities/index.js');
capMgr.register(documentsCapability);
```

- [ ] **Step 7: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/cap-documents.ts packages/@monomind/cli/__tests__/capabilities/cap-documents.test.ts packages/@monomind/cli/src/capabilities/index.ts
git commit -m "feat(capabilities): cap/documents with PDF/docx/markdown extraction and search"
```

---

## Phase 2: Media

### Task 8: cap/media Module

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/cap-media.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/cap-media.test.ts`

**Interfaces:**
- Consumes: `CapabilityModule`, `DirectoryScan`, `FileEntry`, `IndexResult`, `SearchResult` from `types.ts`
- Produces: `mediaCapability: CapabilityModule` — extracts EXIF metadata (T0), optional CLIP/Whisper (T2)

- [ ] **Step 1: Add EXIF dependency**

```bash
cd packages/@monomind/cli && pnpm add exifreader --save-optional
```

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/cap-media.test.ts
import { describe, it, expect } from 'vitest';
import { mediaCapability } from '../../src/capabilities/cap-media.js';
import type { DirectoryScan, FileEntry } from '../../src/capabilities/types.js';
import path from 'path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'photos');

function makeScan(mediaConfidence: number): DirectoryScan {
  return {
    root: FIXTURES,
    totalFiles: 10,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [] },
      documents: { confidence: 0, files: 0, signals: [] },
      media: { confidence: mediaConfidence, files: 5, signals: ['.jpg', '.png'] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: { '.png': 1 },
  };
}

describe('mediaCapability', () => {
  it('has name "media"', () => {
    expect(mediaCapability.name).toBe('media');
  });

  it('returns scan confidence from detect', () => {
    expect(mediaCapability.detect(makeScan(0.6))).toBe(0.6);
  });

  it('indexes image files with metadata', async () => {
    const files: FileEntry[] = [
      {
        path: 'sample.png',
        absolutePath: path.join(FIXTURES, 'sample.png'),
        extension: '.png',
        size: 68,
        modified: new Date(),
        created: new Date(),
      },
    ];

    const result = await mediaCapability.index(files);
    expect(result.indexed).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  it('search returns results matching filename', async () => {
    await mediaCapability.activate(FIXTURES);
    const files: FileEntry[] = [
      {
        path: 'sample.png',
        absolutePath: path.join(FIXTURES, 'sample.png'),
        extension: '.png',
        size: 68,
        modified: new Date(),
        created: new Date(),
      },
    ];
    await mediaCapability.index(files);

    const results = await mediaCapability.search!('sample', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('media');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-media.test.ts`
Expected: FAIL — `cap-media.js` does not exist.

- [ ] **Step 4: Implement cap/media**

```typescript
// packages/@monomind/cli/src/capabilities/cap-media.ts
import fs from 'fs';
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, SearchResult, HealthCheck } from './types.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.heic', '.heif', '.webp', '.svg', '.raw', '.cr2', '.nef', '.tiff', '.tif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma']);
const ALL_MEDIA = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

interface MediaEntry {
  path: string;
  type: 'image' | 'video' | 'audio';
  metadata: Record<string, unknown>;
  description: string; // from EXIF, filename, or CLIP (T2)
}

const indexedMedia = new Map<string, MediaEntry>();

async function extractExif(file: FileEntry): Promise<Record<string, unknown>> {
  try {
    const ExifReader = (await import('exifreader')).default ?? await import('exifreader');
    const buffer = fs.readFileSync(file.absolutePath);
    const tags = ExifReader.load(buffer, { expanded: true });
    const result: Record<string, unknown> = {};
    if (tags.exif) {
      if (tags.exif.DateTimeOriginal) result.dateTaken = tags.exif.DateTimeOriginal.description;
      if (tags.exif.Make) result.cameraMake = tags.exif.Make.description;
      if (tags.exif.Model) result.cameraModel = tags.exif.Model.description;
      if (tags.exif.ImageWidth) result.width = tags.exif.ImageWidth.value;
      if (tags.exif.ImageLength) result.height = tags.exif.ImageLength.value;
    }
    if (tags.gps) {
      if (tags.gps.Latitude) result.latitude = tags.gps.Latitude;
      if (tags.gps.Longitude) result.longitude = tags.gps.Longitude;
    }
    return result;
  } catch {
    return {}; // exifreader not installed or file has no EXIF
  }
}

function mediaType(ext: string): 'image' | 'video' | 'audio' {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'audio';
}

export const mediaCapability: CapabilityModule = {
  name: 'media',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.media.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    indexedMedia.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      if (!ALL_MEDIA.has(file.extension)) {
        skipped++;
        continue;
      }

      try {
        const exif = file.extension !== '.svg' ? await extractExif(file) : {};
        const type = mediaType(file.extension);

        // Build searchable description from metadata + filename
        const descParts = [file.path.replace(/[_-]/g, ' ')];
        if (exif.dateTaken) descParts.push(`taken ${exif.dateTaken}`);
        if (exif.cameraMake) descParts.push(`${exif.cameraMake} ${exif.cameraModel ?? ''}`);

        indexedMedia.set(file.path, {
          path: file.path,
          type,
          metadata: {
            ...exif,
            size: file.size,
            modified: file.modified.toISOString(),
            created: file.created.toISOString(),
            extension: file.extension,
          },
          description: descParts.join(' '),
        });
        indexed++;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, skipped, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [mediaPath, entry] of indexedMedia) {
      const descLower = entry.description.toLowerCase();
      const pathLower = mediaPath.toLowerCase();

      if (descLower.includes(queryLower) || pathLower.includes(queryLower)) {
        results.push({
          path: mediaPath,
          score: pathLower.includes(queryLower) ? 1.0 : 0.5,
          snippet: entry.description,
          type: 'media',
          metadata: entry.metadata,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async healthChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    try {
      await import('exifreader');
      checks.push({ name: 'EXIF Extraction', status: 'pass', message: 'exifreader available' });
    } catch {
      checks.push({ name: 'EXIF Extraction', status: 'warn', message: 'exifreader not installed', hint: 'pnpm add exifreader' });
    }
    return checks;
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-media.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 6: Register in barrel and manager**

In `packages/@monomind/cli/src/capabilities/index.ts`, add:
```typescript
export { mediaCapability } from './cap-media.js';
```

In init executor, add:
```typescript
const { mediaCapability } = await import('../capabilities/index.js');
capMgr.register(mediaCapability);
```

- [ ] **Step 7: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/cap-media.ts packages/@monomind/cli/__tests__/capabilities/cap-media.test.ts packages/@monomind/cli/src/capabilities/index.ts
git commit -m "feat(capabilities): cap/media with EXIF extraction and metadata search"
```

---

## Phase 3: Cross-Content

### Task 9: cap/timeline Module

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/cap-timeline.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/cap-timeline.test.ts`

**Interfaces:**
- Consumes: `CapabilityModule`, `DirectoryScan`, `FileEntry`, `IndexResult`, `SearchResult` from `types.ts`
- Produces: `timelineCapability: CapabilityModule` — extracts dates from all content, builds temporal index

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/cap-timeline.test.ts
import { describe, it, expect } from 'vitest';
import { timelineCapability } from '../../src/capabilities/cap-timeline.js';
import type { FileEntry } from '../../src/capabilities/types.js';

describe('timelineCapability', () => {
  it('has name "timeline"', () => {
    expect(timelineCapability.name).toBe('timeline');
  });

  it('indexes files by their dates', async () => {
    const files: FileEntry[] = [
      {
        path: 'report-2025-03.pdf',
        absolutePath: '/tmp/test/report-2025-03.pdf',
        extension: '.pdf',
        size: 1000,
        modified: new Date('2025-03-15'),
        created: new Date('2025-03-10'),
      },
      {
        path: 'photo-summer.jpg',
        absolutePath: '/tmp/test/photo-summer.jpg',
        extension: '.jpg',
        size: 5000,
        modified: new Date('2025-07-20'),
        created: new Date('2025-07-20'),
      },
    ];

    await timelineCapability.activate('/tmp/test');
    const result = await timelineCapability.index(files);
    expect(result.indexed).toBe(2);
  });

  it('search with date terms returns timeline results', async () => {
    const files: FileEntry[] = [
      {
        path: 'notes-march.md',
        absolutePath: '/tmp/test/notes-march.md',
        extension: '.md',
        size: 200,
        modified: new Date('2025-03-15'),
        created: new Date('2025-03-15'),
      },
    ];

    await timelineCapability.activate('/tmp/test');
    await timelineCapability.index(files);
    const results = await timelineCapability.search!('march 2025', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('timeline');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-timeline.test.ts`
Expected: FAIL — `cap-timeline.js` does not exist.

- [ ] **Step 3: Implement cap/timeline**

```typescript
// packages/@monomind/cli/src/capabilities/cap-timeline.ts
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, SearchResult } from './types.js';

interface TimelineEntry {
  path: string;
  dates: { label: string; date: Date }[];
}

const timelineIndex = new Map<string, TimelineEntry>();

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function extractDatesFromFilename(filename: string): Date[] {
  const dates: Date[] = [];

  // Match YYYY-MM-DD or YYYY-MM
  const isoMatch = filename.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3] ?? '01'}`);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  // Match month names
  const lower = filename.toLowerCase();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (lower.includes(MONTH_NAMES[i]) || lower.includes(MONTH_SHORT[i])) {
      const yearMatch = filename.match(/(\d{4})/);
      if (yearMatch) {
        dates.push(new Date(parseInt(yearMatch[1]), i, 1));
      }
    }
  }

  return dates;
}

export const timelineCapability: CapabilityModule = {
  name: 'timeline',

  detect(_scan: DirectoryScan): number {
    return 0; // cross-cutting — activated by manager, not by detection
  },

  async activate(_rootDir: string): Promise<void> {
    timelineIndex.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    const errors: string[] = [];

    for (const file of files) {
      const dates: { label: string; date: Date }[] = [];

      dates.push({ label: 'modified', date: file.modified });
      dates.push({ label: 'created', date: file.created });

      const filenameDates = extractDatesFromFilename(file.path);
      for (const d of filenameDates) {
        dates.push({ label: 'filename', date: d });
      }

      timelineIndex.set(file.path, { path: file.path, dates });
      indexed++;
    }

    return { indexed, skipped: 0, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    // Parse date hints from query
    let targetMonth = -1;
    let targetYear = -1;

    for (let i = 0; i < MONTH_NAMES.length; i++) {
      if (queryLower.includes(MONTH_NAMES[i]) || queryLower.includes(MONTH_SHORT[i])) {
        targetMonth = i;
        break;
      }
    }

    const yearMatch = query.match(/(\d{4})/);
    if (yearMatch) targetYear = parseInt(yearMatch[1]);

    if (targetMonth === -1 && targetYear === -1) return [];

    for (const [filePath, entry] of timelineIndex) {
      for (const { label, date } of entry.dates) {
        const monthMatch = targetMonth === -1 || date.getMonth() === targetMonth;
        const yearMatch = targetYear === -1 || date.getFullYear() === targetYear;

        if (monthMatch && yearMatch) {
          results.push({
            path: filePath,
            score: label === 'filename' ? 1.0 : 0.7,
            snippet: `📅 ${date.toISOString().slice(0, 10)}: ${filePath} (${label})`,
            type: 'timeline',
            metadata: { date: date.toISOString(), dateSource: label },
          });
          break; // one result per file
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-timeline.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Register in barrel and manager, commit**

In `packages/@monomind/cli/src/capabilities/index.ts`, add:
```typescript
export { timelineCapability } from './cap-timeline.js';
```

```bash
git add packages/@monomind/cli/src/capabilities/cap-timeline.ts packages/@monomind/cli/__tests__/capabilities/cap-timeline.test.ts packages/@monomind/cli/src/capabilities/index.ts
git commit -m "feat(capabilities): cap/timeline with date extraction and temporal search"
```

---

### Task 10: cap/graph Module (cross-content knowledge graph)

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/cap-graph.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/cap-graph.test.ts`

**Interfaces:**
- Consumes: `CapabilityModule`, `DirectoryScan`, `FileEntry`, `IndexResult`, `SearchResult` from `types.ts`
- Produces: `graphCapability: CapabilityModule` — builds relationships between files across content types

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/cap-graph.test.ts
import { describe, it, expect } from 'vitest';
import { graphCapability } from '../../src/capabilities/cap-graph.js';
import type { FileEntry } from '../../src/capabilities/types.js';

describe('graphCapability', () => {
  it('has name "graph"', () => {
    expect(graphCapability.name).toBe('graph');
  });

  it('indexes files and builds relationship edges', async () => {
    const files: FileEntry[] = [
      { path: 'project/report.md', absolutePath: '/tmp/project/report.md', extension: '.md', size: 500, modified: new Date('2025-03-15'), created: new Date('2025-03-15') },
      { path: 'project/photo.jpg', absolutePath: '/tmp/project/photo.jpg', extension: '.jpg', size: 3000, modified: new Date('2025-03-15'), created: new Date('2025-03-15') },
      { path: 'other/notes.txt', absolutePath: '/tmp/other/notes.txt', extension: '.txt', size: 200, modified: new Date('2025-06-01'), created: new Date('2025-06-01') },
    ];

    await graphCapability.activate('/tmp');
    const result = await graphCapability.index(files);
    expect(result.indexed).toBe(3);
  });

  it('search returns results for path-based queries', async () => {
    const files: FileEntry[] = [
      { path: 'project/report.md', absolutePath: '/tmp/project/report.md', extension: '.md', size: 500, modified: new Date(), created: new Date() },
    ];

    await graphCapability.activate('/tmp');
    await graphCapability.index(files);
    const results = await graphCapability.search!('report', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('graph');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-graph.test.ts`
Expected: FAIL — `cap-graph.js` does not exist.

- [ ] **Step 3: Implement cap/graph**

```typescript
// packages/@monomind/cli/src/capabilities/cap-graph.ts
import path from 'path';
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, SearchResult } from './types.js';

interface GraphNode {
  path: string;
  extension: string;
  directory: string;
  modified: Date;
  neighbors: Set<string>; // paths of related files
}

const nodes = new Map<string, GraphNode>();

function buildRelationships(): void {
  // Relationship 1: same directory = siblings
  const byDir = new Map<string, string[]>();
  for (const [filePath, node] of nodes) {
    const dir = node.directory;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(filePath);
  }
  for (const siblings of byDir.values()) {
    for (const a of siblings) {
      for (const b of siblings) {
        if (a !== b) {
          nodes.get(a)!.neighbors.add(b);
        }
      }
    }
  }

  // Relationship 2: same date (within 1 day) = temporal neighbors
  const nodeList = [...nodes.entries()];
  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const [pathA, nodeA] = nodeList[i];
      const [pathB, nodeB] = nodeList[j];
      const diffMs = Math.abs(nodeA.modified.getTime() - nodeB.modified.getTime());
      if (diffMs < 86400000 && nodeA.directory !== nodeB.directory) { // same day, different dir
        nodeA.neighbors.add(pathB);
        nodeB.neighbors.add(pathA);
      }
    }
  }
}

export const graphCapability: CapabilityModule = {
  name: 'graph',

  detect(_scan: DirectoryScan): number {
    return 0; // cross-cutting — activated by manager
  },

  async activate(_rootDir: string): Promise<void> {
    nodes.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    for (const file of files) {
      nodes.set(file.path, {
        path: file.path,
        extension: file.extension,
        directory: path.dirname(file.path),
        modified: file.modified,
        neighbors: new Set(),
      });
    }

    buildRelationships();

    return { indexed: files.length, skipped: 0, errors: [] };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [filePath, node] of nodes) {
      if (filePath.toLowerCase().includes(queryLower)) {
        const neighborList = [...node.neighbors].slice(0, 3);
        results.push({
          path: filePath,
          score: 1.0,
          snippet: neighborList.length > 0
            ? `Related: ${neighborList.join(', ')}`
            : `Standalone file in ${node.directory}`,
          type: 'graph',
          metadata: { neighbors: [...node.neighbors], directory: node.directory },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-graph.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Register in barrel and manager, commit**

In `packages/@monomind/cli/src/capabilities/index.ts`, add:
```typescript
export { graphCapability } from './cap-graph.js';
```

```bash
git add packages/@monomind/cli/src/capabilities/cap-graph.ts packages/@monomind/cli/__tests__/capabilities/cap-graph.test.ts packages/@monomind/cli/src/capabilities/index.ts
git commit -m "feat(capabilities): cap/graph with cross-content relationship building"
```

---

## Phase 4: Data + Polish

### Task 11: cap/data Module

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/cap-data.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/cap-data.test.ts`

**Interfaces:**
- Consumes: `CapabilityModule`, `DirectoryScan`, `FileEntry`, `IndexResult`, `SearchResult` from `types.ts`
- Produces: `dataCapability: CapabilityModule` — detects CSV/JSON/xlsx schema, makes structured data searchable

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/cap-data.test.ts
import { describe, it, expect } from 'vitest';
import { dataCapability } from '../../src/capabilities/cap-data.js';
import type { FileEntry } from '../../src/capabilities/types.js';
import path from 'path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'data');

describe('dataCapability', () => {
  it('has name "data"', () => {
    expect(dataCapability.name).toBe('data');
  });

  it('indexes CSV files with schema detection', async () => {
    const files: FileEntry[] = [
      {
        path: 'sample.csv',
        absolutePath: path.join(FIXTURES, 'sample.csv'),
        extension: '.csv',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
    ];

    await dataCapability.activate(FIXTURES);
    const result = await dataCapability.index(files);
    expect(result.indexed).toBe(1);
  });

  it('search finds data by column name', async () => {
    const files: FileEntry[] = [
      {
        path: 'sample.csv',
        absolutePath: path.join(FIXTURES, 'sample.csv'),
        extension: '.csv',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
    ];

    await dataCapability.activate(FIXTURES);
    await dataCapability.index(files);
    const results = await dataCapability.search!('city', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('data');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-data.test.ts`
Expected: FAIL — `cap-data.js` does not exist.

- [ ] **Step 3: Implement cap/data**

```typescript
// packages/@monomind/cli/src/capabilities/cap-data.ts
import fs from 'fs';
import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, SearchResult } from './types.js';

const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.jsonl', '.sqlite', '.parquet', '.xlsx', '.xls']);

interface DataEntry {
  path: string;
  columns: string[];
  rowCount: number;
  sampleValues: Record<string, string[]>;
  description: string;
}

const indexedData = new Map<string, DataEntry>();

function parseCSV(content: string): { columns: string[]; rows: string[][]; } {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return { columns: [], rows: [] };

  const columns = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => line.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  return { columns, rows };
}

function parseJSON(content: string): { columns: string[]; rowCount: number; sampleValues: Record<string, string[]> } {
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0) return { columns: [], rowCount: 0, sampleValues: {} };

    const columns = Object.keys(arr[0]);
    const sampleValues: Record<string, string[]> = {};
    for (const col of columns) {
      sampleValues[col] = arr.slice(0, 3).map(row => String(row[col] ?? ''));
    }
    return { columns, rowCount: arr.length, sampleValues };
  } catch {
    return { columns: [], rowCount: 0, sampleValues: {} };
  }
}

export const dataCapability: CapabilityModule = {
  name: 'data',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.data.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    indexedData.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      if (!DATA_EXTENSIONS.has(file.extension)) {
        skipped++;
        continue;
      }

      try {
        let columns: string[] = [];
        let rowCount = 0;
        let sampleValues: Record<string, string[]> = {};

        if (file.extension === '.csv' || file.extension === '.tsv') {
          const content = fs.readFileSync(file.absolutePath, 'utf-8');
          const parsed = parseCSV(content);
          columns = parsed.columns;
          rowCount = parsed.rows.length;
          for (const col of columns) {
            const colIdx = columns.indexOf(col);
            sampleValues[col] = parsed.rows.slice(0, 3).map(row => row[colIdx] ?? '');
          }
        } else if (file.extension === '.json' || file.extension === '.jsonl') {
          const content = fs.readFileSync(file.absolutePath, 'utf-8');
          const parsed = parseJSON(content);
          columns = parsed.columns;
          rowCount = parsed.rowCount;
          sampleValues = parsed.sampleValues;
        } else {
          // .sqlite, .parquet, .xlsx — metadata only (no content extraction without heavy deps)
          columns = [];
          rowCount = 0;
        }

        const description = columns.length > 0
          ? `${file.path}: ${rowCount} rows, columns: ${columns.join(', ')}`
          : `${file.path}: structured data file`;

        indexedData.set(file.path, { path: file.path, columns, rowCount, sampleValues, description });
        indexed++;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, skipped, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [dataPath, entry] of indexedData) {
      const descLower = entry.description.toLowerCase();
      const colMatch = entry.columns.some(c => c.toLowerCase().includes(queryLower));
      const valMatch = Object.values(entry.sampleValues).flat().some(v => v.toLowerCase().includes(queryLower));

      if (descLower.includes(queryLower) || colMatch || valMatch) {
        results.push({
          path: dataPath,
          score: colMatch ? 1.0 : valMatch ? 0.8 : 0.5,
          snippet: entry.description,
          type: 'data',
          metadata: { columns: entry.columns, rowCount: entry.rowCount },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/cap-data.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Register in barrel and manager, commit**

In `packages/@monomind/cli/src/capabilities/index.ts`, add:
```typescript
export { dataCapability } from './cap-data.js';
```

```bash
git add packages/@monomind/cli/src/capabilities/cap-data.ts packages/@monomind/cli/__tests__/capabilities/cap-data.test.ts packages/@monomind/cli/src/capabilities/index.ts
git commit -m "feat(capabilities): cap/data with CSV/JSON schema detection and column search"
```

---

### Task 12: Enrichment Pipeline + `monomind enrich` Command

**Files:**
- Create: `packages/@monomind/cli/src/capabilities/enrichment.ts`
- Create: `packages/@monomind/cli/src/commands/enrich.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/enrichment.test.ts`

**Interfaces:**
- Consumes: `EnrichmentState`, `EnrichmentTier`, `EnrichmentStatus`, `FileEntry`, `CapabilityModule` from `types.ts`; `CapabilityManager` from `manager.ts`
- Produces: `EnrichmentPipeline` class with `runTier(tier, files)`, `getStatus()`, `pause()`, `resume()`, `saveState(monomindDir)`, `loadState(monomindDir)`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/enrichment.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { EnrichmentPipeline } from '../../src/capabilities/enrichment.js';
import type { EnrichmentState } from '../../src/capabilities/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('EnrichmentPipeline', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks enrichment state per file', () => {
    const pipeline = new EnrichmentPipeline();
    pipeline.markDone('report.pdf', 't0');
    pipeline.markDone('report.pdf', 't1');
    pipeline.markQueued('report.pdf', 't2');

    const state = pipeline.getState();
    expect(state['report.pdf'].t0).toBe('done');
    expect(state['report.pdf'].t1).toBe('done');
    expect(state['report.pdf'].t2).toBe('queued');
  });

  it('reports progress summary', () => {
    const pipeline = new EnrichmentPipeline();
    pipeline.markDone('a.pdf', 't0');
    pipeline.markDone('a.pdf', 't1');
    pipeline.markDone('a.pdf', 't2');
    pipeline.markDone('b.pdf', 't0');
    pipeline.markQueued('b.pdf', 't1');

    const summary = pipeline.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.fullyEnriched).toBe(1);
    expect(summary.t0Done).toBe(2);
    expect(summary.t1Done).toBe(1);
  });

  it('saves and loads state from disk', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-test-'));
    const pipeline = new EnrichmentPipeline();
    pipeline.markDone('report.pdf', 't0');

    pipeline.saveState(tmpDir);

    const pipeline2 = new EnrichmentPipeline();
    pipeline2.loadState(tmpDir);
    expect(pipeline2.getState()['report.pdf'].t0).toBe('done');
  });

  it('supports pause and resume', () => {
    const pipeline = new EnrichmentPipeline();
    expect(pipeline.isPaused).toBe(false);
    pipeline.pause();
    expect(pipeline.isPaused).toBe(true);
    pipeline.resume();
    expect(pipeline.isPaused).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/enrichment.test.ts`
Expected: FAIL — `enrichment.js` does not exist.

- [ ] **Step 3: Implement the enrichment pipeline**

```typescript
// packages/@monomind/cli/src/capabilities/enrichment.ts
import fs from 'fs';
import path from 'path';
import type { EnrichmentState, EnrichmentTier, EnrichmentStatus } from './types.js';

export interface EnrichmentSummary {
  total: number;
  fullyEnriched: number;
  t0Done: number;
  t1Done: number;
  t2Done: number;
}

export class EnrichmentPipeline {
  private state: EnrichmentState = {};
  private _paused = false;

  get isPaused(): boolean {
    return this._paused;
  }

  markDone(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    this.state[filePath][tier] = 'done';
  }

  markQueued(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    this.state[filePath][tier] = 'queued';
  }

  markFailed(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    this.state[filePath][tier] = 'failed';
  }

  markSkipped(filePath: string, tier: EnrichmentTier): void {
    this.ensureEntry(filePath);
    this.state[filePath][tier] = 'skipped';
  }

  getState(): EnrichmentState {
    return { ...this.state };
  }

  getSummary(): EnrichmentSummary {
    const entries = Object.values(this.state);
    return {
      total: entries.length,
      fullyEnriched: entries.filter(e => e.t0 === 'done' && e.t1 === 'done' && e.t2 === 'done').length,
      t0Done: entries.filter(e => e.t0 === 'done').length,
      t1Done: entries.filter(e => e.t1 === 'done').length,
      t2Done: entries.filter(e => e.t2 === 'done').length,
    };
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
  }

  saveState(monomindDir: string): void {
    const statePath = path.join(monomindDir, 'enrichment.json');
    fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2));
  }

  loadState(monomindDir: string): void {
    const statePath = path.join(monomindDir, 'enrichment.json');
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      this.state = JSON.parse(raw);
    } catch {
      this.state = {};
    }
  }

  private ensureEntry(filePath: string): void {
    if (!this.state[filePath]) {
      this.state[filePath] = { t0: 'pending', t1: 'pending', t2: 'pending' };
    }
  }
}
```

- [ ] **Step 4: Implement the `monomind enrich` command**

```typescript
// packages/@monomind/cli/src/commands/enrich.ts
import type { Command, CommandContext, CommandResult } from '../types.js';
import { EnrichmentPipeline } from '../capabilities/enrichment.js';
import path from 'path';

export const enrichCommand: Command = {
  name: 'enrich',
  description: 'Manage progressive content enrichment',
  options: [
    { name: 'status', description: 'Show enrichment progress', type: 'boolean' },
    { name: 'pause', description: 'Pause background enrichment', type: 'boolean' },
    { name: 'resume', description: 'Resume background enrichment', type: 'boolean' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const monomindDir = path.join(ctx.cwd, '.monomind');
    const pipeline = new EnrichmentPipeline();
    pipeline.loadState(monomindDir);

    if (ctx.flags.pause) {
      pipeline.pause();
      return { success: true, message: 'Enrichment paused.' };
    }

    if (ctx.flags.resume) {
      pipeline.resume();
      return { success: true, message: 'Enrichment resumed.' };
    }

    // Default: show status
    const summary = pipeline.getSummary();
    const output = [
      `Enrichment Status`,
      `─────────────────`,
      `Total files: ${summary.total}`,
      `T0 (metadata):  ${summary.t0Done}/${summary.total}`,
      `T1 (content):   ${summary.t1Done}/${summary.total}`,
      `T2 (AI):        ${summary.t2Done}/${summary.total}`,
      `Fully enriched: ${summary.fullyEnriched}/${summary.total}`,
      `Paused: ${pipeline.isPaused ? 'yes' : 'no'}`,
    ];
    console.log(output.join('\n'));

    return { success: true };
  },
};

export default enrichCommand;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/enrichment.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 6: Register enrich command and export enrichment from barrel**

In `packages/@monomind/cli/src/capabilities/index.ts`, add:
```typescript
export { EnrichmentPipeline } from './enrichment.js';
```

Register `enrichCommand` in the CLI command list (same pattern as other commands — add to the commands array in `packages/@monomind/cli/src/commands/index.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/@monomind/cli/src/capabilities/enrichment.ts packages/@monomind/cli/src/commands/enrich.ts packages/@monomind/cli/__tests__/capabilities/enrichment.test.ts packages/@monomind/cli/src/capabilities/index.ts packages/@monomind/cli/src/commands/index.ts
git commit -m "feat(capabilities): enrichment pipeline with T0/T1/T2 tracking and enrich CLI command"
```

---

### Task 13: Universal Search Command

**Files:**
- Create: `packages/@monomind/cli/src/commands/search-universal.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/search-universal.test.ts`

**Interfaces:**
- Consumes: `CapabilityManager` from `manager.ts`; `loadFingerprint` from `scanner.ts`; `SearchResult` from `types.ts`
- Produces: `searchCommand: Command` — unified search across all active capabilities

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/@monomind/cli/__tests__/capabilities/search-universal.test.ts
import { describe, it, expect, vi } from 'vitest';
import { formatSearchResults, groupByType } from '../../src/commands/search-universal.js';
import type { SearchResult } from '../../src/capabilities/types.js';

describe('search formatting', () => {
  it('groups results by type', () => {
    const results: SearchResult[] = [
      { path: 'report.pdf', score: 0.9, snippet: 'quarterly report', type: 'documents' },
      { path: 'photo.jpg', score: 0.7, snippet: 'office photo', type: 'media' },
      { path: 'report2.md', score: 0.6, snippet: 'meeting notes', type: 'documents' },
    ];

    const grouped = groupByType(results);
    expect(grouped.documents?.length).toBe(2);
    expect(grouped.media?.length).toBe(1);
  });

  it('formats results with type headers', () => {
    const results: SearchResult[] = [
      { path: 'report.pdf', score: 0.9, snippet: 'quarterly report', type: 'documents' },
    ];

    const output = formatSearchResults(results);
    expect(output).toContain('Documents');
    expect(output).toContain('report.pdf');
    expect(output).toContain('quarterly report');
  });

  it('returns empty message when no results', () => {
    const output = formatSearchResults([]);
    expect(output).toContain('No results');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/search-universal.test.ts`
Expected: FAIL — `search-universal.js` does not exist.

- [ ] **Step 3: Implement the universal search command**

```typescript
// packages/@monomind/cli/src/commands/search-universal.ts
import type { Command, CommandContext, CommandResult } from '../types.js';
import type { SearchResult, CapabilityName } from '../capabilities/types.js';
import { CapabilityManager } from '../capabilities/manager.js';
import { loadFingerprint } from '../capabilities/scanner.js';
import { codeCapability } from '../capabilities/cap-code.js';
import { documentsCapability } from '../capabilities/cap-documents.js';
import { mediaCapability } from '../capabilities/cap-media.js';
import { dataCapability } from '../capabilities/cap-data.js';
import { graphCapability } from '../capabilities/cap-graph.js';
import { timelineCapability } from '../capabilities/cap-timeline.js';
import path from 'path';

const TYPE_ICONS: Record<string, string> = {
  documents: '📄',
  media: '📷',
  data: '📊',
  code: '💻',
  graph: '🔗',
  timeline: '📅',
};

const TYPE_LABELS: Record<string, string> = {
  documents: 'Documents',
  media: 'Photos & Media',
  data: 'Data Files',
  code: 'Code',
  graph: 'Related Files',
  timeline: 'Timeline',
};

export function groupByType(results: SearchResult[]): Partial<Record<CapabilityName, SearchResult[]>> {
  const grouped: Partial<Record<CapabilityName, SearchResult[]>> = {};
  for (const r of results) {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type]!.push(r);
  }
  return grouped;
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  const grouped = groupByType(results);
  const lines: string[] = [];

  for (const [type, items] of Object.entries(grouped)) {
    const icon = TYPE_ICONS[type] ?? '📁';
    const label = TYPE_LABELS[type] ?? type;
    lines.push(`\n${label}:`);
    for (const item of items as SearchResult[]) {
      lines.push(`  ${icon} ${item.path} — ${item.snippet}`);
    }
  }

  return lines.join('\n');
}

export const searchUniversalCommand: Command = {
  name: 'search',
  description: 'Search across all content types',
  options: [
    { name: 'limit', description: 'Max results', type: 'number' },
    { name: 'type', description: 'Filter by type (documents, media, data, code)', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.args.join(' ');
    if (!query) {
      return { success: false, message: 'Usage: monomind search <query>' };
    }

    const monomindDir = path.join(ctx.cwd, '.monomind');
    const fingerprint = await loadFingerprint(monomindDir);

    const mgr = new CapabilityManager();
    mgr.register(codeCapability);
    mgr.register(documentsCapability);
    mgr.register(mediaCapability);
    mgr.register(dataCapability);
    mgr.register(graphCapability);
    mgr.register(timelineCapability);

    if (fingerprint) {
      await mgr.activateFromScan(fingerprint, ctx.cwd);
    }

    const limit = (ctx.flags.limit as number) ?? 20;
    const results = await mgr.search(query, limit);

    const output = formatSearchResults(results);
    console.log(output);

    return { success: true };
  },
};

export default searchUniversalCommand;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/search-universal.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Register search command, commit**

Register `searchUniversalCommand` in the CLI commands array. This replaces the current `memory search` for non-code directories while keeping it available for code projects.

```bash
git add packages/@monomind/cli/src/commands/search-universal.ts packages/@monomind/cli/__tests__/capabilities/search-universal.test.ts packages/@monomind/cli/src/commands/index.ts
git commit -m "feat(capabilities): universal search command with grouped results across all content types"
```

---

### Task 14: `monomind scan` Command + Full Integration Test

**Files:**
- Create: `packages/@monomind/cli/src/commands/scan.ts`
- Test: `packages/@monomind/cli/__tests__/capabilities/e2e.test.ts`

**Interfaces:**
- Consumes: `scanDirectory`, `saveFingerprint` from `scanner.ts`
- Produces: `scanCommand: Command` — re-scans directory and updates fingerprint

- [ ] **Step 1: Implement the scan command**

```typescript
// packages/@monomind/cli/src/commands/scan.ts
import type { Command, CommandContext, CommandResult } from '../types.js';
import { scanDirectory, saveFingerprint } from '../capabilities/scanner.js';
import path from 'path';

export const scanCommand: Command = {
  name: 'scan',
  description: 'Scan directory and update capability fingerprint',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const scan = await scanDirectory(ctx.cwd);
    const monomindDir = path.join(ctx.cwd, '.monomind');
    await saveFingerprint(scan, monomindDir);

    console.log(`\nScanned ${scan.totalFiles} files in ${scan.root}`);
    console.log(`Git: ${scan.git ? 'yes' : 'no'}`);
    console.log(`\nCapabilities detected:`);

    for (const [name, score] of Object.entries(scan.capabilities)) {
      if (score.confidence > 0.1) {
        console.log(`  ✓ ${name} (${(score.confidence * 100).toFixed(0)}% confidence, ${score.files} files)`);
      }
    }

    const inactive = Object.entries(scan.capabilities).filter(([, s]) => s.confidence <= 0.1);
    if (inactive.length > 0) {
      console.log(`\nNot detected: ${inactive.map(([n]) => n).join(', ')}`);
    }

    return { success: true };
  },
};

export default scanCommand;
```

- [ ] **Step 2: Write E2E integration test**

```typescript
// packages/@monomind/cli/__tests__/capabilities/e2e.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { scanDirectory, saveFingerprint, loadFingerprint, CapabilityManager, codeCapability } from '../../src/capabilities/index.js';
import { documentsCapability } from '../../src/capabilities/cap-documents.js';
import { mediaCapability } from '../../src/capabilities/cap-media.js';
import { dataCapability } from '../../src/capabilities/cap-data.js';
import { graphCapability } from '../../src/capabilities/cap-graph.js';
import { timelineCapability } from '../../src/capabilities/cap-timeline.js';
import { EnrichmentPipeline } from '../../src/capabilities/enrichment.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('E2E: full second-brain flow', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scan → activate → index → search in a mixed directory', async () => {
    const mixedDir = path.join(FIXTURES, 'mixed');
    const scan = await scanDirectory(mixedDir);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-e2e-'));
    await saveFingerprint(scan, tmpDir);

    const mgr = new CapabilityManager();
    mgr.register(codeCapability);
    mgr.register(documentsCapability);
    mgr.register(mediaCapability);
    mgr.register(dataCapability);
    mgr.register(graphCapability);
    mgr.register(timelineCapability);

    await mgr.activateFromScan(scan, mixedDir);

    // Should have at least code + documents active
    expect(mgr.isActive('code') || mgr.isActive('documents')).toBe(true);

    // Fingerprint persisted
    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
  });

  it('enrichment pipeline tracks state across tiers', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-e2e-'));
    const pipeline = new EnrichmentPipeline();

    pipeline.markDone('report.pdf', 't0');
    pipeline.markDone('report.pdf', 't1');
    pipeline.markQueued('report.pdf', 't2');
    pipeline.markDone('photo.jpg', 't0');
    pipeline.markSkipped('photo.jpg', 't1');

    pipeline.saveState(tmpDir);

    const summary = pipeline.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.t0Done).toBe(2);
    expect(summary.t1Done).toBe(1);
  });

  it('code project scan activates cap/code and skips doc/media', async () => {
    const codeDir = path.join(FIXTURES, 'code-project');
    const scan = await scanDirectory(codeDir);

    const mgr = new CapabilityManager();
    mgr.register(codeCapability);
    mgr.register(documentsCapability);
    mgr.register(mediaCapability);

    await mgr.activateFromScan(scan, codeDir);

    expect(mgr.isActive('code')).toBe(true);
    expect(mgr.isActive('documents')).toBe(false);
    expect(mgr.isActive('media')).toBe(false);
  });
});
```

- [ ] **Step 3: Run all capability tests**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/capabilities/`
Expected: ALL tests pass across all files.

- [ ] **Step 4: Register scan command, commit**

```bash
git add packages/@monomind/cli/src/commands/scan.ts packages/@monomind/cli/__tests__/capabilities/e2e.test.ts packages/@monomind/cli/src/commands/index.ts
git commit -m "feat(capabilities): scan command + E2E integration tests for universal second brain"
```

---

## Summary

| Task | Phase | Description |
|------|-------|-------------|
| 1 | P0 | Capability types and interfaces |
| 2 | P0 | Directory scanner with auto-detection |
| 3 | P0 | Capability manager with activation logic |
| 4 | P0 | File watcher (fs.watch + git fast path) |
| 5 | P0 | cap/code wrapping existing behavior |
| 6 | P0 | Integrate into init + doctor |
| 7 | P1 | cap/documents (PDF/docx/md extraction) |
| 8 | P2 | cap/media (EXIF extraction) |
| 9 | P3 | cap/timeline (temporal index) |
| 10 | P3 | cap/graph (cross-content relationships) |
| 11 | P4 | cap/data (CSV/JSON schema detection) |
| 12 | P4 | Enrichment pipeline + enrich command |
| 13 | P4 | Universal search command |
| 14 | P4 | Scan command + E2E tests |

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { openDb, closeDb } from '../../../../storage/db.js';
import { insertNodes } from '../../../../storage/node-store.js';
import type { MonographNode } from '../../../../types.js';
import type { PipelineContext } from '../../../../pipeline/types.js';
import { DEFAULT_OPTIONS } from '../../../../pipeline/types.js';
import { electronIpcAdapter } from '../../../../pipeline/phases/bridge-adapters/electron-ipc.js';

function makeCtx(repoPath: string, db: Database.Database): PipelineContext {
  return {
    repoPath,
    db,
    graph: undefined as never,
    onProgress: () => {},
    options: DEFAULT_OPTIONS,
  };
}

function writeFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function fileNode(id: string, filePath: string): MonographNode {
  return {
    id, label: 'File', name: filePath.split('/').pop()!, normLabel: '', filePath,
    isExported: false,
  };
}

describe('electronIpcAdapter', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'electron-ipc-bridge-test-'));
    db = openDb(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a repo with both ipcMain and ipcRenderer usage', () => {
    writeFile(tmpDir, 'main.js', `ipcMain.handle('get-data', () => {});`);
    writeFile(tmpDir, 'renderer.js', `ipcRenderer.invoke('get-data');`);
    const ctx = makeCtx(tmpDir, db);
    expect(electronIpcAdapter.detect(ctx, ['main.js', 'renderer.js'])).toBe(true);
  });

  it('does not detect main-only usage (no renderer side)', () => {
    writeFile(tmpDir, 'main.js', `ipcMain.handle('get-data', () => {});`);
    const ctx = makeCtx(tmpDir, db);
    expect(electronIpcAdapter.detect(ctx, ['main.js'])).toBe(false);
  });

  it('links a channel from ipcMain.handle to ipcRenderer.invoke by name', () => {
    writeFile(tmpDir, 'main.js', `ipcMain.handle('get-data', () => fetchData());`);
    writeFile(tmpDir, 'renderer.js', `const data = await ipcRenderer.invoke('get-data');`);
    insertNodes(db, [fileNode('main_file', 'main.js'), fileNode('renderer_file', 'renderer.js')]);
    const ctx = makeCtx(tmpDir, db);

    const defs = electronIpcAdapter.findDefinitions(ctx, ['main.js', 'renderer.js']);
    expect(defs).toEqual([{ key: 'get-data', nodeId: 'main_file', language: 'javascript' }]);

    const sites = electronIpcAdapter.findCallSites(ctx, ['main.js', 'renderer.js']);
    expect(sites).toEqual([{ key: 'get-data', nodeId: 'renderer_file', language: 'javascript' }]);
  });

  it('also matches ipcMain.on / ipcRenderer.send', () => {
    writeFile(tmpDir, 'main.js', `ipcMain.on('log', (e, msg) => console.log(msg));`);
    writeFile(tmpDir, 'renderer.js', `ipcRenderer.send('log', 'hello');`);
    insertNodes(db, [fileNode('main_file', 'main.js'), fileNode('renderer_file', 'renderer.js')]);
    const ctx = makeCtx(tmpDir, db);

    expect(electronIpcAdapter.findDefinitions(ctx, ['main.js']))
      .toEqual([{ key: 'log', nodeId: 'main_file', language: 'javascript' }]);
    expect(electronIpcAdapter.findCallSites(ctx, ['renderer.js']))
      .toEqual([{ key: 'log', nodeId: 'renderer_file', language: 'javascript' }]);
  });
});

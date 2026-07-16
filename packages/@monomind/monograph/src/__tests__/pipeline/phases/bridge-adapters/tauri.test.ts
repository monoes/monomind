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
import { tauriAdapter } from '../../../../pipeline/phases/bridge-adapters/tauri.js';

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

function fnNode(id: string, name: string, filePath: string): MonographNode {
  return {
    id, label: 'Function', name, normLabel: name.toLowerCase(), filePath,
    isExported: true, language: 'rust',
  };
}

function fileNode(id: string, filePath: string): MonographNode {
  return {
    id, label: 'File', name: filePath.split('/').pop()!, normLabel: '', filePath,
    isExported: false,
  };
}

describe('tauriAdapter', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tauri-bridge-test-'));
    db = openDb(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a repo with a #[tauri::command]-annotated Rust file', () => {
    writeFile(tmpDir, 'src-tauri/src/main.rs', `
#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}
`);
    const ctx = makeCtx(tmpDir, db);
    expect(tauriAdapter.detect(ctx, ['src-tauri/src/main.rs'])).toBe(true);
  });

  it('does not detect a repo with no Rust files', () => {
    const ctx = makeCtx(tmpDir, db);
    expect(tauriAdapter.detect(ctx, ['src/App.tsx'])).toBe(false);
  });

  it('does not detect a Rust file with no #[tauri::command] annotation', () => {
    writeFile(tmpDir, 'src-tauri/src/main.rs', `
fn internal_helper() -> i32 { 42 }
`);
    const ctx = makeCtx(tmpDir, db);
    expect(tauriAdapter.detect(ctx, ['src-tauri/src/main.rs'])).toBe(false);
  });

  it('finds a #[tauri::command] fn matched to its existing Function node', () => {
    writeFile(tmpDir, 'src-tauri/src/main.rs', `
#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}
`);
    insertNodes(db, [fnNode('rust_fn_1', 'greet', 'src-tauri/src/main.rs')]);
    const ctx = makeCtx(tmpDir, db);
    const defs = tauriAdapter.findDefinitions(ctx, ['src-tauri/src/main.rs']);
    expect(defs).toEqual([{ key: 'greet', nodeId: 'rust_fn_1', language: 'rust' }]);
  });

  it('ignores a plain fn with no #[tauri::command] attribute', () => {
    writeFile(tmpDir, 'src-tauri/src/main.rs', `
fn internal_helper() -> i32 { 42 }
`);
    insertNodes(db, [fnNode('rust_fn_2', 'internal_helper', 'src-tauri/src/main.rs')]);
    const ctx = makeCtx(tmpDir, db);
    const defs = tauriAdapter.findDefinitions(ctx, ['src-tauri/src/main.rs']);
    expect(defs).toEqual([]);
  });

  it('finds an invoke() call site attached to its containing File node', () => {
    writeFile(tmpDir, 'src/App.tsx', `
import { invoke } from '@tauri-apps/api/core';
async function onClick() {
  await invoke('greet', { name: 'world' });
}
`);
    insertNodes(db, [fileNode('file_1', 'src/App.tsx')]);
    const ctx = makeCtx(tmpDir, db);
    const sites = tauriAdapter.findCallSites(ctx, ['src/App.tsx']);
    expect(sites).toEqual([{ key: 'greet', nodeId: 'file_1', language: 'javascript' }]);
  });
});

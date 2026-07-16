import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { openDb, closeDb } from '../../../../storage/db.js';
import { insertNodes } from '../../../../storage/node-store.js';
import type { MonographNode } from '../../../../types.js';
import type { PipelineContext } from '../../../../pipeline/types.js';
import { DEFAULT_OPTIONS } from '../../../../pipeline/types.js';
import { wailsAdapter } from '../../../../pipeline/phases/bridge-adapters/wails.js';

function makeCtx(repoPath: string, db: Database.Database): PipelineContext {
  return {
    repoPath,
    db,
    graph: undefined as never,
    onProgress: () => {},
    options: DEFAULT_OPTIONS,
  };
}

function methodNode(id: string, name: string, filePath: string): MonographNode {
  return {
    id, label: 'Method', name, normLabel: name.toLowerCase(), filePath,
    isExported: true, language: 'go',
  };
}

function functionNode(id: string, name: string, filePath: string, language = 'typescript'): MonographNode {
  return {
    id, label: 'Function', name, normLabel: name.toLowerCase(), filePath,
    isExported: true, language,
  };
}

describe('wailsAdapter', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wails-bridge-test-'));
    db = openDb(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a repo with a wailsjs/go binding directory', () => {
    const ctx = makeCtx(tmpDir, db);
    expect(wailsAdapter.detect(ctx, ['frontend/src/wailsjs/go/main/App.js'])).toBe(true);
  });

  it('does not detect a repo with no wails bindings', () => {
    const ctx = makeCtx(tmpDir, db);
    expect(wailsAdapter.detect(ctx, ['app.go', 'frontend/src/App.jsx'])).toBe(false);
  });

  it('finds Go methods as definitions', () => {
    insertNodes(db, [methodNode('go_method_1', 'SendMessage', 'app.go')]);
    const ctx = makeCtx(tmpDir, db);
    const defs = wailsAdapter.findDefinitions(ctx, []);
    expect(defs).toEqual([{ key: 'SendMessage', nodeId: 'go_method_1', language: 'go' }]);
  });

  it('finds wailsjs binding functions as call sites', () => {
    insertNodes(db, [functionNode('js_fn_1', 'SendMessage', 'frontend/src/wailsjs/go/main/App.js')]);
    const ctx = makeCtx(tmpDir, db);
    const sites = wailsAdapter.findCallSites(ctx, []);
    expect(sites).toEqual([{ key: 'SendMessage', nodeId: 'js_fn_1', language: 'typescript' }]);
  });

  it('does not treat a Function outside wailsjs/go/ as a call site', () => {
    insertNodes(db, [functionNode('js_fn_2', 'SendMessage', 'frontend/src/services/api.js')]);
    const ctx = makeCtx(tmpDir, db);
    const sites = wailsAdapter.findCallSites(ctx, []);
    expect(sites).toEqual([]);
  });
});

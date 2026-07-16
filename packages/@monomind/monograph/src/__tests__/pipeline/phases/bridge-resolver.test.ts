import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { buildAsync } from '../../../pipeline/orchestrator.js';

function writeFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function edgeRows(dbPath: string): { source_id: string; target_id: string; relation: string; confidence: string; reason: string | null }[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`SELECT source_id, target_id, relation, confidence, reason FROM edges`).all() as never[];
  } finally {
    db.close();
  }
}

/** Bridge edges are tagged with a reason of the form "<adapter> bridge: ...". */
function isBridgeEdge(e: { reason: string | null }): boolean {
  return !!e.reason && / bridge: /.test(e.reason);
}

describe('bridge-resolver (full pipeline)', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('links a Wails Go method to its generated JS binding function', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bridge-e2e-wails-'));

    writeFile(tmpDir, 'app.go', `
package main

type App struct{}

func (a *App) SendMessage(text string) error {
	return nil
}
`);
    writeFile(tmpDir, 'frontend/src/wailsjs/go/main/App.js', `
export function SendMessage(arg1) {
  return window['go']['main']['App']['SendMessage'](arg1);
}
`);
    writeFile(tmpDir, 'frontend/src/App.jsx', `
import { SendMessage } from './wailsjs/go/main/App';
function onClick() { SendMessage('hi'); }
`);

    await buildAsync(tmpDir, { codeOnly: true });

    const edges = edgeRows(join(tmpDir, '.monomind', 'monograph.db'));
    const bridgeEdge = edges.find((e) => e.relation === 'CALLS' && e.confidence === 'INFERRED' && isBridgeEdge(e));
    expect(bridgeEdge).toBeDefined();
  });

  it('does not emit a bridge edge when there is no matching Go method', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bridge-e2e-wails-negative-'));

    writeFile(tmpDir, 'app.go', `
package main

type App struct{}

func (a *App) UnrelatedMethod() error {
	return nil
}
`);
    writeFile(tmpDir, 'frontend/src/wailsjs/go/main/App.js', `
export function SendMessage(arg1) {
  return window['go']['main']['App']['SendMessage'](arg1);
}
`);

    await buildAsync(tmpDir, { codeOnly: true });

    const db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
    const jsFn = db.prepare(`SELECT id FROM nodes WHERE name = 'SendMessage' AND label = 'Function'`).get() as { id: string } | undefined;
    db.close();
    expect(jsFn).toBeDefined();

    const edges = edgeRows(join(tmpDir, '.monomind', 'monograph.db'));
    const bridgeEdgeToJsFn = edges.find((e) => e.target_id === jsFn!.id && isBridgeEdge(e));
    expect(bridgeEdgeToJsFn).toBeUndefined();
  });

  it('does nothing in a repo with no bridge frameworks present', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bridge-e2e-none-'));
    writeFile(tmpDir, 'main.go', `
package main

func main() {
	println("hello")
}
`);

    await buildAsync(tmpDir, { codeOnly: true });

    const edges = edgeRows(join(tmpDir, '.monomind', 'monograph.db'));
    const bridgeEdges = edges.filter(isBridgeEdge);
    expect(bridgeEdges).toEqual([]);
  });
});

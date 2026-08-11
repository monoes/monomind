import { describe, it, expect } from 'vitest';
import { parseFile, isSupportedExtension, getLanguageForExt } from '../../src/parsers/loader.js';

// MONO-1 regression: the 5 advertised "regex-based" languages (Scala, Lua, Zig,
// PowerShell, Elixir) used to be silently skipped — `isSupportedExtension`
// didn't list them and `parseFile` returned empty results for their extensions
// even though `extractSymbolsForLanguage` knew how to handle them. These tests
// pin the end-to-end dispatch from `parseFile` → `extractSymbolsForLanguage`.

describe('MONO-1: isSupportedExtension recognises regex-based languages', () => {
  it.each([
    ['.scala', true],
    ['.sc', true],
    ['.lua', true],
    ['.zig', true],
    ['.ps1', true],
    ['.psm1', true],
    ['.ex', true],
    ['.exs', true],
    // Negative sample — never silently start claiming new extensions.
    ['.css', false],
    ['.md', false],
  ] as const)('isSupportedExtension(%s) === %s', (ext, expected) => {
    expect(isSupportedExtension(ext)).toBe(expected);
  });
});

describe('MONO-1: getLanguageForExt maps the new extensions', () => {
  it.each([
    ['.scala', 'scala'],
    ['.sc', 'scala'],
    ['.lua', 'lua'],
    ['.zig', 'zig'],
    ['.ps1', 'powershell'],
    ['.psm1', 'powershell'],
    ['.ex', 'elixir'],
    ['.exs', 'elixir'],
    ['.unknown', 'unknown'],
  ] as const)('getLanguageForExt(%s) === %s', (ext, expected) => {
    expect(getLanguageForExt(ext)).toBe(expected);
  });
});

describe('MONO-1: parseFile dispatches to regex extractor for each language', () => {
  it('extracts Scala objects/classes/defs', async () => {
    // The regex extractor requires `def` at the start of a line (after whitespace).
    const src = `object PaymentService {\n  def process(o: Order): Unit = {}\n}\nclass OrderRepo extends BaseRepo {}`;
    const r = await parseFile('/repo/src/pay.scala', src, 'src/pay.scala');
    expect(r.nodes.some(n => n.name === 'PaymentService' && n.label === 'Class')).toBe(true);
    expect(r.nodes.some(n => n.name === 'OrderRepo')).toBe(true);
    expect(r.nodes.some(n => n.name === 'process' && n.label === 'Function')).toBe(true);
    // File node is created and CONTAINS edges link it to each symbol.
    expect(r.nodes.some(n => n.label === 'File' && n.name === 'pay.scala')).toBe(true);
    expect(r.edges.some(e => e.relation === 'CONTAINS')).toBe(true);
    // language tag flows through to nodes so downstream tools can filter on it.
    expect(r.nodes.every(n => n.language === 'scala')).toBe(true);
  });

  it('extracts Lua functions and marks local vs exported', async () => {
    const src = `function greet(name)\n  return "hi"\nend\nlocal function helper() end`;
    const r = await parseFile('/repo/util.lua', src, 'util.lua');
    const greet = r.nodes.find(n => n.name === 'greet');
    const helper = r.nodes.find(n => n.name === 'helper');
    expect(greet).toBeDefined();
    expect(greet?.isExported).toBe(true);
    expect(helper).toBeDefined();
    expect(helper?.isExported).toBe(false);
  });

  it('extracts Zig pub fn declarations', async () => {
    const src = `pub fn allocate(size: usize) anyerror![]u8 {}\nfn helper() void {}`;
    const r = await parseFile('/repo/alloc.zig', src, 'alloc.zig');
    const allocate = r.nodes.find(n => n.name === 'allocate');
    const helper = r.nodes.find(n => n.name === 'helper');
    expect(allocate).toBeDefined();
    expect(allocate?.isExported).toBe(true);
    expect(helper).toBeDefined();
    expect(helper?.isExported).toBe(false);
  });

  it('extracts PowerShell functions', async () => {
    const src = `function Get-User { param($id) }\nfunction Set-Config { param($cfg) }`;
    const r = await parseFile('/repo/util.ps1', src, 'util.ps1');
    expect(r.nodes.some(n => n.name === 'Get-User')).toBe(true);
    expect(r.nodes.some(n => n.name === 'Set-Config')).toBe(true);
  });

  it('extracts Elixir defmodule + def', async () => {
    const src = `defmodule PayApp.Payments do\n  def process(order) do\n    :ok\n  end\nend`;
    const r = await parseFile('/repo/payments.ex', src, 'payments.ex');
    expect(r.nodes.some(n => n.name === 'PayApp.Payments' && n.label === 'Module')).toBe(true);
    expect(r.nodes.some(n => n.name === 'process')).toBe(true);
  });

  it('returns clean parseErrors (no recovery) for well-formed input', async () => {
    const r = await parseFile('/repo/clean.lua', 'function noop() end', 'clean.lua');
    expect(r.parseErrors).toHaveLength(0);
  });

  it('still returns empty for truly unsupported extensions', async () => {
    const r = await parseFile('/repo/style.css', '.a { color: red; }', 'style.css');
    expect(r.nodes).toHaveLength(0);
    expect(r.edges).toHaveLength(0);
    expect(r.parseErrors).toHaveLength(0);
  });
});

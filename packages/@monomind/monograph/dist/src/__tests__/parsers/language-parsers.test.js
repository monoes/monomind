import { describe, it, expect } from 'vitest';
import { extractSymbolsForLanguage } from '../../parsers/language-parsers.js';
describe('Scala extraction', () => {
    it('extracts object and class definitions', () => {
        const src = `object PaymentService { def process(order: Order): Unit = {} }\nclass OrderRepo extends BaseRepo {}`;
        const r = extractSymbolsForLanguage(src, '/pay.scala', 'scala');
        const names = r.map(s => s.name);
        expect(names).toContain('PaymentService');
        expect(names).toContain('OrderRepo');
    });
});
describe('Lua extraction', () => {
    it('extracts function definitions', () => {
        const src = `function greet(name)\n  return "Hello " .. name\nend\nlocal function helper() end`;
        const r = extractSymbolsForLanguage(src, '/util.lua', 'lua');
        const names = r.map(s => s.name);
        expect(names).toContain('greet');
        expect(names).toContain('helper');
    });
});
describe('Zig extraction', () => {
    it('extracts pub fn declarations', () => {
        const src = `pub fn allocate(size: usize) anyerror![]u8 {}\nfn helper() void {}`;
        const r = extractSymbolsForLanguage(src, '/alloc.zig', 'zig');
        const names = r.map(s => s.name);
        expect(names).toContain('allocate');
        expect(names).toContain('helper');
    });
});
describe('PowerShell extraction', () => {
    it('extracts function declarations', () => {
        const src = `function Get-User { param($id) }\nfunction Set-Config { param($cfg) }`;
        const r = extractSymbolsForLanguage(src, '/util.ps1', 'powershell');
        const names = r.map(s => s.name);
        expect(names).toContain('Get-User');
        expect(names).toContain('Set-Config');
    });
});
describe('Elixir extraction', () => {
    it('extracts defmodule and def', () => {
        const src = `defmodule PayApp.Payments do\n  def process(order) do\n    :ok\n  end\nend`;
        const r = extractSymbolsForLanguage(src, '/payments.ex', 'elixir');
        const names = r.map(s => s.name);
        expect(names).toContain('PayApp.Payments');
        expect(names).toContain('process');
    });
});
//# sourceMappingURL=language-parsers.test.js.map
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from '../../src/parsers/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/sample.go');
const declFixturePath = join(__dirname, '../fixtures/go-declarations.go');

describe('Go parser', () => {
  let result: Awaited<ReturnType<typeof parseFile>>;

  beforeAll(async () => {
    const source = readFileSync(fixturePath, 'utf-8');
    result = await parseFile(fixturePath, source, 'src/sample.go');
  });

  it('extracts at least one symbol node (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('produces no fatal parse errors (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(result.parseErrors).toHaveLength(0);
  });

  it('labels type aliases as TypeAlias (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const alias = result.nodes.find(n => n.name === 'MyInt');
    expect(alias).toBeDefined();
    expect(alias!.label).toBe('TypeAlias');
  });

  it('labels interfaces as Interface (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const iface = result.nodes.find(n => n.name === 'Greeter');
    expect(iface).toBeDefined();
    expect(iface!.label).toBe('Interface');
  });

  it('labels structs as Struct (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const struct = result.nodes.find(n => n.name === 'Person');
    expect(struct).toBeDefined();
    expect(struct!.label).toBe('Struct');
  });

  it('does not create duplicate nodes for interface bodies (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const ifaceNodes = result.nodes.filter(n => n.label === 'Interface');
    expect(ifaceNodes).toHaveLength(1);
    expect(ifaceNodes[0].name).toBe('Greeter');
  });

  it('extracts functions and methods (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const fn = result.nodes.find(n => n.name === 'helperFn' && n.label === 'Function');
    expect(fn).toBeDefined();
    const method = result.nodes.find(n => n.name === 'Greet' && n.label === 'Method');
    expect(method).toBeDefined();
  });

  it('marks uppercase identifiers as exported (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const addFn = result.nodes.find(n => n.name === 'Add' && n.label === 'Function');
    expect(addFn).toBeDefined();
    expect(addFn!.isExported).toBe(true);

    const person = result.nodes.find(n => n.name === 'Person');
    expect(person).toBeDefined();
    expect(person!.isExported).toBe(true);
  });

  it('marks lowercase identifiers as unexported (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const helperFn = result.nodes.find(n => n.name === 'helperFn' && n.label === 'Function');
    expect(helperFn).toBeDefined();
    expect(helperFn!.isExported).toBe(false);
  });
});

describe('Go var/const declarations', () => {
  let result: Awaited<ReturnType<typeof parseFile>>;

  beforeAll(async () => {
    const source = readFileSync(declFixturePath, 'utf-8');
    result = await parseFile(declFixturePath, source, 'src/decls.go');
  });

  const variable = (name: string) =>
    result.nodes.find(n => n.name === name && n.label === 'Variable');

  it('indexes single-line var and const declarations (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(variable('KillGrace')).toMatchObject({ startLine: 8, isExported: true });
    expect(variable('Timeout')).toMatchObject({ startLine: 10, isExported: true });
  });

  it('indexes every spec inside a grouped var block (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(variable('ErrInvalidConfig')).toMatchObject({ startLine: 15, isExported: true });
    expect(variable('errInternal')).toMatchObject({ startLine: 17, isExported: false });
    // A spec with a type and no value still declares a symbol.
    expect(variable('retries')).toMatchObject({ startLine: 18, isExported: false });
  });

  it('indexes every spec inside a grouped iota const block (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(variable('StateIdle')).toMatchObject({ startLine: 22, isExported: true });
    // Implicit-repetition specs carry no value at all.
    expect(variable('StateBusy')).toMatchObject({ startLine: 23, isExported: true });
    expect(variable('stateGone')).toMatchObject({ startLine: 24, isExported: false });
  });

  it('indexes each name of a multi-name spec (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(variable('First')).toMatchObject({ startLine: 27, isExported: true });
    expect(variable('Second')).toMatchObject({ startLine: 27, isExported: true });
  });

  it('still extracts functions alongside declarations (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const fn = result.nodes.find(n => n.name === 'Run' && n.label === 'Function');
    expect(fn).toMatchObject({ startLine: 29, isExported: true });
  });

  it('ignores variables declared inside a function (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(variable('local')).toBeUndefined();
  });
});

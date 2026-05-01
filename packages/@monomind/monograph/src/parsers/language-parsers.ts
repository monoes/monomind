export type SupportedLanguage = 'scala' | 'lua' | 'zig' | 'powershell' | 'elixir';

export interface SymbolExtract {
  name: string;
  label: 'Function' | 'Class' | 'Module' | 'Namespace';
  isExported: boolean;
  line: number;
  filePath: string;
}

// ── Scala ────────────────────────────────────────────────────────────
const SCALA_DEF_RE = /^[ \t]*(?:(?:case\s+)?class|object|trait)\s+(\w[\w$]*)/gm;
const SCALA_FN_RE = /^[ \t]*(?:override\s+)?def\s+(\w[\w$]*)/gm;

function extractScala(src: string, fp: string): SymbolExtract[] {
  const out: SymbolExtract[] = [];
  let m: RegExpExecArray | null;

  SCALA_DEF_RE.lastIndex = 0;
  while ((m = SCALA_DEF_RE.exec(src)) !== null) {
    const line = (src.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
    out.push({ name: m[1]!, label: 'Class', isExported: true, line, filePath: fp });
  }
  SCALA_FN_RE.lastIndex = 0;
  while ((m = SCALA_FN_RE.exec(src)) !== null) {
    const line = (src.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
    out.push({ name: m[1]!, label: 'Function', isExported: true, line, filePath: fp });
  }
  return out;
}

// ── Lua ─────────────────────────────────────────────────────────────
const LUA_FN_RE = /^[ \t]*(?:local\s+)?function\s+(\w[\w.]*)\s*\(/gm;

function extractLua(src: string, fp: string): SymbolExtract[] {
  const out: SymbolExtract[] = [];
  let m: RegExpExecArray | null;
  LUA_FN_RE.lastIndex = 0;
  while ((m = LUA_FN_RE.exec(src)) !== null) {
    const line = (src.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
    const isLocal = /^[ \t]*local\s+function/.test(m[0]);
    out.push({ name: m[1]!, label: 'Function', isExported: !isLocal, line, filePath: fp });
  }
  return out;
}

// ── Zig ─────────────────────────────────────────────────────────────
const ZIG_FN_RE = /^[ \t]*(pub\s+)?fn\s+(\w+)\s*\(/gm;

function extractZig(src: string, fp: string): SymbolExtract[] {
  const out: SymbolExtract[] = [];
  let m: RegExpExecArray | null;
  ZIG_FN_RE.lastIndex = 0;
  while ((m = ZIG_FN_RE.exec(src)) !== null) {
    const line = (src.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
    out.push({ name: m[2]!, label: 'Function', isExported: !!m[1], line, filePath: fp });
  }
  return out;
}

// ── PowerShell ───────────────────────────────────────────────────────
const PS_FN_RE = /^[ \t]*function\s+([\w-]+)\s*\{/gim;

function extractPowershell(src: string, fp: string): SymbolExtract[] {
  const out: SymbolExtract[] = [];
  let m: RegExpExecArray | null;
  PS_FN_RE.lastIndex = 0;
  while ((m = PS_FN_RE.exec(src)) !== null) {
    const line = (src.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
    out.push({ name: m[1]!, label: 'Function', isExported: true, line, filePath: fp });
  }
  return out;
}

// ── Elixir ───────────────────────────────────────────────────────────
const ELIXIR_MODULE_RE = /^[ \t]*defmodule\s+([\w.]+)\s+do/gm;
const ELIXIR_FN_RE = /^[ \t]*(?:def|defp)\s+(\w+)\s*[(\n]/gm;

function extractElixir(src: string, fp: string): SymbolExtract[] {
  const out: SymbolExtract[] = [];
  let m: RegExpExecArray | null;
  ELIXIR_MODULE_RE.lastIndex = 0;
  while ((m = ELIXIR_MODULE_RE.exec(src)) !== null) {
    const line = (src.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
    out.push({ name: m[1]!, label: 'Module', isExported: true, line, filePath: fp });
  }
  ELIXIR_FN_RE.lastIndex = 0;
  while ((m = ELIXIR_FN_RE.exec(src)) !== null) {
    const line = (src.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
    out.push({ name: m[1]!, label: 'Function', isExported: true, line, filePath: fp });
  }
  return out;
}

const DISPATCH: Record<SupportedLanguage, (src: string, fp: string) => SymbolExtract[]> = {
  scala: extractScala,
  lua: extractLua,
  zig: extractZig,
  powershell: extractPowershell,
  elixir: extractElixir,
};

export function extractSymbolsForLanguage(
  source: string,
  filePath: string,
  language: SupportedLanguage,
): SymbolExtract[] {
  return DISPATCH[language]?.(source, filePath) ?? [];
}

export const LANGUAGE_EXTENSIONS: Record<string, SupportedLanguage> = {
  '.scala': 'scala',
  '.sc': 'scala',
  '.lua': 'lua',
  '.zig': 'zig',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.ex': 'elixir',
  '.exs': 'elixir',
};

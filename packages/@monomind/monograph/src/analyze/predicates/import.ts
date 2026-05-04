export const BUILTIN_MODULES: Set<string> = new Set([
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "test",
  "test/reporters",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

export function isVirtualModule(specifier: string): boolean {
  return specifier.startsWith("virtual:");
}

export function isBuiltinModule(specifier: string): boolean {
  if (specifier.startsWith("bun:")) return true;
  if (specifier.startsWith("cloudflare:")) return true;
  if (specifier.startsWith("sass:")) return true;
  if (specifier === "std" || specifier.startsWith("std/")) return true;

  const stripped = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return BUILTIN_MODULES.has(stripped);
}

export function isImplicitDependency(specifier: string): boolean {
  if (specifier.startsWith("@types/")) return true;

  const implicitDeps = new Set([
    "react-dom",
    "react-dom/client",
    "react-native",
    "@next/font",
    "@next/mdx",
    "@next/bundle-analyzer",
    "@next/env",
    "utf-8-validate",
    "bufferutil",
  ]);

  return implicitDeps.has(specifier);
}

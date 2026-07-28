/**
 * Query-time network guard.
 *
 * The stop condition says "zero network calls at query time". This module does
 * not *infer* that from reading code — it BLOCKS the network and records every
 * attempt. If retrieval needs the network, queries fail loudly instead of
 * quietly succeeding and leaving us to assert offline-ness we never tested.
 *
 * Honest limits, stated so nobody over-claims from this evidence:
 *  - Coverage is layered, and the layers are not equally strong:
 *      * `net.Socket.prototype.connect` / `tls.TLSSocket.prototype.connect` are
 *        PROTOTYPE patches, so they bite no matter how the caller imported the
 *        module. Every TCP client in Node funnels through them, including
 *        undici (and therefore fetch), http, https and any npm HTTP library.
 *        This is the layer that actually makes the claim true.
 *      * `globalThis.fetch` is a global patch and equally universal.
 *      * The module-level patches (http.request, dns.lookup, ...) only bite for
 *        `require()` consumers: an ESM `import * as http` snapshots the
 *        bindings at load time and cannot be reached afterwards. They are kept
 *        as a second net, not relied on.
 *  - A native addon opening a socket in C++ would bypass all of it, which is
 *    why the baseline report also carries an out-of-process `lsof` check.
 *  - It is installed around the query phase only. Ingest may legitimately fetch
 *    an embedding model on first run; that is build time, not query time, and
 *    is reported separately.
 *
 * @module v1/cli/knowledge/eval/network-guard
 */

import { createRequire } from 'node:module';

// Deliberately require() rather than `import * as http`. ESM namespace objects
// are non-configurable, so assigning to them throws `Cannot redefine property`
// — which is exactly how a network guard silently becomes decorative. The CJS
// module objects for Node builtins ARE writable, which is how every HTTP
// interception library works. A unit test asserts the guard actually blocks.
const req = createRequire(import.meta.url);

export interface NetworkAttempt {
  api: string;
  target: string;
  stack: string;
}

export interface NetworkGuard {
  attempts: NetworkAttempt[];
  /** APIs that could NOT be patched. A non-empty list downgrades the offline
   *  claim from "proven" to "partial" — never silently ignored. */
  unpatched: string[];
  release(): void;
}

function describe(args: unknown[]): string {
  try {
    const a = args[0] as any;
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object') {
      if (a.href) return String(a.href);
      if (a.hostname || a.host) return String(a.hostname ?? a.host) + ':' + String(a.port ?? '');
    }
    return String(a);
  } catch { return '<unprintable>'; }
}

/**
 * Installs the guard. Every blocked call throws, so any code path that needed
 * the network surfaces as a failed query rather than a silent pass.
 */
export function installNetworkGuard(): NetworkGuard {
  const attempts: NetworkAttempt[] = [];
  const restores: Array<() => void> = [];

  const block = (api: string) => (...args: unknown[]): never => {
    const err = new Error('[eval] BLOCKED network call at query time: ' + api + ' -> ' + describe(args));
    attempts.push({ api, target: describe(args), stack: (err.stack ?? '').split('\n').slice(1, 8).join('\n') });
    throw err;
  };

  /** Returns false when the property genuinely could not be replaced — the
   *  caller turns that into a reported gap rather than a silent pass. */
  const failures: string[] = [];
  const patch = (obj: any, key: string, api: string): void => {
    if (!obj || typeof obj[key] !== 'function') return;
    const orig = obj[key];
    try {
      Object.defineProperty(obj, key, { value: block(api), writable: true, configurable: true });
      restores.push(() => { try { Object.defineProperty(obj, key, { value: orig, writable: true, configurable: true }); } catch { /* best effort */ } });
    } catch {
      failures.push(api);
    }
  };

  const http = req('node:http');
  const https = req('node:https');
  const net = req('node:net');
  const tls = req('node:tls');
  const dns = req('node:dns');

  const g = globalThis as any;
  if (typeof g.fetch === 'function') {
    const orig = g.fetch;
    g.fetch = block('fetch');
    restores.push(() => { g.fetch = orig; });
  }

  patch(http, 'request', 'http.request');
  patch(http, 'get', 'http.get');
  patch(https, 'request', 'https.request');
  patch(https, 'get', 'https.get');
  patch(net, 'connect', 'net.connect');
  patch(net, 'createConnection', 'net.createConnection');
  patch(net.Socket.prototype, 'connect', 'net.Socket.connect');
  patch(tls, 'connect', 'tls.connect');
  patch(dns, 'lookup', 'dns.lookup');
  patch(dns, 'resolve', 'dns.resolve');
  patch(dns.promises, 'lookup', 'dns.promises.lookup');

  return {
    attempts,
    unpatched: failures,
    release() { for (const r of restores.reverse()) r(); },
  };
}

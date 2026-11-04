/**
 * @monoes/mcp - Host/Origin allow-list helpers (DNS-rebinding and cross-site
 * WebSocket hijacking defence). Loopback only by default; mirrors the
 * dashboard's isAllowedHost in cli/src/ui/server-net.mjs.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function parseHostHeader(hostHeader: string | undefined): string {
  const h = String(hostHeader ?? '')
    .trim()
    .toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

function isLoopbackName(name: string): boolean {
  return LOOPBACK.has(name) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/** A missing Host header (non-browser client) is allowed; browsers always send one. */
export function isAllowedHost(hostHeader: string | undefined, extraHosts: string[] = []): boolean {
  const name = parseHostHeader(hostHeader);
  if (!name) return true;
  if (isLoopbackName(name)) return true;
  return extraHosts.some((e) => parseHostHeader(e) === name);
}

/**
 * A missing Origin (non-browser client) is allowed. Otherwise the origin's
 * hostname must be loopback, or the origin must be in the allow-list ('*' allows all).
 */
export function isAllowedOrigin(origin: string | undefined, extraOrigins: string[] = []): boolean {
  if (!origin) return true;
  if (extraOrigins.includes('*') || extraOrigins.includes(origin)) return true;
  try {
    return isLoopbackName(parseHostHeader(new URL(origin).host));
  } catch {
    return false;
  }
}

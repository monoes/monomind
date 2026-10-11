/**
 * sse-manager.mjs — SSE client registries and broadcasting
 *
 * Owns the two SSE client Sets that were previously module-level state in
 * server.mjs:
 *   - sseClients    — general dashboard stream (/api/stream)
 *   - mmSseClients  — mastermind real-time event stream (/api/mastermind-stream)
 *
 * Extracted from server.mjs as Module 1 of the modularization plan.
 * See MODULARIZATION_PLAN.md for the full extraction sequence.
 */

// ── SSE client registries ─────────────────────────────────────────────────────

/** Connected clients for the general /api/stream SSE endpoint. */
const sseClients = new Set();

/** Connected clients for the /api/mastermind-stream SSE endpoint. */
const mmSseClients = new Set();

/**
 * Most bytes a client may have queued and unsent before it is dropped (#477).
 * res.write() does not throw for a peer that stopped reading (a suspended
 * laptop, a frozen tab), so every broadcast used to queue on its socket in this
 * process's memory for as long as the connection stayed open.
 */
export const MAX_SSE_BACKLOG_BYTES = 1024 * 1024;

/**
 * Write one SSE message to `client`, dropping it from `registry` (and closing
 * it) when it is gone, the write fails, or it has more than
 * MAX_SSE_BACKLOG_BYTES unsent.
 * @param {import('http').ServerResponse} client
 * @param {string} msg
 * @param {Set<import('http').ServerResponse>} registry
 * @returns {boolean} false when the client was dropped
 */
export function writeSse(client, msg, registry) {
  try {
    if (client.destroyed || client.writableEnded) throw new Error('closed');
    if (client.writableLength > MAX_SSE_BACKLOG_BYTES) {
      client.destroy();
      throw new Error('backlog');
    }
    client.write(msg);
    return true;
  } catch {
    registry.delete(client);
    return false;
  }
}

export const SSE_KEEPALIVE_MS = 25000;
let _keepaliveTimer = null;
/**
 * Comment-line ping to idle clients so proxies and half-dead sockets surface as write
 * errors (and are dropped by writeSse). Started on the first client, stopped when none remain.
 */
function ensureKeepalive() {
  if (_keepaliveTimer) return;
  _keepaliveTimer = setInterval(() => {
    for (const registry of [sseClients, mmSseClients]) {
      for (const client of registry) writeSse(client, ': ping\n\n', registry);
    }
    if (sseClients.size === 0 && mmSseClients.size === 0) {
      clearInterval(_keepaliveTimer);
      _keepaliveTimer = null;
    }
  }, SSE_KEEPALIVE_MS);
  _keepaliveTimer.unref();
}

/** End every response in `registry` and empty it. */
function endAll(registry) {
  for (const client of registry) {
    try {
      client.end();
    } catch {
      // Already ended
    }
  }
  registry.clear();
}

/**
 * Close every SSE connection in this process: the general and mastermind
 * streams plus the per-org registries passed in (runStreamClients' Sets).
 * shutdown() used to end only the general stream; the still-open mastermind
 * and org streams kept server.close() from ever finishing (#477).
 * @param {Iterable<Set<import('http').ServerResponse>>} [extraRegistries]
 */
export function closeAllSseClients(extraRegistries = []) {
  endAll(sseClients);
  endAll(mmSseClients);
  for (const registry of extraRegistries) endAll(registry);
}

// ── General SSE (sseClients) ──────────────────────────────────────────────────

/**
 * Register a response object as a general SSE client.
 * @param {import('http').ServerResponse} res
 */
export function addSseClient(res) {
  sseClients.add(res);
  ensureKeepalive();
}

/**
 * Remove a response object from the general SSE client registry.
 * @param {import('http').ServerResponse} res
 */
export function removeSseClient(res) {
  sseClients.delete(res);
}

/**
 * Broadcast a data payload to all connected general SSE clients.
 * Silently removes clients that have disconnected.
 * @param {object} data
 */
export function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) writeSse(client, msg, sseClients);
}

/**
 * Return the number of connected general SSE clients.
 * @returns {number}
 */
export function getSseClientCount() {
  return sseClients.size;
}

/**
 * Close all general SSE connections (called on server shutdown).
 */
export function closeSseClients() {
  endAll(sseClients);
}

// ── Mastermind SSE (mmSseClients) ─────────────────────────────────────────────

/**
 * Register a response object as a mastermind SSE client.
 * @param {import('http').ServerResponse} res
 */
export function addMmClient(res) {
  mmSseClients.add(res);
  ensureKeepalive();
}

/**
 * Remove a response object from the mastermind SSE client registry.
 * @param {import('http').ServerResponse} res
 */
export function removeMmClient(res) {
  mmSseClients.delete(res);
}

/**
 * Broadcast a raw JSON-stringified event line to all mastermind SSE clients.
 * Accepts a pre-serialized string (to match the JSONL-replay path in server.mjs
 * which passes raw line strings) or a data object (auto-serialized).
 * @param {string|object} lineOrData
 */
export function broadcastMm(lineOrData) {
  const line = typeof lineOrData === 'string' ? lineOrData : JSON.stringify(lineOrData);
  const msg = `data: ${line}\n\n`;
  for (const c of mmSseClients) writeSse(c, msg, mmSseClients);
}

/**
 * Return the number of connected mastermind SSE clients.
 * @returns {number}
 */
export function getMmClientCount() {
  return mmSseClients.size;
}

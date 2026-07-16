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

// ── General SSE (sseClients) ──────────────────────────────────────────────────

/**
 * Register a response object as a general SSE client.
 * @param {import('http').ServerResponse} res
 */
export function addSseClient(res) {
  sseClients.add(res);
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
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
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
  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      // Already ended
    }
  }
  sseClients.clear();
}

// ── Mastermind SSE (mmSseClients) ─────────────────────────────────────────────

/**
 * Register a response object as a mastermind SSE client.
 * @param {import('http').ServerResponse} res
 */
export function addMmClient(res) {
  mmSseClients.add(res);
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
  for (const c of mmSseClients) {
    try {
      c.write(msg);
    } catch {
      mmSseClients.delete(c);
    }
  }
}

/**
 * Return the number of connected mastermind SSE clients.
 * @returns {number}
 */
export function getMmClientCount() {
  return mmSseClients.size;
}

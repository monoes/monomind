/**
 * Parse a JSON string from a DB column (or any string source) without throwing.
 * Returns `fallback` for null/undefined/empty input or any parse error.
 *
 * Used to guard the 9+ sites that read `properties` / `evidence` / `closed_values`
 * blobs — a single corrupted row would otherwise crash the entire query response.
 * Failures are logged to stderr when MONOMIND_DEBUG is set, so poisoned blobs are
 * discoverable without taking down the request.
 */
export function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch (err) {
    if (process.env.MONOMIND_DEBUG) {
      // eslint-disable-next-line no-console
      console.error(
        `[monograph] safeJsonParse: failed to parse (${String(err)}); input length=${s.length}`,
      );
    }
    return fallback;
  }
}

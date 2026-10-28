export const defaults = { retries: 3, timeoutMs: 5000 };

export function loadConfig(overrides = {}) {
  return { ...defaults, ...overrides };
}

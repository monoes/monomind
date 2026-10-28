import { loadConfig } from './config.mjs';

export async function request(send, overrides) {
  const config = loadConfig(overrides);
  let lastError;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      return await send(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

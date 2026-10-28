import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './src/config.mjs';

test('timeout default', () => {
  assert.equal(loadConfig().timeoutMs, 5000);
});

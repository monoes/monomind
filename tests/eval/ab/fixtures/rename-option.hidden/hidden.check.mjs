import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseArgs } from './src/cli.mjs';
import { request } from './src/client.mjs';
import { defaults, loadConfig } from './src/config.mjs';
import { createQueue } from './src/queue.mjs';

test('the option is called maxRetries everywhere', () => {
  assert.equal(defaults.maxRetries, 3);
  assert.equal(loadConfig({ maxRetries: 1 }).maxRetries, 1);
  assert.equal(createQueue({ maxRetries: 7 }).describe(), 'queue with 7 retries');
  assert.equal(parseArgs(['--retries', '9']).maxRetries, 9);
});

test('the client retries maxRetries times', async () => {
  let calls = 0;
  await assert.rejects(
    request(
      async () => {
        calls++;
        throw new Error('boom');
      },
      { maxRetries: 2 },
    ),
  );
  assert.equal(calls, 3);
});

test('no source still reads the old option name', () => {
  for (const f of ['config', 'client', 'queue', 'cli']) {
    const src = readFileSync(new URL(`./src/${f}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\.retries\b|\bretries:/, `${f}.mjs still uses retries`);
  }
});

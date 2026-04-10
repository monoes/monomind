#!/usr/bin/env node
/**
 * Monobrain CLI - Umbrella entry point
 * Proxies to @monobrain/cli bin for cross-platform compatibility.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', 'packages', '@monobrain', 'cli', 'bin', 'cli.js');
await import(pathToFileURL(cliPath).href);

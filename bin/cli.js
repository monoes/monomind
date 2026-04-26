#!/usr/bin/env node
/**
 * Monomind CLI - Umbrella entry point
 * Proxies to @monomind/cli bin for cross-platform compatibility.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', 'packages', '@monomind', 'cli', 'bin', 'cli.js');
await import(pathToFileURL(cliPath).href);

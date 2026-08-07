/**
 * Monograph MCP Tools — backward-compatibility barrel.
 *
 * All tool definitions live in ./monograph/ subdirectory.
 * This file re-exports the public API for existing importers.
 */

export { monographTools, allMonographTools, preferSymbolHits } from './monograph/index.js';

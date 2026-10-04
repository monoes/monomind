// packages/@monomind/cli/src/orgrt/documents/index.ts
// The document tool surface of a run (plan P3.6): the runtime, the host a session gets, and the tools.
export { DocAccess, type ReadLevel, type TypeRole } from './access.js';
export type { DocumentToolHost } from './host.js';
export { bindingsFromDef, DocumentsRuntime, openDocumentsRuntime } from './runtime.js';
export { errorRemedy, TOOL_ERROR_CODES } from './tool-errors.js';
export { documentTools } from './tools-core.js';

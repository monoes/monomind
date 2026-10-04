// packages/@monomind/cli/src/orgrt/documents/index.ts
// The document tool surface of a run (plan P3.6): the runtime, the host a session gets, and the tools.
export { DocAccess, type ReadLevel, type TypeRole } from './access.js';
export { RUNTIME_SENDER, type RuntimeDeliver, sendRuntimeMessage } from './deliver.js';
export type { DocumentToolHost } from './host.js';
export { type DocFact, NoticeEngine, type NoticeSink } from './notices.js';
export type { RelayFact } from './relay.js';
export { bindingsFromDef, DocumentsRuntime, openDocumentsRuntime } from './runtime.js';
export { errorRemedy, TOOL_ERROR_CODES } from './tool-errors.js';
export { documentTools } from './tools-core.js';

// Node handler registry — aggregates all service and utility node handlers.
// Usage:
//   import { createNodeHandlers } from '@monoes/monoplaybook';
//   const handlers = createNodeHandlers();
//   const result = await runWorkflow(def, { handlers });
import type { NodeHandler } from './engine/index.js';
import { register as registerGoogleDrive } from './nodes/google-drive.js';
import { register as registerGmail } from './nodes/gmail.js';
import { register as registerGitHub } from './nodes/github.js';
import { register as registerGoogleSheets } from './nodes/google-sheets.js';
import { register as registerHttp } from './nodes/http.js';

/**
 * Create a Map of all node handlers provided by monoplaybook.
 * Pass the result to runWorkflow() as the `handlers` option to enable
 * service nodes (google_drive, gmail, github, google_sheets, http.request).
 */
export function createNodeHandlers(): Map<string, NodeHandler> {
  const handlers = new Map<string, NodeHandler>();
  registerGoogleDrive(handlers);
  registerGmail(handlers);
  registerGitHub(handlers);
  registerGoogleSheets(handlers);
  registerHttp(handlers);
  return handlers;
}

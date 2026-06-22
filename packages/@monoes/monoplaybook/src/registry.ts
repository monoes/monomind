// Node handler registry — aggregates all service and utility node handlers.
// Usage:
//   import { createNodeHandlers } from '@monoes/monoplaybook';
//   const handlers = createNodeHandlers();
//   const result = await runPlaybook(def, { handlers });
import type { NodeHandler } from './engine/index.js';
import { register as registerCore } from './nodes/core.js';
import { register as registerGoogleDrive } from './nodes/google-drive.js';
import { register as registerGmail } from './nodes/gmail.js';
import { register as registerGitHub } from './nodes/github.js';
import { register as registerGoogleSheets } from './nodes/google-sheets.js';
import { register as registerHttp } from './nodes/http.js';
import { register as registerNotion } from './nodes/notion.js';
import { register as registerLinear } from './nodes/linear.js';
import { register as registerAirtable } from './nodes/airtable.js';
import { register as registerStripe } from './nodes/stripe.js';
import { register as registerComm } from './nodes/comm.js';
import { register as registerData } from './nodes/data.js';

/**
 * Create a Map of all node handlers provided by monoplaybook.
 * Pass the result to runPlaybook() as the `handlers` option to enable
 * core transforms (aggregate, sort, limit, switch, merge, remove_duplicates,
 * code, wait, split_in_batches, stop_error, compare_datasets) and service
 * nodes (google_drive, gmail, github, google_sheets, http.request,
 * notion, linear, airtable, stripe, comm.*, data.*).
 */
export function createNodeHandlers(): Map<string, NodeHandler> {
  const handlers = new Map<string, NodeHandler>();
  registerCore(handlers);
  registerGoogleDrive(handlers);
  registerGmail(handlers);
  registerGitHub(handlers);
  registerGoogleSheets(handlers);
  registerHttp(handlers);
  registerNotion(handlers);
  registerLinear(handlers);
  registerAirtable(handlers);
  registerStripe(handlers);
  registerComm(handlers);
  registerData(handlers);
  return handlers;
}

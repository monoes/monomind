import type { ExecErrorCode } from './agent-exec-errors.js';
/** Trusted runner diagnostics; provider/model text cannot assign a protocol code. */
export class RunnerTransportError extends Error {
  constructor(
    readonly code: ExecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunnerTransportError';
  }
}

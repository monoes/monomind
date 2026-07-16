import type { PipelineContext } from '../../types.js';

/**
 * One side of a cross-language bridge boundary — a definition (the thing being
 * exposed across the boundary) or a call site (the thing invoking across it).
 * `key` is the string both sides are matched on: an exact symbol name for
 * codegen-based bridges (Wails, wasm-bindgen), or a string-literal channel/
 * command name for registration-based bridges (Tauri, Electron IPC).
 */
export interface BridgeEndpoint {
  key: string;
  nodeId: string;
  language: string;
}

/**
 * A cross-language bridge adapter. Each adapter independently extracts
 * (key, nodeId) pairs from both sides of one specific FFI/IPC/RPC boundary;
 * the bridge-resolver phase matches them by key and emits CALLS edges.
 *
 * `detect` must be cheap — it runs for every adapter on every build, so an
 * adapter whose framework isn't present in the repo should bail out fast
 * (e.g. checking file paths already collected by the scan phase) rather than
 * re-reading the filesystem.
 */
export interface BridgeAdapter {
  name: string;
  detect(ctx: PipelineContext, filePaths: string[]): boolean;
  findDefinitions(ctx: PipelineContext, filePaths: string[]): BridgeEndpoint[];
  findCallSites(ctx: PipelineContext, filePaths: string[]): BridgeEndpoint[];
}

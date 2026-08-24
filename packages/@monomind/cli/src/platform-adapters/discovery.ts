/** Read-only availability probes for adapters whose layouts must be discovered. */

import { existsSync } from 'node:fs';
import type { DiscoveryResult, PlatformAdapter, PlatformId } from './types.js';

export interface DiscoveryEnvironment {
  /** Explicit configuration paths supplied by the caller's environment. */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Injectable for deterministic callers and tests. This function must be read-only. */
  exists?: (path: string) => boolean;
}

const CONFIG_PATH_VARIABLES: Partial<Record<PlatformId, string>> = {
  trae: 'TRAE_CONFIG_PATH',
  hermes: 'HERMES_CONFIG_PATH',
  antigravity: 'ANTIGRAVITY_CONFIG_PATH',
  zed: 'ZED_CONFIG_PATH',
};

/**
 * Reports whether an explicitly configured platform surface exists. It never
 * creates files, derives fallback paths, or treats a configuration file as an
 * artifact location; renderers must still validate any locations they use.
 */
export function discover(
  adapter: PlatformAdapter,
  options: DiscoveryEnvironment = {},
): DiscoveryResult {
  if (!adapter.requiresDiscovery) {
    return {
      available: false,
      paths: {},
      features: new Set(),
      verification: {},
      diagnostics: [`${adapter.id}: discovery is not required`],
    };
  }

  const variable = CONFIG_PATH_VARIABLES[adapter.id];
  if (!variable) {
    return {
      available: false,
      paths: {},
      features: new Set(),
      verification: {},
      diagnostics: [`${adapter.id}: no explicit discovery variable is configured`],
    };
  }

  const configuredPath = (options.environment ?? process.env)[variable];
  if (!configuredPath?.trim()) {
    return {
      available: false,
      paths: {},
      features: new Set(),
      verification: {},
      diagnostics: [`${adapter.id}: ${variable} must name an existing configuration path`],
    };
  }

  const exists = options.exists ?? existsSync;
  if (!exists(configuredPath)) {
    return {
      available: false,
      paths: {},
      features: new Set(),
      verification: {},
      diagnostics: [`${adapter.id}: ${variable} does not exist`],
    };
  }

  return {
    available: true,
    paths: { config: configuredPath },
    features: new Set(),
    verification: {},
    diagnostics: [
      `${adapter.id}: explicit configuration path is available; artifact locations require renderer validation`,
    ],
  };
}

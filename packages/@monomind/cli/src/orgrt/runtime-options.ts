// packages/@monomind/cli/src/orgrt/runtime-options.ts
/** Data source for the org_list_runtime_options tool. Read-only: wraps
 *  runner-registry.ts's install/version detection and provider.ts's named
 *  provider config, applying the in-process-runtime correction and
 *  credential redaction the design calls for. See
 *  docs/mastermind/specs/2026-09-07-org-runtime-role-respawn-design.md. */
import { listConfiguredProviders } from './provider.js';
import { RUNNER_SPECS, scanInstalled } from './runner-registry.js';

export interface RuntimeOption {
  id: string;
  available: boolean;
  binary?: string;
  version?: string;
  installHint?: string;
}

export interface NamedProviderOption {
  name: string;
  defaultModel?: string;
}

export interface RuntimeOptionsReceipt {
  runtimes: RuntimeOption[];
  namedProviders: NamedProviderOption[];
}

export async function buildRuntimeOptions(searchFrom?: string): Promise<RuntimeOptionsReceipt> {
  const scan = await scanInstalled();
  const specById = new Map(RUNNER_SPECS.map((s) => [s.id, s]));
  const runtimes: RuntimeOption[] = scan.agents.map((entry) => {
    const spec = specById.get(entry.id as (typeof RUNNER_SPECS)[number]['id']);
    // In-process runtimes (spec.binary === null, e.g. vercel) have nothing to
    // find on PATH — scanInstalled's installed:false for them is a false
    // negative ("not installed"), not a real unavailability signal.
    const available = spec?.binary === null ? true : entry.installed;
    return {
      id: entry.id,
      available,
      ...(entry.binary ? { binary: entry.binary } : {}),
      ...(entry.version ? { version: entry.version } : {}),
      ...(entry.install_hint ? { installHint: entry.install_hint } : {}),
    };
  });
  const namedProviders: NamedProviderOption[] = listConfiguredProviders(searchFrom).map((p) => ({
    name: p.name,
    ...(p.model ? { defaultModel: p.model } : {}),
  }));
  return { runtimes, namedProviders };
}

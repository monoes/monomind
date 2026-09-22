/**
 * Doctor — Jev decision-model check. The full doctor run only inspects
 * configuration (no network); `doctor -c jev` probes each provider.
 */
import { jevModule } from '../decision/jev.js';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Decision Model (Jev)';

/** The full doctor run's row: none at all unless the operator set Jev env,
 *  so an unconfigured run is unchanged. */
export async function checkDecisionModelIfConfigured(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HealthCheck[]> {
  const touched = ['MONOMIND_JEV_URL', 'MONOMIND_JEV_HOSTED', 'MONOMIND_JEV'].some((k) =>
    env[k]?.trim(),
  );
  return touched ? [await checkDecisionModel({ env })] : [];
}

export async function checkDecisionModel(
  opts: { probe?: boolean; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<HealthCheck> {
  const env = opts.env ?? process.env;
  const jp = jevModule();
  if (!jp) {
    return {
      name: NAME,
      status: 'warn',
      message:
        'jev-picker.cjs is missing from the monomind package, so the decision model is never used',
      fix: 'Reinstall monomind (npm i -g monomind@latest)',
    };
  }
  if (jp.isDisabled(env))
    return { name: NAME, status: 'info', message: 'Disabled (MONOMIND_JEV=off)' };
  if (env.MONOMIND_JEV_URL?.trim() && !jp.normalizeBaseUrl(env.MONOMIND_JEV_URL)) {
    return {
      name: NAME,
      status: 'warn',
      message: 'MONOMIND_JEV_URL is not a usable http(s) URL and is ignored',
      fix: 'export MONOMIND_JEV_URL=http://127.0.0.1:3000',
    };
  }
  const providers = jp.resolveProviders(env);
  if (providers.length === 0) {
    return {
      name: NAME,
      status: 'info',
      message: env.TYPESAFE_API_KEY?.trim()
        ? 'Not configured: TYPESAFE_API_KEY is set but hosted Jev needs MONOMIND_JEV_HOSTED=1'
        : 'Not configured: agents and skills are picked by keywords and embeddings',
    };
  }
  const chain = providers.map((p) => `${p.name} (${p.baseUrl})`).join(' → ');
  if (!opts.probe) {
    return {
      name: NAME,
      status: 'pass',
      message: `Configured: ${chain}. Probe with \`doctor -c jev\``,
    };
  }
  const ok: string[] = [];
  const failed: string[] = [];
  for (const provider of providers) {
    try {
      ok.push(`${provider.name} ${await jp.probe(provider, { env, fetchImpl: opts.fetchImpl })}ms`);
    } catch (err) {
      failed.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed.length === 0) return { name: NAME, status: 'pass', message: ok.join(' · ') };
  return {
    name: NAME,
    status: 'warn',
    message: [...ok, ...failed].join(' · '),
    fix:
      ok.length === 0
        ? 'Start the OpenJev helper shim (MONOMIND_JEV_URL) or check TYPESAFE_API_KEY + MONOMIND_JEV_HOSTED; picks fall back to keywords meanwhile'
        : undefined,
  };
}

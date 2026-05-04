export type FallowEmailMode = 'raw' | 'handle' | 'hash';

export interface FallowOwnershipConfig {
  botPatterns: string[];
  emailMode: FallowEmailMode;
}

export interface FallowHealthConfig {
  maxCyclomatic: number;
  maxCognitive: number;
  maxCrap: number;
  ignore: string[];
  ownership: FallowOwnershipConfig;
  suggestInlineSuppression: boolean;
}

export const DEFAULT_BOT_PATTERNS: string[] = [
  '*[bot]*', 'dependabot*', 'renovate*', 'github-actions*', 'svc-*', '*-service-account*',
];

export const DEFAULT_FALLOW_HEALTH_CONFIG: FallowHealthConfig = {
  maxCyclomatic: 20,
  maxCognitive: 15,
  maxCrap: 30.0,
  ignore: [],
  ownership: { botPatterns: DEFAULT_BOT_PATTERNS, emailMode: 'raw' },
  suggestInlineSuppression: false,
};

export function mergeFallowHealthConfig(partial: Partial<FallowHealthConfig>): FallowHealthConfig {
  const base = DEFAULT_FALLOW_HEALTH_CONFIG;
  return {
    maxCyclomatic: partial.maxCyclomatic ?? base.maxCyclomatic,
    maxCognitive: partial.maxCognitive ?? base.maxCognitive,
    maxCrap: partial.maxCrap ?? base.maxCrap,
    ignore: partial.ignore ?? base.ignore,
    suggestInlineSuppression: partial.suggestInlineSuppression ?? base.suggestInlineSuppression,
    ownership: partial.ownership !== undefined
      ? { ...base.ownership, ...partial.ownership }
      : base.ownership,
  };
}

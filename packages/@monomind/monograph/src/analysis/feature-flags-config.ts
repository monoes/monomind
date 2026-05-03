export interface SdkPattern {
  packageName: string;
  displayName: string;
  callPatterns: RegExp[];
}

export const KNOWN_SDK_PATTERNS: SdkPattern[] = [
  {
    packageName: 'launchdarkly-js-client-sdk',
    displayName: 'LaunchDarkly',
    callPatterns: [/ldClient\.variation\s*\(/, /\.variation\s*\(/],
  },
  {
    packageName: '@statsig/js-client',
    displayName: 'Statsig',
    callPatterns: [/\.checkGate\s*\(/, /\.getExperiment\s*\(/, /Statsig\.checkGate/],
  },
  {
    packageName: 'unleash-client',
    displayName: 'Unleash',
    callPatterns: [/\.isEnabled\s*\(/, /unleash\.isEnabled/],
  },
  {
    packageName: '@growthbook/growthbook',
    displayName: 'GrowthBook',
    callPatterns: [/\.isOn\s*\(/, /\.evalFeature\s*\(/, /growthbook\.isOn/],
  },
  {
    packageName: 'configcat-js',
    displayName: 'ConfigCat',
    callPatterns: [/\.getValueAsync\s*\(/, /configcat\.getValue/],
  },
  {
    packageName: 'flagsmith',
    displayName: 'Flagsmith',
    callPatterns: [/flagsmith\.hasFeature\s*\(/, /flagsmith\.getValue\s*\(/],
  },
  {
    packageName: '@splitsoftware/splitio',
    displayName: 'Split',
    callPatterns: [/\.getTreatment\s*\(/, /splitClient\.getTreatment/],
  },
];

export function detectSdkFromPackageJson(deps: Record<string, string>): SdkPattern[] {
  return KNOWN_SDK_PATTERNS.filter(sdk => deps[sdk.packageName] !== undefined);
}

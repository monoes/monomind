export type BoundaryPreset = 'layered' | 'hexagonal' | 'feature-sliced' | 'bulletproof';

export interface BoundaryZoneConfig {
  name: string;
  patterns: string[];
  root?: string;
}

export interface BoundaryRuleConfig {
  from: string;
  allow: string[];
}

export interface BoundaryConfigFallow {
  preset?: BoundaryPreset;
  zones?: BoundaryZoneConfig[];
  rules?: BoundaryRuleConfig[];
}

export interface ResolvedZone {
  name: string;
  patterns: string[];
  root: string;
}

export interface ResolvedBoundaryRule {
  from: ResolvedZone;
  allow: ResolvedZone[];
}

export interface ResolvedBoundaryConfig {
  zones: ResolvedZone[];
  rules: ResolvedBoundaryRule[];
}

function makeZone(name: string, sourceRoot: string, extraPatterns?: string[]): BoundaryZoneConfig {
  return {
    name,
    patterns: extraPatterns ?? [`${sourceRoot}/${name}/**`],
  };
}

function makeRule(from: string, allow: string[]): BoundaryRuleConfig {
  return { from, allow };
}

export function expandPreset(preset: BoundaryPreset, sourceRoot: string): BoundaryConfigFallow {
  switch (preset) {
    case 'layered': {
      const zones = [
        { name: 'presentation', patterns: ['ui', 'pages', 'views', 'components'].map(d => `${sourceRoot}/${d}/**`) },
        { name: 'application', patterns: ['application', 'usecases', 'services'].map(d => `${sourceRoot}/${d}/**`) },
        { name: 'domain', patterns: ['domain', 'entities', 'models'].map(d => `${sourceRoot}/${d}/**`) },
        { name: 'infrastructure', patterns: ['infrastructure', 'adapters', 'repositories', 'db', 'api'].map(d => `${sourceRoot}/${d}/**`) },
      ];
      const rules = [
        makeRule('presentation', ['application']),
        makeRule('application', ['domain']),
        makeRule('domain', []),
        makeRule('infrastructure', ['domain', 'application']),
      ];
      return { zones, rules };
    }
    case 'hexagonal': {
      const zones = [
        { name: 'adapters', patterns: ['adapters', 'ports', 'infrastructure'].map(d => `${sourceRoot}/${d}/**`) },
        { name: 'application', patterns: ['application', 'usecases'].map(d => `${sourceRoot}/${d}/**`) },
        { name: 'domain', patterns: ['domain', 'core'].map(d => `${sourceRoot}/${d}/**`) },
      ];
      const rules = [
        makeRule('adapters', ['application', 'domain']),
        makeRule('application', ['domain']),
        makeRule('domain', []),
      ];
      return { zones, rules };
    }
    case 'feature-sliced': {
      const layers = ['app', 'processes', 'pages', 'widgets', 'features', 'entities', 'shared'];
      const zones = layers.map(name => makeZone(name, sourceRoot));
      const rules = layers.map((name, i) => makeRule(name, layers.slice(i + 1)));
      return { zones, rules };
    }
    case 'bulletproof': {
      const zones: BoundaryZoneConfig[] = [
        makeZone('features', sourceRoot),
        makeZone('components', sourceRoot),
        makeZone('hooks', sourceRoot),
        makeZone('pages', sourceRoot),
        makeZone('routes', sourceRoot),
        makeZone('api', sourceRoot),
        makeZone('lib', sourceRoot),
        makeZone('types', sourceRoot),
        makeZone('config', sourceRoot),
        {
          name: 'shared',
          patterns: ['utils', 'helpers', 'shared', 'common', 'constants', 'models', 'interfaces'].map(d => `${sourceRoot}/${d}/**`),
        },
      ];
      const rules = [
        makeRule('features', ['components', 'hooks', 'pages', 'routes', 'api', 'lib', 'types', 'config', 'shared']),
        makeRule('components', ['hooks', 'lib', 'types', 'config', 'shared']),
      ];
      return { zones, rules };
    }
  }
}

export function resolveBoundaryConfig(
  config: BoundaryConfigFallow,
  sourceRoot: string,
): ResolvedBoundaryConfig {
  let baseZones: BoundaryZoneConfig[] = [];
  let baseRules: BoundaryRuleConfig[] = [];

  if (config.preset) {
    const expanded = expandPreset(config.preset, sourceRoot);
    baseZones = expanded.zones ?? [];
    baseRules = expanded.rules ?? [];
  }

  const customZones = config.zones ?? [];
  const customRules = config.rules ?? [];

  const zoneMap = new Map<string, BoundaryZoneConfig>();
  for (const z of [...baseZones, ...customZones]) {
    zoneMap.set(z.name, z);
  }

  const ruleMap = new Map<string, BoundaryRuleConfig>();
  for (const r of [...baseRules, ...customRules]) {
    ruleMap.set(r.from, r);
  }

  const resolvedZones: ResolvedZone[] = Array.from(zoneMap.values()).map(z => ({
    name: z.name,
    patterns: z.patterns,
    root: z.root ?? sourceRoot,
  }));

  const zoneByName = new Map<string, ResolvedZone>(resolvedZones.map(z => [z.name, z]));

  const resolvedRules: ResolvedBoundaryRule[] = [];
  for (const rule of ruleMap.values()) {
    const fromZone = zoneByName.get(rule.from);
    if (!fromZone) continue;
    const allowZones = rule.allow.map(name => zoneByName.get(name)).filter((z): z is ResolvedZone => z !== undefined);
    resolvedRules.push({ from: fromZone, allow: allowZones });
  }

  return { zones: resolvedZones, rules: resolvedRules };
}

export function classifyZone(
  resolved: ResolvedBoundaryConfig,
  filePath: string,
): string | undefined {
  for (const zone of resolved.zones) {
    for (const pattern of zone.patterns) {
      const prefix = pattern.replace('/**', '').replace('**', '');
      if (filePath.includes(prefix)) {
        return zone.name;
      }
    }
  }
  return undefined;
}

export function isImportAllowed(
  resolved: ResolvedBoundaryConfig,
  fromPath: string,
  toPath: string,
): boolean {
  const fromZoneName = classifyZone(resolved, fromPath);
  const toZoneName = classifyZone(resolved, toPath);

  if (!fromZoneName || !toZoneName) return true;
  if (fromZoneName === toZoneName) return true;

  const rule = resolved.rules.find(r => r.from.name === fromZoneName);
  if (!rule) return true;

  return rule.allow.some(z => z.name === toZoneName);
}

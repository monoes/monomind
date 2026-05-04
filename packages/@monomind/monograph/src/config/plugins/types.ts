export interface BuiltinPlugin {
  name: string;
  configPatterns: string[];
  toolingPackages?: string[];
  entryPatterns?: string[];
  typesPackages?: string[];
}

export interface PluginRegistry {
  getConfigPatterns(installedPackages: string[]): string[];
  getToolingPackages(installedPackages: string[]): string[];
  getEntryPatterns(installedPackages: string[]): string[];
  isAlwaysUsed(filePath: string, installedPackages: string[]): boolean;
}

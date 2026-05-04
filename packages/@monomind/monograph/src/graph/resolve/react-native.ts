const REACT_NATIVE_PLUGINS = ['react-native', 'expo', '@react-native'];
const BASE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const RN_SUFFIXES = ['.native', '.ios', '.android', '.web'];
const BASE_CONDITIONS = ['import', 'require', 'default'];
const RN_CONDITIONS = ['react-native', 'browser', 'module'];

export function hasReactNativePlugin(activePlugins: string[]): boolean {
  return activePlugins.some(p => REACT_NATIVE_PLUGINS.some(rn => p.includes(rn)));
}

export function buildExtensions(activePlugins: string[]): string[] {
  if (!hasReactNativePlugin(activePlugins)) return BASE_EXTENSIONS;
  const rnExts: string[] = [];
  for (const suffix of RN_SUFFIXES) {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      rnExts.push(suffix + ext);
    }
  }
  return [...rnExts, ...BASE_EXTENSIONS];
}

export function buildConditionNames(activePlugins: string[], extraConditions: string[]): string[] {
  const conditions = [...BASE_CONDITIONS];
  if (hasReactNativePlugin(activePlugins)) conditions.unshift(...RN_CONDITIONS);
  conditions.push(...extraConditions);
  return [...new Set(conditions)];
}

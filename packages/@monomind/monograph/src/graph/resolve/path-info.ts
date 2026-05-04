const PATH_ALIAS_PREFIXES = ['@/', '~/', '#', '@@/'];
const PASCAL_SCOPE_RE = /^@[A-Z]/;
const PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

export function isPathAlias(specifier: string): boolean {
  for (const prefix of PATH_ALIAS_PREFIXES) {
    if (specifier.startsWith(prefix)) return true;
  }
  return PASCAL_SCOPE_RE.test(specifier);
}

export function isBareSpecifier(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
  if (specifier.startsWith('node:') || specifier.startsWith('bun:')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return false;
  return true;
}

export function isValidPackageName(name: string): boolean {
  return PACKAGE_NAME_RE.test(name);
}

export function extractPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0];
}

export function extractPackageNameFromNodeModulesPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const after = normalized.slice(idx + 'node_modules/'.length);
  if (after.startsWith('@')) {
    const parts = after.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return after.split('/')[0] || null;
}

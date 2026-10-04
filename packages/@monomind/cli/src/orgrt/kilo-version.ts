/** Native events and settings were verified against this exact upstream CLI. */
export const KILO_SUPPORTED_VERSION = '7.8.3';
export function kiloVersionRefusal(version: string | null): string | undefined {
  if (version?.trim() === KILO_SUPPORTED_VERSION) return undefined;
  if (!version)
    return 'Kilo CLI version is unverified. Run monomind agent scan --probe to verify 7.8.3, or install @kilocode/cli@7.8.3.';
  return `Kilo requires verified CLI 7.8.3; found ${version.trim()}. Install @kilocode/cli@7.8.3 or use another verified runtime.`;
}

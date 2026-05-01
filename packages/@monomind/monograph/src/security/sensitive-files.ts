import { basename as pathBasename } from 'path';

const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env(\.|$)/i,
  /^\.netrc$/i,
  /\baws_credentials\b/i,
  /\bcredentials?\b.*\.(json|yaml|yml|toml|ini|cfg)$/i,
  /\bsecrets?\b.*\.(json|yaml|yml|toml|ini|cfg)$/i,
  /\bsecret[_-]?key\b/i,
  /\bapi[_-]?key\b.*\.(json|txt)$/i,
  /\bpasswd\b/i,
  /\bpassword[s]?\b.*\.(txt|json|yaml|yml)$/i,
  /\btoken\b.*\.(txt|json|env)$/i,
  /\b(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/i,
  /\.(pem|key|pfx|p12|p8|pkcs8)$/i,
  /\bservice[_-]?account\b.*\.json$/i,
  /\bkeystore\b/i,
  /\bvault[_-]?token\b/i,
];

export function isSensitiveFile(filePath: string): boolean {
  const base = pathBasename(filePath);
  return SENSITIVE_PATTERNS.some(p => p.test(base) || p.test(filePath));
}

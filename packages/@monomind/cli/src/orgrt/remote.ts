// packages/@monomind/cli/src/orgrt/remote.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ORG_DIR } from './types.js';

export interface RemoteHost {
  host: string;
  port?: number;
  user?: string;
  /** Remote project directory (where .monomind/orgs lives) */
  cwd: string;
  /** SSH identity file (optional, uses default otherwise) */
  identityFile?: string;
}

export interface RemoteRegistry {
  hosts: Record<string, RemoteHost>;
}

const REMOTE_FILE = 'remote-hosts.json';

/** Load the remote host registry from the org directory. */
export function loadRemoteRegistry(projectRoot: string): RemoteRegistry {
  const p = join(projectRoot, ORG_DIR, REMOTE_FILE);
  if (!existsSync(p)) return { hosts: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RemoteRegistry;
  } catch {
    return { hosts: {} };
  }
}

/** Look up which remote host (if any) is registered for the given org name. */
export function lookupRemoteOrg(name: string, projectRoot: string): RemoteHost | null {
  const registry = loadRemoteRegistry(projectRoot);
  return registry.hosts[name] ?? null;
}

/** Build the SSH command parts for a remote host. */
function sshArgs(host: RemoteHost): string[] {
  const args: string[] = [];
  if (host.identityFile) args.push('-i', host.identityFile);
  if (host.port) args.push('-p', String(host.port));
  args.push('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10');
  const target = host.user ? `${host.user}@${host.host}` : host.host;
  args.push(target);
  return args;
}

/** Deliver a message to a remote org via SSH-tunneled CLI invocation.
 *  Executes `monomind org inbox <name>` on the remote host. */
export async function deliverRemote(
  orgName: string,
  from: string,
  subject: string,
  body: string,
  host: RemoteHost,
): Promise<{ ok: boolean; output: string }> {
  const { execSync } = await import('node:child_process');
  const payload = JSON.stringify({ from, subject, body });
  const remoteCmd = `cd ${JSON.stringify(host.cwd)} && npx monomind org inbox ${orgName} --json ${JSON.stringify(payload)}`;
  const args = sshArgs(host);
  args.push(remoteCmd);
  try {
    const output = execSync(`ssh ${args.map(a => JSON.stringify(a)).join(' ')}`, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { ok: true, output };
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr || (err as Error).message;
    return { ok: false, output: String(msg).trim() };
  }
}

/** Check if a remote host is reachable via SSH (connectivity test). */
export async function pingRemote(host: RemoteHost): Promise<boolean> {
  const { execSync } = await import('node:child_process');
  const args = sshArgs(host);
  args.push('echo ok');
  try {
    execSync(`ssh ${args.map(a => JSON.stringify(a)).join(' ')}`, {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

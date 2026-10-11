import fs from 'node:fs';
import path from 'node:path';
import { lookupOrg, removeOperatorCredential } from '../orgrt/broker.js';
import { writeFileAtomic } from './org-hil.mjs';
import { orgIsRunning, orgSignatureState } from './org-runtime.mjs';
import { readBodyOrReply } from './routes-org-helpers.mjs';

// Org dashboard routes: org delete, stop and copy.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgLifecycleRoutes(req, res, url, corsOrigin, ctx) {
  // DELETE /api/orgs/:name — delete an org config and all associated data files
  if (req.method === 'DELETE' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}(\?.*)?$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _delOrgQs = new URL(req.url, 'http://localhost').searchParams;
      const _delRoot = path.resolve(_delOrgQs.get('dir') || ctx.projectDir || process.cwd());
      const orgsDir = path.join(_delRoot, '.monomind', 'orgs');
      const configFile = path.join(orgsDir, `${orgName}.json`);
      const v1ConfigFile = path.join(orgsDir, `${orgName}.v1.json`);
      if (!fs.existsSync(configFile) && !fs.existsSync(v1ConfigFile)) {
        res.writeHead(404);
        res.end('{"error":"org not found"}');
        return true;
      }
      if (orgIsRunning(_delRoot, orgName)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `org "${orgName}" is running — stop it before deleting` }));
        return true;
      }
      // Remove all org-associated files (config + state + data)
      try {
        if (fs.existsSync(v1ConfigFile)) fs.unlinkSync(v1ConfigFile);
      } catch (_) {}
      const suffixes = [
        '',
        '-state',
        '-goals',
        '-routines',
        '-approvals',
        '-activity',
        '-issues',
        '-members',
        '-projects',
        '-workspaces',
        '-worktrees',
        '-environments',
        '-plugins',
        '-adapters',
        '-budgets',
        '-threads',
        '-secrets',
        '-join-requests',
        '-bootstrap',
        '-project-workspaces',
        '-approval-comments',
        '-skills',
      ];
      for (const suf of suffixes) {
        const f = path.join(orgsDir, `${orgName}${suf}.json`);
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch (_) {}
        const fjsonl = path.join(orgsDir, `${orgName}${suf}.jsonl`);
        try {
          if (fs.existsSync(fjsonl)) fs.unlinkSync(fjsonl);
        } catch (_) {}
      }
      // Remove stop file if present
      try {
        fs.unlinkSync(path.join(orgsDir, '.stops', `${orgName}.stop`));
      } catch (_) {}
      // Remove org subdirectory under .monomind/orgs/ (legacy flat-file location)
      try {
        const orgWorkDir = path.join(orgsDir, orgName);
        if (fs.existsSync(orgWorkDir)) fs.rmSync(orgWorkDir, { recursive: true, force: true });
      } catch (_) {}
      // Remove org subdirectory under git-safe location (.git/monomind/orgs/<name>/) so run
      // files written by the worktree-aware path (feat 880f034e) are also cleaned up on delete
      try {
        const _delWorkDir = path.resolve(_delOrgQs.get('dir') || ctx.projectDir || process.cwd());
        const _delGitMonoDir = ctx._getGitMonomindDir(_delWorkDir);
        if (_delGitMonoDir) {
          const gitOrgDir = path.join(_delGitMonoDir, 'orgs', orgName);
          if (fs.existsSync(gitOrgDir)) fs.rmSync(gitOrgDir, { recursive: true, force: true });
        }
      } catch (_) {}
      // Remove loop prompt file if present (created for scheduled orgs by createorg)
      try {
        const lpf = path.join(
          path.resolve(ctx.projectDir || process.cwd()),
          '.monomind',
          'loops',
          `${orgName}.md`,
        );
        if (fs.existsSync(lpf)) fs.unlinkSync(lpf);
      } catch (_) {}
      // A daemon that died without cleaning up leaves its operator credential
      // behind (~/.monomind/orgrt-operator/<org>.json). It is keyed by name
      // alone, so it goes only when no daemon is registered for that name.
      try {
        if (!lookupOrg(orgName)) removeOperatorCredential(orgName);
      } catch (_) {}
      // Emit org:delete event
      const deleteEvent = { type: 'org:delete', org: orgName, ts: Date.now() };
      ctx
        .appendToFile(
          path.join(ctx.projectDir || process.cwd(), 'data', 'mastermind-events.jsonl'),
          `${JSON.stringify(deleteEvent)}\n`,
        )
        .catch(() => {});
      ctx.broadcastMm(deleteEvent);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end('{"ok":true}');
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // POST /api/orgs/:name/stop — send stop signal to a running org
  if (req.method === 'POST' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/stop$/i)) {
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('Invalid org name');
        return true;
      }
      const _stopOrgQs = new URL(req.url, 'http://localhost').searchParams;
      const _stopOrgBase = path.resolve(_stopOrgQs.get('dir') || ctx.projectDir || process.cwd());
      const stopEvent = { type: 'org:stop', org: orgName, ts: Date.now() };
      const dataDir = path.join(_stopOrgBase, 'data');
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (_) {}
      ctx
        .appendToFile(
          path.join(dataDir, 'mastermind-events.jsonl'),
          `${JSON.stringify(stopEvent)}\n`,
        )
        .catch(() => {});
      // Write stop marker file at the path the REAL stop mechanisms poll:
      // `org run`'s own poll loop and `org serve`'s pollStopfiles() both watch
      // .monomind/orgs/<name>/stop (see clearStopfile/stopAction/pollStopfiles in
      // commands/org.ts) — NOT .monomind/orgs/.stops/<name>.stop, which nothing
      // in the CLI/daemon ever reads.
      try {
        const stopDir = path.join(_stopOrgBase, '.monomind', 'orgs', orgName);
        fs.mkdirSync(stopDir, { recursive: true });
        fs.writeFileSync(path.join(stopDir, 'stop'), new Date().toISOString());
      } catch (_) {}
      ctx.broadcastMm(stopEvent);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end('{"ok":true}');
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // POST /api/orgs/:name/copy — copy org config to another project directory
  if (req.method === 'POST' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/copy$/i)) {
    const body = await readBodyOrReply(req, res, 2097152, corsOrigin);
    if (body === null) return true;
    try {
      const orgName = decodeURIComponent(url.split('/')[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid org name' }));
        return true;
      }
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch (_) {}
      const destination = payload.destination ? String(payload.destination).trim() : '';
      if (!destination) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'destination is required' }));
        return true;
      }
      if (!path.isAbsolute(destination)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'destination must be an absolute path' }));
        return true;
      }
      const _copyOrgQs = new URL(req.url, 'http://localhost').searchParams;
      const srcOrgsDir = path.join(
        path.resolve(_copyOrgQs.get('dir') || ctx.projectDir || process.cwd()),
        '.monomind',
        'orgs',
      );
      const srcFile = path.join(srcOrgsDir, `${orgName}.json`);
      if (!fs.existsSync(srcFile)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'org not found' }));
        return true;
      }
      const destOrgsDir = path.join(path.resolve(destination), '.monomind', 'orgs');
      try {
        fs.mkdirSync(destOrgsDir, { recursive: true });
      } catch (_) {}
      const destFile = path.join(destOrgsDir, `${orgName}.json`);
      if (orgIsRunning(path.resolve(destination), orgName)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: `org "${orgName}" is running in ${destination} — stop it before replacing its definition`,
          }),
        );
        return true;
      }
      writeFileAtomic(destFile, fs.readFileSync(srcFile, 'utf8'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(
        JSON.stringify({
          ok: true,
          destFile,
          signature: orgSignatureState(path.resolve(destination), orgName),
        }),
      );
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return true;
  }
  return false;
}

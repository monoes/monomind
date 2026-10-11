import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './org-hil.mjs';
import { orgSignatureState } from './org-runtime.mjs';
import { readBodyOrReply } from './routes-org-helpers.mjs';

// Org dashboard routes: adapters, agent detail and agent avatar.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgAgentRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/org/:name/adapters — org adapter registry
  if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/adapters$/i.test(url)) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      const _adaptersQs = new URL(req.url, 'http://localhost').searchParams;
      const _adaptersRoot = path.resolve(_adaptersQs.get('dir') || ctx.projectDir || process.cwd());
      const d = ctx._resolveOrgProjectDir(orgName, _adaptersRoot) || _adaptersRoot;
      const adaptersFile = path.join(d, '.monomind', 'orgs', `${orgName}-adapters.json`);
      if (!fs.existsSync(adaptersFile)) {
        // Return defaults derived from org config if available
        const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
        // claude-sonnet-5 = DEFAULT_CLAUDE_MODEL (src/orgrt/vercel-providers.ts); .mjs can't import TS.
        let defaultAdapter = 'claude-sonnet-5';
        try {
          defaultAdapter =
            JSON.parse(fs.readFileSync(orgFile, 'utf8'))?.run_config?.ceo_adapter || defaultAdapter;
        } catch (_) {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        // This list mirrors the runtimes orgrt/daemon.ts actually registers
        // (resolveRunner()'s if-chain + the ClaudeAgentRunner default it falls
        // through to) rather than an independent, hand-maintained catalog — a
        // standalone 'gemini-local' entry used to be advertised here even
        // though no runner is ever registered for it (autoRuntimeFromProvider
        // has no 'gemini' case, so a role requesting it silently falls back to
        // Claude — see daemon.ts#startOrg's fail-fast warning). Gemini is only
        // actually reachable via the 'vercel' runtime (vendor: 'google') or via
        // 'antigravity' (Google-account CLI), both listed below. 'http' maps to
        // provider.kind === 'base-url' (ANTHROPIC_BASE_URL + optional auth
        // token) — a real, usable path, not disabled.
        res.end(
          JSON.stringify({
            default_adapter: defaultAdapter,
            adapters: [
              {
                type: 'claude-local',
                label: 'Claude (local CLI)',
                source: 'built-in',
                disabled: false,
                modelsCount: 3,
              },
              {
                type: 'codex-local',
                label: 'Codex CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'antigravity',
                label: 'Antigravity (Google CLI)',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'grok',
                label: 'Grok CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'qwen',
                label: 'Qwen CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'crush',
                label: 'Crush CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'copilot',
                label: 'GitHub Copilot CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              { type: 'pi', label: 'Pi CLI', source: 'built-in', disabled: false, modelsCount: 1 },
              {
                type: 'opencode',
                label: 'OpenCode CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'kimicode',
                label: 'KimiCode CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'freebuff',
                label: 'Freebuff CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'kilo',
                label: 'Kilo CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'qwen-rpc',
                label: 'Qwen CLI (RPC)',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'pi-rpc',
                label: 'Pi CLI (RPC)',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'hermes',
                label: 'Hermes',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'cline',
                label: 'Cline CLI',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'aider',
                label: 'Aider',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'dsh',
                label: 'DSH (DeepSeek Harness)',
                source: 'built-in',
                disabled: false,
                modelsCount: 1,
              },
              {
                type: 'vercel',
                label: 'Vercel AI SDK (multi-vendor, incl. Gemini/OpenAI)',
                source: 'built-in',
                disabled: false,
                modelsCount: 14,
              },
              {
                type: 'http',
                label: 'Custom HTTP (base-url provider)',
                source: 'built-in',
                disabled: false,
                modelsCount: 0,
              },
            ],
          }),
        );
        return true;
      }
      const data = JSON.parse(fs.readFileSync(adaptersFile, 'utf8'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(data));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // GET /api/org/:name/agent/:roleId — full agent detail: org role + .claude/agents definition
  //   (characteristics, responsibilities, instructions document)
  if (
    req.method === 'GET' &&
    /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agent\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)
  ) {
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      const roleId = decodeURIComponent(parts[5]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      if (roleId.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(roleId)) {
        res.writeHead(400);
        res.end('{}');
        return true;
      }
      const _agentQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_agentQs.get('dir') || ctx.projectDir || process.cwd());
      const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
      if (!fs.existsSync(orgFile)) {
        res.writeHead(404);
        res.end('{}');
        return true;
      }
      const config = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
      const role = (config.roles || []).find((r) => r.id === roleId);
      if (!role) {
        res.writeHead(404);
        res.end('{}');
        return true;
      }

      const agentType = String(role.agent_type || role.type || '').toLowerCase();
      const wanted = [agentType, String(role.id).toLowerCase()].filter(Boolean);

      // Find a matching agent definition under .claude/agents (recursive); match frontmatter name then filename.
      const agentsDir = path.join(d, '.claude', 'agents');
      let definition = { found: false };
      if (wanted.length && fs.existsSync(agentsDir)) {
        const stack = [agentsDir];
        let nameMatch = null,
          slugMatch = null;
        while (stack.length && !nameMatch) {
          const dir = stack.pop();
          let entries = [];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch (_) {
            continue;
          }
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              stack.push(full);
              continue;
            }
            if (!e.name.endsWith('.md') || e.name.startsWith('_')) continue;
            const slug = e.name.replace(/\.md$/, '').toLowerCase();
            let raw = '';
            try {
              raw = fs.readFileSync(full, 'utf8');
            } catch (_) {
              continue;
            }
            const fmName = ((raw.match(/^name:\s*(.+)$/m) || [])[1] || '').trim().toLowerCase();
            if (fmName && wanted.includes(fmName)) {
              nameMatch = { full, raw };
              break;
            }
            if (!slugMatch && wanted.includes(slug)) slugMatch = { full, raw };
          }
        }
        const match = nameMatch || slugMatch;
        if (match) {
          definition = ctx.parseAgentDef(match.raw);
          definition.found = true;
          definition.file = path.relative(d, match.full);
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ role, definition }));
    } catch (_) {
      res.writeHead(500);
      res.end('{}');
    }
    return true;
  }

  // POST /api/org/:name/agent/:roleId/avatar — set (or clear) a custom avatar for one
  // role, stored inline as a data URL on the role itself so it travels with the org
  // config export/import. Body: { avatarDataUrl } — null/omitted avatarDataUrl clears
  // the custom avatar and reverts to the built-in library picture. `dir` (like every
  // other dir-accepting route in this file, POST included — see /goals above) comes
  // from the query string, not the body.
  if (
    req.method === 'POST' &&
    /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agent\/[a-z0-9][a-z0-9_-]{0,63}\/avatar$/i.test(url)
  ) {
    const body = await readBodyOrReply(req, res, 8388608, corsOrigin);
    if (body === null) return true;
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      const roleId = decodeURIComponent(parts[5]);
      if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
        res.writeHead(400);
        res.end('{"ok":false,"error":"Invalid org name"}');
        return true;
      }
      if (roleId.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(roleId)) {
        res.writeHead(400);
        res.end('{"ok":false,"error":"Invalid role id"}');
        return true;
      }
      const parsed = JSON.parse(body);
      const avatarDataUrl = parsed.avatarDataUrl;
      if (
        avatarDataUrl != null &&
        (typeof avatarDataUrl !== 'string' ||
          avatarDataUrl.length > 2_000_000 ||
          !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatarDataUrl))
      ) {
        res.writeHead(400);
        res.end('{"ok":false,"error":"Invalid or oversized avatarDataUrl"}');
        return true;
      }
      const _avatarQs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(_avatarQs.get('dir') || ctx.projectDir || process.cwd());
      const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
      if (!fs.existsSync(orgFile)) {
        res.writeHead(404);
        res.end('{"ok":false,"error":"org not found"}');
        return true;
      }
      const config = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
      const role = (config.roles || []).find((r) => r.id === roleId);
      if (!role) {
        res.writeHead(404);
        res.end('{"ok":false,"error":"role not found"}');
        return true;
      }
      if (avatarDataUrl) role.avatar = avatarDataUrl;
      else delete role.avatar;
      writeFileAtomic(orgFile, JSON.stringify(config, null, 2));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify({ ok: true, signature: orgSignatureState(d, orgName) }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return true;
  }
  return false;
}

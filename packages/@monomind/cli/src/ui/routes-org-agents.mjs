import fs from 'node:fs';
import path from 'node:path';
import { RUNNER_SPECS } from '../orgrt/runner-registry.js';
import { defaultClaudeModel } from '../orgrt/vercel-providers.js';
import { writeFileAtomic } from './org-hil.mjs';
import { ConfigRejected, orgChecklist, orgSignatureState, patchOrgRole } from './org-runtime.mjs';
import { readBodyOrReply } from './routes-org-helpers.mjs';

// Display names for the runtime ids; an id missing here is shown as itself.
const ADAPTER_LABELS = {
  claude: 'Claude',
  codex: 'Codex CLI',
  antigravity: 'Antigravity (Google CLI)',
  grok: 'Grok CLI',
  qwen: 'Qwen CLI',
  crush: 'Crush CLI',
  copilot: 'GitHub Copilot CLI',
  pi: 'Pi CLI',
  opencode: 'OpenCode CLI',
  kimicode: 'KimiCode CLI',
  freebuff: 'Freebuff CLI',
  kilo: 'Kilo CLI',
  'qwen-rpc': 'Qwen CLI (RPC)',
  'pi-rpc': 'Pi CLI (RPC)',
  hermes: 'Hermes',
  cline: 'Cline CLI',
  aider: 'Aider',
  dsh: 'DSH (DeepSeek Harness)',
  vercel: 'Vercel AI SDK (multi-vendor, incl. Gemini/OpenAI)',
};

// One entry per runtime id the registry knows; `type` is the value a role's or an org's
// `runtime` takes. A runtime that cannot be driven (freebuff) is listed disabled, with the reason.
const _runtimeAdapters = () =>
  RUNNER_SPECS.map((spec) => ({
    type: spec.id,
    label: ADAPTER_LABELS[spec.id] ?? spec.id,
    source: 'built-in',
    disabled: !!spec.executionUnsupportedReason,
    disabledReason: spec.executionUnsupportedReason ?? null,
    binary: spec.binary,
    installHint: spec.installHint,
  }));

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
        // The newest Sonnet (src/orgrt/vercel-providers.ts), the org runtime's default.
        let defaultAdapter = defaultClaudeModel();
        try {
          defaultAdapter =
            JSON.parse(fs.readFileSync(orgFile, 'utf8'))?.run_config?.ceo_adapter || defaultAdapter;
        } catch (_) {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        });
        // One entry per runtime id the registry knows (orgrt/runner-registry.ts),
        // so a newly added runtime shows up without editing this list. `type` is
        // the value a role's or an org's `runtime` takes. A runtime whose
        // binary is discoverable but cannot be driven (freebuff) is listed
        // disabled, with the registry's reason.
        res.end(
          JSON.stringify({
            default_adapter: defaultAdapter,
            adapters: _runtimeAdapters(),
          }),
        );
        return true;
      }
      const data = JSON.parse(fs.readFileSync(adaptersFile, 'utf8'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      // The file's own entries may carry ids that are not runtime values (claude-local ...),
      // which the runtime selects would save and the runtime would reject: serve the registry's list.
      res.end(JSON.stringify({ ...data, adapters: _runtimeAdapters() }));
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

  // POST /api/org/:name/agent/:roleId/config — edit one role's runtime, model,
  // turn/tool-round and budget limits, session scope, review/deliberative flags
  // and cost tier. Refused unless the result passes what `org run` applies.
  if (
    req.method === 'POST' &&
    /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agent\/[a-z0-9][a-z0-9_-]{0,63}\/config$/i.test(url)
  ) {
    const body = await readBodyOrReply(req, res, 65536, corsOrigin);
    if (body === null) return true;
    const send = (status, payload) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
      res.end(JSON.stringify(payload));
      return true;
    };
    try {
      const parts = url.split('/');
      const orgName = decodeURIComponent(parts[3]);
      const roleId = decodeURIComponent(parts[5]);
      const patch = JSON.parse(body);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch))
        return send(400, { ok: false, error: 'JSON object body required' });
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(qs.get('dir') || ctx.projectDir || process.cwd());
      const def = patchOrgRole(d, orgName, roleId, patch);
      return send(200, {
        ok: true,
        role: def.roles.find((r) => r.id === roleId),
        cost_tiers: def.cost_tiers ?? null,
        warnings: orgChecklist(def).warnings,
        signature: orgSignatureState(d, orgName),
      });
    } catch (e) {
      return send(e instanceof ConfigRejected || e instanceof SyntaxError ? 400 : 500, {
        ok: false,
        error: String(e.message || e),
      });
    }
  }
  return false;
}

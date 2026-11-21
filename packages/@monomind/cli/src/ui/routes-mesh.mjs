// Mesh view route: the agents on this host's Monomind Mesh, read-only.
//
//   GET /api/mesh/agents?scope=project|all → { online, agents, truncated }
//
// It asks the running hub with the identity-free `who` op and nothing else: it
// never joins the mesh (that would list the dashboard as an agent), never sends,
// never reads an inbox, and never starts a hub — when none is running it answers
// { online: false }. `scope=project` means the project this dashboard serves.

const TIMEOUT_MS = 800;

async function defaultDeps() {
  const { meshCall, MeshOfflineError } = await import('../mesh/client.js');
  const { projectIdFor } = await import('../mesh/project-id.js');
  return { meshCall, MeshOfflineError, projectIdFor };
}

export async function handleMeshRoutes(req, res, url, corsOrigin, ctx, deps) {
  if (req.method !== 'GET' || url !== '/api/mesh/agents') return false;
  const json = (status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });
    res.end(JSON.stringify(body));
    return true;
  };
  const { meshCall, MeshOfflineError, projectIdFor } = deps ?? (await defaultDeps());
  const scope =
    new URL(req.url, 'http://localhost').searchParams.get('scope') === 'all' ? 'all' : 'project';
  const request = { op: 'who', id: `dash-who-${Date.now()}` };
  if (scope === 'project') request.project = projectIdFor(ctx.projectDir);
  try {
    const r = await meshCall(request, { timeoutMs: TIMEOUT_MS });
    if (!r.ok) return json(502, { error: String(r.error) });
    return json(200, {
      online: true,
      scope,
      agents: r.agents ?? [],
      truncated: r.truncated === true,
    });
  } catch (e) {
    if (e instanceof MeshOfflineError) return json(200, { online: false, scope, agents: [] });
    return json(500, { error: e.message });
  }
}

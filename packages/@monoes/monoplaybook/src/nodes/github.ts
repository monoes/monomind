// GitHub node handler — ported from internal/nodes/service/github.go
// Operations: list_repos, list_issues, get_issue, create_issue, update_issue,
//             list_prs, create_pr, list_releases, create_release
import type { NodeHandler, Item } from '@monoes/monobrowse';

const GITHUB_BASE = 'https://api.github.com';

async function ghRequest(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'monoplaybook/1.0',
  };
  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: bodyStr });
  const text = await res.text();
  if (!res.ok) throw new Error(`github HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function ghRequestList(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<unknown[]> {
  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'monoplaybook/1.0',
  };
  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: bodyStr });
  const text = await res.text();
  if (!res.ok) throw new Error(`github HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as unknown[];
}

function listToItems(list: unknown[]): Item[] {
  return list.map(elem => {
    if (elem !== null && typeof elem === 'object') return { data: elem as Record<string, unknown> };
    return { data: { value: elem } };
  });
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const token = String(config['token'] ?? '');
  if (!token) throw new Error('service.github: token is required');

  const operation = String(config['operation'] ?? 'list_repos');
  const owner = String(config['owner'] ?? '');
  const repo = String(config['repo'] ?? '');

  switch (operation) {
    case 'list_repos': {
      const list = await ghRequestList('GET', `${GITHUB_BASE}/user/repos?per_page=100`, token);
      return listToItems(list);
    }

    case 'list_issues': {
      let url = `${GITHUB_BASE}/repos/${owner}/${repo}/issues?per_page=100`;
      if (config['state']) url += `&state=${encodeURIComponent(String(config['state']))}`;
      const list = await ghRequestList('GET', url, token);
      return listToItems(list);
    }

    case 'get_issue': {
      const number = Number(config['number'] ?? 0);
      if (!number) throw new Error('service.github: number required for get_issue');
      const data = await ghRequest('GET', `${GITHUB_BASE}/repos/${owner}/${repo}/issues/${number}`, token);
      return [{ data }];
    }

    case 'create_issue': {
      const body: Record<string, unknown> = {
        title: String(config['title'] ?? ''),
        body: String(config['body'] ?? ''),
      };
      const labels = config['labels'];
      if (Array.isArray(labels) && labels.length) body['labels'] = labels;
      const data = await ghRequest('POST', `${GITHUB_BASE}/repos/${owner}/${repo}/issues`, token, body);
      return [{ data }];
    }

    case 'update_issue': {
      const number = Number(config['number'] ?? 0);
      if (!number) throw new Error('service.github: number required for update_issue');
      const body: Record<string, unknown> = {};
      if (config['title']) body['title'] = String(config['title']);
      if (config['body']) body['body'] = String(config['body']);
      if (config['state']) body['state'] = String(config['state']);
      const labels = config['labels'];
      if (Array.isArray(labels) && labels.length) body['labels'] = labels;
      const data = await ghRequest('PATCH', `${GITHUB_BASE}/repos/${owner}/${repo}/issues/${number}`, token, body);
      return [{ data }];
    }

    case 'list_prs': {
      let url = `${GITHUB_BASE}/repos/${owner}/${repo}/pulls?per_page=100`;
      if (config['state']) url += `&state=${encodeURIComponent(String(config['state']))}`;
      const list = await ghRequestList('GET', url, token);
      return listToItems(list);
    }

    case 'create_pr': {
      const head = String(config['head'] ?? '');
      const base = String(config['base'] ?? '');
      if (!head) throw new Error('service.github: head required for create_pr');
      if (!base) throw new Error('service.github: base required for create_pr');
      const body = {
        title: String(config['title'] ?? ''),
        body: String(config['body'] ?? ''),
        head,
        base,
      };
      const data = await ghRequest('POST', `${GITHUB_BASE}/repos/${owner}/${repo}/pulls`, token, body);
      return [{ data }];
    }

    case 'list_releases': {
      const list = await ghRequestList('GET', `${GITHUB_BASE}/repos/${owner}/${repo}/releases?per_page=100`, token);
      return listToItems(list);
    }

    case 'create_release': {
      const body = {
        tag_name: String(config['tag_name'] ?? ''),
        name: String(config['release_name'] ?? config['title'] ?? ''),
        body: String(config['body'] ?? ''),
      };
      const data = await ghRequest('POST', `${GITHUB_BASE}/repos/${owner}/${repo}/releases`, token, body);
      return [{ data }];
    }

    default:
      throw new Error(`service.github: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.github', handler);
}

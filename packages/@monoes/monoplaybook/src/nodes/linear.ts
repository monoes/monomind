// Linear node handler — ported from internal/nodes/service/linear.go
// Operations: list_issues, get_issue, create_issue, update_issue, list_teams, list_projects
import type { NodeHandler, Item } from '../engine/index.js';

const LINEAR_GQL = 'https://api.linear.app/graphql';

const Q_LIST_ISSUES = `query ListIssues($teamId:String,$filter:IssueFilter,$first:Int){issues(filter:$filter,first:$first){nodes{id title description priority state{id name}team{id name}project{id name}assignee{id name email}createdAt updatedAt}}}`;
const Q_GET_ISSUE = `query GetIssue($id:String!){issue(id:$id){id title description priority state{id name}team{id name}project{id name}assignee{id name email}createdAt updatedAt}}`;
const M_CREATE_ISSUE = `mutation CreateIssue($input:IssueCreateInput!){issueCreate(input:$input){success issue{id title description priority state{id name}team{id name}createdAt}}}`;
const M_UPDATE_ISSUE = `mutation UpdateIssue($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{id title description priority state{id name}updatedAt}}}`;
const Q_LIST_TEAMS = `query ListTeams{teams{nodes{id name key description}}}`;
const Q_LIST_PROJECTS = `query ListProjects($teamId:String){projects(filter:{team:{id:{eq:$teamId}}}){nodes{id name description state startDate targetDate}}}`;

async function linearGQL(token: string, query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(LINEAR_GQL, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`linear HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`linear GraphQL: ${json.errors[0].message}`);
  return (json.data ?? {}) as Record<string, unknown>;
}

function nodesToItems(data: Record<string, unknown>, key: string): Item[] {
  const top = data[key] as Record<string, unknown> | undefined;
  const nodes = (top?.['nodes'] as unknown[]) ?? [];
  return nodes.map(n => ({ data: n as Record<string, unknown> }));
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const token = String(config['token'] ?? '');
  if (!token) throw new Error('service.linear: token is required');

  const operation = String(config['operation'] ?? 'list_issues');

  switch (operation) {
    case 'list_issues': {
      const vars: Record<string, unknown> = { first: Number(config['limit'] ?? 50) };
      const teamId = String(config['team_id'] ?? '');
      if (teamId) vars['filter'] = { team: { id: { eq: teamId } } };
      const data = await linearGQL(token, Q_LIST_ISSUES, vars);
      return nodesToItems(data, 'issues');
    }

    case 'get_issue': {
      const id = String(config['issue_id'] ?? '');
      if (!id) throw new Error('service.linear: issue_id required for get_issue');
      const data = await linearGQL(token, Q_GET_ISSUE, { id });
      const issue = data['issue'] as Record<string, unknown> | undefined;
      if (!issue) throw new Error(`service.linear: issue ${id} not found`);
      return [{ data: issue }];
    }

    case 'create_issue': {
      const teamId = String(config['team_id'] ?? '');
      if (!teamId) throw new Error('service.linear: team_id required for create_issue');
      const title = String(config['title'] ?? '');
      if (!title) throw new Error('service.linear: title required for create_issue');
      const input: Record<string, unknown> = { teamId, title };
      if (config['description']) input['description'] = String(config['description']);
      if (config['priority']) input['priority'] = Number(config['priority']);
      if (config['assignee_id']) input['assigneeId'] = String(config['assignee_id']);
      const data = await linearGQL(token, M_CREATE_ISSUE, { input });
      const result = data['issueCreate'] as Record<string, unknown> | undefined;
      return [{ data: (result?.['issue'] as Record<string, unknown>) ?? result ?? {} }];
    }

    case 'update_issue': {
      const id = String(config['issue_id'] ?? '');
      if (!id) throw new Error('service.linear: issue_id required for update_issue');
      const input: Record<string, unknown> = {};
      if (config['title']) input['title'] = String(config['title']);
      if (config['description']) input['description'] = String(config['description']);
      if (config['priority'] !== undefined) input['priority'] = Number(config['priority']);
      if (config['state_id']) input['stateId'] = String(config['state_id']);
      const data = await linearGQL(token, M_UPDATE_ISSUE, { id, input });
      const result = data['issueUpdate'] as Record<string, unknown> | undefined;
      return [{ data: (result?.['issue'] as Record<string, unknown>) ?? result ?? {} }];
    }

    case 'list_teams': {
      const data = await linearGQL(token, Q_LIST_TEAMS, {});
      return nodesToItems(data, 'teams');
    }

    case 'list_projects': {
      const vars: Record<string, unknown> = {};
      if (config['team_id']) vars['teamId'] = String(config['team_id']);
      const data = await linearGQL(token, Q_LIST_PROJECTS, vars);
      return nodesToItems(data, 'projects');
    }

    default:
      throw new Error(`service.linear: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.linear', handler);
}

import { describe, it, expect } from 'vitest';
import type { WorkflowDef, NodeDef, ConnectionDef, Item, RunRecord, RunStatus } from '@monoes/monobrowse';
import type { ActionDef, StepDef } from '@monoes/monobrowse';

describe('WorkflowDef', () => {
  it('accepts a valid workflow definition', () => {
    const wf: WorkflowDef = {
      id: 'my-workflow',
      name: 'My Workflow',
      nodes: [
        { id: 'n1', type: 'trigger.manual', config: {} },
        { id: 'n2', type: 'action.linkedin.comment_post', config: { post_url: '{{$json.url}}', text: 'hi' } },
      ],
      connections: [{ from: 'n1', to: 'n2' }],
    };
    expect(wf.nodes).toHaveLength(2);
    expect(wf.connections[0].from).toBe('n1');
  });

  it('accepts a valid ActionDef with steps', () => {
    const action: ActionDef = {
      id: 'linkedin:comment_post',
      platform: 'linkedin',
      name: 'Comment on Post',
      params: ['post_url', 'text'],
      steps: [
        { type: 'navigate', url: '{{params.post_url}}' },
        { type: 'find', selectors: ['.comment-box', '[aria-label="Add a comment"]'], as: 'box' },
        { type: 'click', target: '{{box}}' },
        { type: 'type', target: '{{box}}', text: '{{params.text}}', humanDelay: true },
        { type: 'wait', condition: 'network_idle', timeout: 3000 },
      ],
    };
    expect(action.steps).toHaveLength(5);
  });
});

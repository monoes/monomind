export type StepType = 'navigate' | 'find' | 'click' | 'type' | 'wait' | 'extract' | 'condition';

export interface NavigateStep { type: 'navigate'; url: string; }
export interface FindStep { type: 'find'; selectors: string[]; as: string; }
export interface ClickStep { type: 'click'; target: string; }
export interface TypeStep { type: 'type'; target: string; text: string; humanDelay?: boolean; }
export interface WaitStep { type: 'wait'; condition: 'network_idle' | 'selector' | 'duration'; timeout?: number; selector?: string; }
export interface ExtractStep { type: 'extract'; target: string; as: string; attribute?: string; }
export interface ConditionStep { type: 'condition'; expression: string; then: StepDef[]; else?: StepDef[]; }

export type StepDef = NavigateStep | FindStep | ClickStep | TypeStep | WaitStep | ExtractStep | ConditionStep;

export interface ActionDef {
  id: string;          // 'linkedin:comment_post'
  platform: string;    // 'linkedin'
  name: string;
  params: string[];
  steps: StepDef[];
}

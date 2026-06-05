import type { CdpClient } from './cdp.js';
import type { ElementRef } from './types.js';
export type FindAction = 'click' | 'fill' | 'type' | 'hover' | 'focus' | 'check' | 'uncheck' | 'text';
export interface FindOptions {
    name?: string;
    exact?: boolean;
    nth?: number;
    first?: boolean;
    last?: boolean;
}
export declare function findBySelector(client: CdpClient, sessionId: string, refs: Map<string, ElementRef>, selector: string, options?: FindOptions): Promise<ElementRef | null>;
export declare function findByRole(client: CdpClient, sessionId: string, refs: Map<string, ElementRef>, role: string, options?: FindOptions): Promise<ElementRef | null>;
export declare function findByText(client: CdpClient, sessionId: string, refs: Map<string, ElementRef>, text: string, options?: FindOptions): Promise<ElementRef | null>;
export declare function findByLabel(client: CdpClient, sessionId: string, refs: Map<string, ElementRef>, label: string, options?: FindOptions): Promise<ElementRef | null>;
export declare function findByPlaceholder(client: CdpClient, sessionId: string, refs: Map<string, ElementRef>, placeholder: string, options?: FindOptions): Promise<ElementRef | null>;
export declare function findByTestId(client: CdpClient, sessionId: string, testId: string): Promise<string | null>;
export declare function isVisible(client: CdpClient, sessionId: string, ref: ElementRef): Promise<boolean>;
export declare function isEnabled(client: CdpClient, sessionId: string, ref: ElementRef): Promise<boolean>;
export declare function isChecked(client: CdpClient, sessionId: string, ref: ElementRef): Promise<boolean>;
export declare function scrollIntoView(client: CdpClient, sessionId: string, ref: ElementRef): Promise<void>;
export declare function highlightElement(client: CdpClient, sessionId: string, ref: ElementRef): Promise<void>;
//# sourceMappingURL=find.d.ts.map
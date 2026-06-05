export interface BrowserConfig {
    port?: number;
    headless?: boolean;
    executablePath?: string;
    userDataDir?: string;
    args?: string[];
}
export interface SessionState {
    targetId: string;
    sessionId: string;
    url: string;
    title: string;
    cookies: CdpCookie[];
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
}
export interface CdpCookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}
export interface ElementRef {
    ref: string;
    role: string;
    name: string;
    description?: string;
    placeholder?: string;
    value?: string;
    disabled?: boolean;
    checked?: boolean;
    expanded?: boolean;
    nodeId: number;
    backendDOMNodeId?: number;
    objectId?: string;
}
export interface SnapshotOptions {
    interactiveOnly?: boolean;
    compact?: boolean;
    maxDepth?: number;
    selector?: string;
}
export interface SnapshotResult {
    text: string;
    refs: Map<string, ElementRef>;
    url: string;
    title: string;
}
export interface ClickOptions {
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    modifiers?: number;
}
export interface WaitOptions {
    timeout?: number;
    url?: string;
    text?: string;
    selector?: string;
    load?: 'load' | 'networkidle' | 'domcontentloaded';
}
export interface NetworkRoute {
    pattern: string;
    action: 'abort' | 'fulfill' | 'continue';
    response?: {
        status?: number;
        headers?: Record<string, string>;
        body?: string;
    };
}
export interface ViewportSize {
    width: number;
    height: number;
}
export interface CdpTarget {
    id: string;
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl?: string;
}
export interface CdpCommand {
    id: number;
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
}
export interface CdpResponse {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: {
        code: number;
        message: string;
    };
    sessionId?: string;
}
export interface BrowserSession {
    targetId: string;
    sessionId: string;
    refs: Map<string, ElementRef>;
    routes: NetworkRoute[];
    viewport: ViewportSize;
}
export declare const INTERACTIVE_ROLES: Set<string>;
export declare const CHROME_EXECUTABLES: string[];
//# sourceMappingURL=types.d.ts.map
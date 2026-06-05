import { WebSocket } from 'ws';
export class CdpClient {
    ws = null;
    pendingCommands = new Map();
    eventListeners = new Map();
    nextId = 1;
    connected = false;
    async connect(wsUrl) {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(wsUrl);
            this.ws.on('open', () => {
                this.connected = true;
                resolve();
            });
            this.ws.on('error', (err) => {
                if (!this.connected) {
                    reject(err);
                }
                else {
                    // Post-connect: flush all pending commands — 'close' may not fire on all platforms
                    this.connected = false;
                    for (const { reject: r } of this.pendingCommands.values())
                        r(err);
                    this.pendingCommands.clear();
                }
            });
            this.ws.on('close', () => {
                this.connected = false;
                for (const { reject: r } of this.pendingCommands.values()) {
                    r(new Error('CDP connection closed'));
                }
                this.pendingCommands.clear();
            });
            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.id !== undefined && this.pendingCommands.has(msg.id)) {
                        const handler = this.pendingCommands.get(msg.id);
                        this.pendingCommands.delete(msg.id);
                        if (msg.error) {
                            handler.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
                        }
                        else {
                            handler.resolve(msg);
                        }
                    }
                    else if (msg.method) {
                        const listeners = this.eventListeners.get(msg.method);
                        if (listeners) {
                            for (const fn of listeners) {
                                try {
                                    fn(msg.params ?? {}, msg.sessionId);
                                }
                                catch { /* isolate per-listener errors */ }
                            }
                        }
                    }
                }
                catch {
                    // ignore malformed messages
                }
            });
        });
    }
    send(method, params, sessionId) {
        return new Promise((resolve, reject) => {
            if (!this.ws || !this.connected) {
                reject(new Error('CDP not connected'));
                return;
            }
            const id = this.nextId++;
            const cmd = { id, method, params };
            if (sessionId)
                cmd.sessionId = sessionId;
            this.pendingCommands.set(id, {
                resolve: (r) => resolve((r.result ?? {})),
                reject,
            });
            this.ws.send(JSON.stringify(cmd), (err) => {
                if (err) {
                    this.pendingCommands.delete(id);
                    reject(err);
                }
            });
        });
    }
    on(event, fn) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event).add(fn);
        return () => this.eventListeners.get(event)?.delete(fn);
    }
    once(event, sessionId) {
        const [promise] = this.onceWithOff(event, sessionId);
        return promise;
    }
    onceWithOff(event, sessionId) {
        let off = () => { };
        const promise = new Promise((resolve) => {
            off = this.on(event, (params, sid) => {
                if (sessionId !== undefined && sid !== sessionId)
                    return;
                off();
                resolve(params);
            });
        });
        return [promise, () => off()];
    }
    close() {
        this.connected = false;
        for (const { reject: r } of this.pendingCommands.values())
            r(new Error('CDP connection closed'));
        this.pendingCommands.clear();
        this.ws?.close();
        this.ws = null;
        this.eventListeners.clear();
    }
    isConnected() {
        return this.connected;
    }
}
export async function fetchTargets(port) {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!res.ok)
        throw new Error(`Failed to fetch targets: ${res.statusText}`);
    return res.json();
}
export async function fetchNewTarget(port, url) {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?${url}`);
    if (!res.ok)
        throw new Error(`Failed to create target: ${res.statusText}`);
    return res.json();
}
//# sourceMappingURL=cdp.js.map
import type { CdpClient } from './cdp.js';
export interface DeviceProfile {
    width: number;
    height: number;
    deviceScaleFactor: number;
    mobile: boolean;
    userAgent: string;
}
export declare function emulateDevice(client: CdpClient, sessionId: string, deviceName: string): Promise<void>;
export declare function setGeolocation(client: CdpClient, sessionId: string, latitude: number, longitude: number, accuracy?: number): Promise<void>;
export declare function setOfflineMode(client: CdpClient, sessionId: string, offline: boolean): Promise<void>;
export declare function setColorScheme(client: CdpClient, sessionId: string, scheme: 'dark' | 'light' | 'no-preference'): Promise<void>;
export declare function setBasicAuth(client: CdpClient, sessionId: string, username: string, password: string): Promise<void>;
export declare function listDevices(): string[];
//# sourceMappingURL=emulation.d.ts.map
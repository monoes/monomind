import type { CdpClient } from './cdp.js';

export interface DeviceProfile {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  userAgent: string;
}

const DEVICES: Record<string, DeviceProfile> = {
  'iPhone 14': {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
  'iPhone SE': {
    width: 375, height: 667, deviceScaleFactor: 2, mobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  },
  'iPad': {
    width: 768, height: 1024, deviceScaleFactor: 2, mobile: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  },
  'Galaxy S21': {
    width: 360, height: 800, deviceScaleFactor: 3, mobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.101 Mobile Safari/537.36',
  },
  'Pixel 5': {
    width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.101 Mobile Safari/537.36',
  },
};

export async function emulateDevice(client: CdpClient, sessionId: string, deviceName: string): Promise<void> {
  const device = DEVICES[deviceName];
  if (!device) {
    throw new Error(`Unknown device: "${deviceName}". Available: ${Object.keys(DEVICES).join(', ')}`);
  }

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: device.width,
    height: device.height,
    deviceScaleFactor: device.deviceScaleFactor,
    mobile: device.mobile,
  }, sessionId);

  await client.send('Emulation.setUserAgentOverride', { userAgent: device.userAgent }, sessionId);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: device.mobile }, sessionId);
}

export async function setGeolocation(
  client: CdpClient,
  sessionId: string,
  latitude: number,
  longitude: number,
  accuracy = 100
): Promise<void> {
  await client.send('Emulation.setGeolocationOverride', { latitude, longitude, accuracy }, sessionId);
}

export async function setOfflineMode(client: CdpClient, sessionId: string, offline: boolean): Promise<void> {
  await client.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  }, sessionId);
}

export async function setColorScheme(
  client: CdpClient,
  sessionId: string,
  scheme: 'dark' | 'light' | 'no-preference'
): Promise<void> {
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  }, sessionId);
}

export async function setBasicAuth(
  client: CdpClient,
  sessionId: string,
  username: string,
  password: string
): Promise<void> {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  await client.send('Network.setExtraHTTPHeaders', {
    headers: { Authorization: `Basic ${encoded}` },
  }, sessionId);
}

export function listDevices(): string[] {
  return Object.keys(DEVICES);
}

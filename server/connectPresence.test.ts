import { describe, it, expect } from 'bun:test';
import { connectPresenceManager } from './connectPresence';
import http from 'node:http';

describe('ConnectPresenceManager (Lyra Connect / Spotify Connect Engine)', () => {
  it('registers device heartbeats and lists online devices', () => {
    connectPresenceManager.recordHeartbeat({
      deviceId: 'macbook-pro-m3',
      deviceName: 'Taufeeq MacBook Pro',
      deviceType: 'desktop',
      workspacePath: '/Users/taufeeqali/Projects/Lyra',
      activeSessionId: 'session-main',
    });

    connectPresenceManager.recordHeartbeat({
      deviceId: 'iphone-safari',
      deviceName: 'iPhone 16 Pro',
      deviceType: 'mobile',
      activeSessionId: 'session-main',
    });

    const online = connectPresenceManager.listOnlineDevices();
    expect(online.length).toBeGreaterThanOrEqual(2);

    const macbook = online.find((d) => d.deviceId === 'macbook-pro-m3');
    expect(macbook).toBeDefined();
    expect(macbook?.deviceType).toBe('desktop');
    expect(macbook?.workspacePath).toContain('Lyra');
  });

  it('casts session from Device A to Device B with verified handoff', () => {
    connectPresenceManager.recordHeartbeat({
      deviceId: 'studio-desktop',
      deviceName: 'Mac Studio',
      deviceType: 'desktop',
    });

    // Cast session-pulse from iPhone to Mac Studio
    const castRes = connectPresenceManager.castSession({
      fromDeviceId: 'iphone-safari',
      targetDeviceId: 'studio-desktop',
      sessionId: 'session-pulse-42',
    });

    expect(castRes.success).toBe(true);
    expect(castRes.targetDevice?.activeSessionId).toBe('session-pulse-42');

    // Trying to cast to an offline device fails cleanly
    const invalidCast = connectPresenceManager.castSession({
      fromDeviceId: 'iphone-safari',
      targetDeviceId: 'non-existent-device',
      sessionId: 'session-pulse-42',
    });
    expect(invalidCast.success).toBe(false);
    expect(invalidCast.error).toContain('not online');
  });
});

import http from 'node:http';

export type DeviceType = 'desktop' | 'web' | 'mobile' | 'cli';

export interface ConnectedDevice {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  workspacePath?: string;
  activeSessionId?: string;
  lastSeenMs: number;
  clientIp?: string;
}

export interface CastSessionEvent {
  type: 'session_cast';
  fromDeviceId: string;
  targetDeviceId: string;
  sessionId: string;
  timestamp: string;
}

export interface DevicePresenceEvent {
  type: 'device_joined' | 'device_left' | 'device_heartbeat' | 'session_cast';
  device?: ConnectedDevice;
  cast?: CastSessionEvent;
  timestamp: string;
}

export class ConnectPresenceManager {
  private devices = new Map<string, ConnectedDevice>();
  private sseClients = new Set<http.ServerResponse>();
  private staleTimeoutMs = 60_000; // 60s timeout before a device is considered offline

  /**
   * Records or updates a device heartbeat.
   */
  public recordHeartbeat(params: {
    deviceId: string;
    deviceName?: string;
    deviceType?: DeviceType;
    workspacePath?: string;
    activeSessionId?: string;
    clientIp?: string;
  }): ConnectedDevice {
    const now = Date.now();
    const existing = this.devices.get(params.deviceId);

    const updated: ConnectedDevice = {
      deviceId: params.deviceId,
      deviceName: params.deviceName || existing?.deviceName || params.deviceId,
      deviceType: params.deviceType || existing?.deviceType || 'desktop',
      workspacePath: params.workspacePath || existing?.workspacePath,
      activeSessionId: params.activeSessionId || existing?.activeSessionId,
      lastSeenMs: now,
      clientIp: params.clientIp || existing?.clientIp,
    };

    const isNew = !existing;
    this.devices.set(params.deviceId, updated);

    if (isNew) {
      this.broadcastEvent({
        type: 'device_joined',
        device: updated,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  /**
   * Returns all active online devices (heartbeat within last 60 seconds).
   */
  public listOnlineDevices(): ConnectedDevice[] {
    const now = Date.now();
    const active: ConnectedDevice[] = [];

    for (const [id, dev] of this.devices.entries()) {
      if (now - dev.lastSeenMs <= this.staleTimeoutMs) {
        active.push(dev);
      } else {
        // Prune stale
        this.devices.delete(id);
        this.broadcastEvent({
          type: 'device_left',
          device: dev,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return active;
  }

  /**
   * Casts an active session from one device to another (Spotify Connect style).
   */
  public castSession(params: {
    fromDeviceId: string;
    targetDeviceId: string;
    sessionId: string;
  }): { success: boolean; targetDevice?: ConnectedDevice; error?: string } {
    const online = this.listOnlineDevices();
    const target = online.find((d) => d.deviceId === params.targetDeviceId);

    if (!target) {
      return {
        success: false,
        error: `Target device "${params.targetDeviceId}" is not online or reachable.`,
      };
    }

    // Update target's active session
    target.activeSessionId = params.sessionId;
    this.devices.set(target.deviceId, target);

    const castEvent: CastSessionEvent = {
      type: 'session_cast',
      fromDeviceId: params.fromDeviceId,
      targetDeviceId: params.targetDeviceId,
      sessionId: params.sessionId,
      timestamp: new Date().toISOString(),
    };

    this.broadcastEvent({
      type: 'session_cast',
      cast: castEvent,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      targetDevice: target,
    };
  }

  /**
   * Subscribes an HTTP response to real-time presence and casting Server-Sent Events.
   */
  public subscribeSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial snapshot
    const initialPayload = {
      type: 'snapshot',
      devices: this.listOnlineDevices(),
      timestamp: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private broadcastEvent(event: DevicePresenceEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(data);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }
}

export const connectPresenceManager = new ConnectPresenceManager();

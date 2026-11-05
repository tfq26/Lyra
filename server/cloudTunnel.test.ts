import { describe, it, expect, afterAll } from 'bun:test';
import http from 'node:http';
import { cloudTunnelManager } from './cloudTunnel';

describe('CloudTunnelManager', () => {
  let server: http.Server;
  let testPort: number;

  afterAll(() => {
    cloudTunnelManager.stopAll();
    if (server) server.close();
  });

  it('spawns a public HTTPS cloudflare tunnel for a local port', async () => {
    // 1. Create a quick mock HTTP server
    testPort = await new Promise<number>((resolve) => {
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Lyra Live Preview OK');
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          resolve(addr.port);
        }
      });
    });

    expect(testPort).toBeGreaterThan(1000);

    // 2. Open tunnel
    const tunnel = await cloudTunnelManager.createTunnel(testPort, 'test-unit-tunnel');
    expect(tunnel.publicUrl).toMatch(/^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    console.log(`[Test] Cloudflare tunnel established successfully: ${tunnel.publicUrl}`);

    // 3. Clean up
    const stopped = cloudTunnelManager.stopTunnel('test-unit-tunnel');
    expect(stopped).toBe(true);
  }, 20000);
});

#!/usr/bin/env bun
/**
 * Lyra Harness MCP Stdio Server
 * 
 * Standard JSON-RPC 2.0 MCP server over stdio for Google Antigravity,
 * OpenAI Codex, Claude Desktop, Cursor, and other MCP clients.
 */

// Route all logging to stderr so it never corrupts MCP JSON-RPC protocol on stdout
console.log = (...args: any[]) => process.stderr.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
console.info = console.log;
console.warn = console.log;

import readline from 'node:readline';
import path from 'node:path';
import { UnifiedStore } from '../server/unifiedStore';
import { ProcessManager } from '../server/processManager';
import { NativeAgentRuntime } from '../server/nativeAgentRuntime';
import { TeamCoordinator } from '../server/teamCoordinator';
import { LyraHarnessGateway } from '../server/gateway';
import { LyraHarnessMcpServer } from '../server/harnessMcpServer';

const store = new UnifiedStore(process.env.LYRA_STORAGE_PATH);
const processManager = new ProcessManager();
const nativeAgentRuntime = new NativeAgentRuntime(store);
const teamCoordinator = new TeamCoordinator(store, processManager, nativeAgentRuntime);
const gateway = new LyraHarnessGateway(store, teamCoordinator);
const harnessMcp = new LyraHarnessMcpServer(gateway, store);

const hubUrl = (process.env.LYRA_HUB_URL || 'http://localhost:3001').replace(/\/+$/, '');
const apiKey = process.env.LYRA_GATEWAY_API_KEY || 'lyra-harness-default-secret';

async function executeMcpTool(toolName: string, args: Record<string, any>) {
  try {
    if (toolName === 'lyra_dispatch_task') {
      const res = await fetch(`${hubUrl}/api/gateway/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(args),
      });
      if (res.ok) {
        const data = await res.json() as any;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ status: 'success', message: 'Task dispatched to Lyra autonomous cloud swarm.', sessionId: data.sessionId, runId: data.runId }, null, 2)
          }]
        };
      }
      const err = await res.json().catch(() => ({ error: 'Dispatch failed' })) as any;
      throw new Error(err.error || `Gateway returned HTTP ${res.status}`);
    }

    if (toolName === 'lyra_get_run_status') {
      const res = await fetch(`${hubUrl}/api/gateway/runs/${args.runId}/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(data, null, 2)
          }]
        };
      }
    }

    if (toolName === 'lyra_get_handoff') {
      const params = new URLSearchParams();
      if (args.workspacePath) params.set('workspacePath', args.workspacePath);
      if (args.runId) params.set('runId', args.runId);
      const res = await fetch(`${hubUrl}/api/gateway/handoff?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(data, null, 2)
          }]
        };
      }
    }
  } catch (err: any) {
    if (!err.message?.includes('fetch failed') && !err.message?.includes('ConnectionRefused')) {
      throw err;
    }
  }

  return await harnessMcp.executeTool(toolName, args);
}

function sendResponse(id: number | string | null, result: any, error?: any) {
  const response: Record<string, any> = {
    jsonrpc: '2.0',
    id,
  };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    const { id, method, params } = msg;

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'lyra-harness',
          version: '1.0.0',
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      // Client confirmed initialization
      return;
    }

    if (method === 'tools/list') {
      sendResponse(id, {
        tools: harnessMcp.getTools(),
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      try {
        const result = await executeMcpTool(toolName, args);
        sendResponse(id, result);
      } catch (err: any) {
        sendResponse(id, null, {
          code: -32603,
          message: err.message || 'Tool execution failed',
        });
      }
      return;
    }

    if (id !== undefined) {
      sendResponse(id, null, {
        code: -32601,
        message: `Method not found: ${method}`,
      });
    }
  } catch (err: any) {
    sendResponse(null, null, {
      code: -32700,
      message: 'Parse error: invalid JSON',
    });
  }
});

import type { AgentType } from '../types';

export interface SlashCommand {
  name: string;
  description: string;
  source: 'lyra' | 'builtin';
  supportsHeadless: boolean;
  agents: AgentType[];
}

const allAgents: AgentType[] = ['hermes', 'antigravity', 'claude_code', 'codex', 'orchestrator'];

export const slashCommands: SlashCommand[] = [
  { name: '/clear', description: 'Clear the current Lyra conversation', source: 'lyra', supportsHeadless: true, agents: allAgents },
  { name: '/new', description: 'Create a new Lyra session', source: 'lyra', supportsHeadless: true, agents: allAgents },
  { name: '/stop', description: 'Stop the active response', source: 'lyra', supportsHeadless: true, agents: allAgents },
  { name: '/help', description: 'Show commands available for this agent', source: 'lyra', supportsHeadless: true, agents: allAgents },
  { name: '/resume', description: 'Resume or switch an agent conversation', source: 'builtin', supportsHeadless: false, agents: allAgents },
  { name: '/permissions', description: 'Open tool permission controls', source: 'builtin', supportsHeadless: false, agents: allAgents },
  { name: '/skills', description: 'Browse available skills', source: 'builtin', supportsHeadless: false, agents: allAgents },
  { name: '/mcp', description: 'Manage MCP servers', source: 'builtin', supportsHeadless: false, agents: allAgents },
  { name: '/init', description: 'Initialize project guidance files', source: 'builtin', supportsHeadless: true, agents: allAgents },
  { name: '/compact', description: 'Compact current context window', source: 'builtin', supportsHeadless: false, agents: allAgents },
];

export function getSlashCommands(agent: AgentType, query: string): SlashCommand[] {
  const normalized = query.toLowerCase();
  return slashCommands
    .filter((command) => command.agents.includes(agent) && command.name.startsWith(normalized))
    .slice(0, 12);
}

export function findSlashCommand(agent: AgentType, name: string): SlashCommand | undefined {
  return slashCommands.find((command) => command.agents.includes(agent) && command.name === name);
}

export function parseSlashCommand(input: string): { command: string; args: string } | null {
  const match = input.trim().match(/^(\/[^\s]+)(?:\s+([\s\S]*))?$/);
  return match ? { command: match[1] || '', args: match[2] || '' } : null;
}

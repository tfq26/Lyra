import { EventEmitter } from 'events';
import { AgentType } from './types';

export interface PipelineTask {
  id: string;
  fromAgent: AgentType;
  toAgent: AgentType;
  taskDescription: string;
  contextPayload: string;
  status: 'draft' | 'dispatched' | 'running' | 'completed';
  result?: string;
}

export class MessageBus extends EventEmitter {
  private tasks: Map<string, PipelineTask> = new Map();

  public createTask(from: AgentType, to: AgentType, description: string, context = ''): PipelineTask {
    const task: PipelineTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      fromAgent: from,
      toAgent: to,
      taskDescription: description,
      contextPayload: context,
      status: 'dispatched',
    };

    this.tasks.set(task.id, task);
    this.emit('task_created', task);
    return task;
  }

  public updateTask(id: string, updates: Partial<PipelineTask>) {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, updates);
    this.emit('task_updated', task);
    return task;
  }

  public getAllTasks(): PipelineTask[] {
    return Array.from(this.tasks.values());
  }
}

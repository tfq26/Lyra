import {
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
} from '@aws-sdk/client-ecs';
import { SqsTaskQueue, sqsTaskQueue, type SqsTaskEnvelope } from './sqsTaskQueue';

export interface NativeRunnerPayload {
  runtime: 'native';
  sessionId: string;
  runId: string;
  attemptId?: string;
  prompt: string;
  workspacePath: string;
  providerProfileId: string;
  tenantId: string;
  resume?: boolean;
}

export interface StoppedNativeTask {
  runId: string;
  sessionId?: string;
}

export class EcsNativeDispatcher {
  private readonly client: ECSClient;
  private readonly taskQueue: SqsTaskQueue<NativeRunnerPayload>;
  private readonly taskArns = new Map<string, string>();
  private readonly sessionRuns = new Map<string, string>();
  private readonly completedRuns = new Set<string>();
  private readonly cluster = process.env.LYRA_ECS_CLUSTER;
  private readonly taskDefinition = process.env.LYRA_RUNNER_TASK_DEFINITION;
  private readonly runnerWsUrl = process.env.LYRA_RUNNER_WS_URL;
  private readonly subnets = (process.env.LYRA_RUNNER_SUBNETS || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  private readonly securityGroups = (process.env.LYRA_RUNNER_SECURITY_GROUP || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  constructor(queue?: SqsTaskQueue<NativeRunnerPayload>) {
    this.client = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.taskQueue = (queue as SqsTaskQueue<NativeRunnerPayload>) || sqsTaskQueue;
  }

  public isConfigured(): boolean {
    if (process.env.LYRA_HOSTED !== 'true') return false;
    return Boolean(
      this.cluster &&
        this.taskDefinition &&
        this.runnerWsUrl?.startsWith('wss://') &&
        this.subnets.length &&
        this.securityGroups.length &&
        process.env.LYRA_RUNNER_TOKEN
    );
  }

  public shouldUseFargate(options?: { cloudExecution?: boolean }): boolean {
    return Boolean(
      (options?.cloudExecution || process.env.LYRA_EXECUTION_MODE === 'fargate') &&
        this.isConfigured()
    );
  }

  public async getTaskStatus(runId: string): Promise<{ running: boolean; taskArn?: string; status?: string }> {
    const taskArn = this.taskArns.get(runId) || (await this.findTaskArn(runId));
    if (!taskArn || !this.cluster) return { running: false };
    try {
      const described = await this.client.send(
        new DescribeTasksCommand({ cluster: this.cluster, tasks: [taskArn] })
      );
      const task = described.tasks?.[0];
      return {
        running: task?.lastStatus !== 'STOPPED',
        taskArn,
        status: task?.lastStatus || 'UNKNOWN',
      };
    } catch {
      return { running: false, taskArn };
    }
  }

  /**
   * Dispatches a run via Amazon SQS + S3 Claim-Check (eliminating the legacy 6,000-byte ECS
   * container override ceiling) and ensures a warm Fargate worker is active to consume it.
   */
  public async start(payload: NativeRunnerPayload): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error(
        'Hosted native agent execution requires an HTTPS runner WebSocket and isolated ECS Fargate task configuration.'
      );
    }

    const activeRunId = this.sessionRuns.get(payload.sessionId);
    if (activeRunId) {
      const stillRunning = await this.isRunRunning(activeRunId);
      if (!stillRunning && (this.completedRuns.has(activeRunId) || payload.resume)) {
        this.markStopped(activeRunId);
      } else {
        throw new Error(
          'This conversation already has an active native run. Wait for it to finish before starting another.'
        );
      }
    }

    const attemptId = payload.attemptId || `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payloadWithAttempt: NativeRunnerPayload = { ...payload, attemptId };
    this.sessionRuns.set(payload.sessionId, payload.runId);

    try {
      // 1. Prefer SQS + S3 Claim-Check decoupling when LYRA_RUN_QUEUE_URL is configured
      if (this.taskQueue.isAwsConfigured()) {
        const queued = await this.taskQueue.enqueue(payloadWithAttempt);

        // Check if an active warm SQS worker is already polling in the cluster
        const warmWorkerArn = await this.findWarmWorkerArn();
        if (warmWorkerArn) {
          this.taskArns.set(payload.runId, warmWorkerArn);
          return warmWorkerArn;
        }

        // Scale out a warm SQS long-polling Fargate worker from 0 -> 1
        const response = await this.client.send(
          new RunTaskCommand({
            cluster: this.cluster,
            taskDefinition: this.taskDefinition,
            launchType: 'FARGATE',
            platformVersion: 'LATEST',
            clientToken: attemptId.slice(0, 64),
            startedBy: 'lyra-warm-sqs-worker',
            count: 1,
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: this.subnets,
                securityGroups: this.securityGroups,
                assignPublicIp:
                  process.env.LYRA_RUNNER_ASSIGN_PUBLIC_IP === 'false' ? 'DISABLED' : 'ENABLED',
              },
            },
            overrides: {
              containerOverrides: [
                {
                  name: 'lyra-runner',
                  environment: [
                    { name: 'LYRA_RUNNER_MODE', value: 'sqs' },
                    { name: 'LYRA_INITIAL_MESSAGE_ID', value: queued.messageId },
                  ],
                },
              ],
            },
          })
        );

        if (response.failures?.length) {
          throw new Error(
            `ECS could not start warm SQS worker: ${response.failures
              .map((f) => f.reason || f.detail || 'unknown failure')
              .join('; ')}`
          );
        }
        const taskArn = response.tasks?.[0]?.taskArn;
        if (!taskArn) throw new Error('ECS accepted warm worker launch but returned no task ARN.');
        this.taskArns.set(payload.runId, taskArn);
        return taskArn;
      }

      // 2. Direct RunTask path with automatic S3 Claim-Check offload when payload > 6,000 bytes
      const serializedPayload = JSON.stringify(payloadWithAttempt);
      let envOverrides: Array<{ name: string; value: string }>;

      if (Buffer.byteLength(serializedPayload, 'utf8') > 6_000 && process.env.LYRA_ARTIFACT_BUCKET) {
        const queued = await this.taskQueue.enqueue(payloadWithAttempt, { forceClaimCheck: true });
        const envelope: SqsTaskEnvelope<NativeRunnerPayload> = {
          version: '1.0',
          envelopeId: queued.messageId,
          runId: payload.runId,
          sessionId: payload.sessionId,
          enqueuedAt: new Date().toISOString(),
          claimCheck: {
            bucket: process.env.LYRA_ARTIFACT_BUCKET,
            key: queued.claimCheckKey!,
            byteLength: queued.byteLength,
          },
        };
        envOverrides = [{ name: 'LYRA_RUNNER_ENVELOPE_JSON', value: JSON.stringify(envelope) }];
      } else {
        envOverrides = [{ name: 'LYRA_RUNNER_PAYLOAD_JSON', value: serializedPayload }];
      }

      const response = await this.client.send(
        new RunTaskCommand({
          cluster: this.cluster,
          taskDefinition: this.taskDefinition,
          launchType: 'FARGATE',
          platformVersion: 'LATEST',
          clientToken: attemptId.slice(0, 64),
          startedBy: `lyra-${payload.runId}`.slice(0, 36),
          count: 1,
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: this.subnets,
              securityGroups: this.securityGroups,
              assignPublicIp:
                process.env.LYRA_RUNNER_ASSIGN_PUBLIC_IP === 'false' ? 'DISABLED' : 'ENABLED',
            },
          },
          overrides: {
            containerOverrides: [{ name: 'lyra-runner', environment: envOverrides }],
          },
        })
      );

      if (response.failures?.length) {
        throw new Error(
          `ECS could not start the native worker: ${response.failures
            .map((failure) => failure.reason || failure.detail || 'unknown failure')
            .join('; ')}`
        );
      }
      const taskArn = response.tasks?.[0]?.taskArn;
      if (!taskArn) {
        throw new Error('ECS accepted the run request but returned no worker task ARN.');
      }
      this.taskArns.set(payload.runId, taskArn);
      return taskArn;
    } catch (error) {
      this.sessionRuns.delete(payload.sessionId);
      throw error;
    }
  }

  private async findWarmWorkerArn(): Promise<string | undefined> {
    if (!this.cluster) return undefined;
    try {
      const listed = await this.client.send(
        new ListTasksCommand({
          cluster: this.cluster,
          launchType: 'FARGATE',
          startedBy: 'lyra-warm-sqs-worker',
        })
      );
      const taskArn = listed.taskArns?.[0];
      if (!taskArn) return undefined;
      const described = await this.client.send(
        new DescribeTasksCommand({ cluster: this.cluster, tasks: [taskArn] })
      );
      return described.tasks?.[0]?.lastStatus === 'STOPPED' ? undefined : taskArn;
    } catch {
      return undefined;
    }
  }

  public async stop(runId: string, reason = 'Stopped by the user'): Promise<boolean> {
    const taskArn = this.taskArns.get(runId) || (await this.findTaskArn(runId));
    if (!taskArn || !this.cluster) return false;
    await this.client.send(
      new StopTaskCommand({ cluster: this.cluster, task: taskArn, reason: reason.slice(0, 255) })
    );
    this.taskArns.delete(runId);
    this.markStopped(runId);
    return true;
  }

  public async stopAll(reason = 'Hibernating due to inactivity'): Promise<void> {
    const runIds = Array.from(this.taskArns.keys());
    await Promise.all(runIds.map((runId) => this.stop(runId, reason)));
  }

  public markFinished(runId: string) {
    this.completedRuns.add(runId);
  }

  private markStopped(runId: string) {
    this.taskArns.delete(runId);
    this.completedRuns.delete(runId);
    for (const [sessionId, activeRunId] of this.sessionRuns) {
      if (activeRunId === runId) this.sessionRuns.delete(sessionId);
    }
  }

  public restoreActive(sessionId: string, runId: string) {
    this.sessionRuns.set(sessionId, runId);
  }

  private async findTaskArn(runId: string): Promise<string | undefined> {
    if (!this.cluster) return undefined;
    const listed = await this.client.send(
      new ListTasksCommand({
        cluster: this.cluster,
        launchType: 'FARGATE',
        startedBy: `lyra-${runId}`.slice(0, 36),
      })
    );
    const taskArn = listed.taskArns?.[0];
    if (!taskArn) return undefined;
    const described = await this.client.send(
      new DescribeTasksCommand({ cluster: this.cluster, tasks: [taskArn] })
    );
    return described.tasks?.[0]?.lastStatus === 'STOPPED' ? undefined : taskArn;
  }

  public async isRunRunning(runId: string): Promise<boolean> {
    return Boolean(await this.findTaskArn(runId));
  }

  public async reconcileStoppedTasks(): Promise<StoppedNativeTask[]> {
    if (!this.cluster || !this.taskArns.size) return [];
    const entries = [...this.taskArns.entries()];
    const response = await this.client.send(
      new DescribeTasksCommand({
        cluster: this.cluster,
        tasks: entries.map(([, taskArn]) => taskArn).slice(0, 100),
      })
    );
    const statusByArn = new Map(
      (response.tasks || []).map((task) => [task.taskArn || '', task.lastStatus || 'UNKNOWN'])
    );
    const stopped: StoppedNativeTask[] = [];
    for (const [runId, taskArn] of entries) {
      if (statusByArn.get(taskArn) !== 'STOPPED') continue;
      const sessionId = [...this.sessionRuns.entries()].find(
        ([, activeRunId]) => activeRunId === runId
      )?.[0];
      stopped.push({ runId, sessionId });
      this.markStopped(runId);
    }
    return stopped;
  }
}

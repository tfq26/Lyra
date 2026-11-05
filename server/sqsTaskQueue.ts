/**
 * AWS SQS Dispatch Queue + Dead-Letter Queue (DLQ) + S3 Claim-Check Engine
 *
 * Implements AWS Well-Architected Reliability & Performance Efficiency patterns:
 * 1. S3 Claim-Check Pattern: Payloads exceeding 6,000 bytes (previously crashing ECS RunTask
 *    environment overrides) are offloaded to encrypted S3 (`LYRA_ARTIFACT_BUCKET`) and replaced
 *    with a lightweight SQS pointer envelope.
 * 2. Warm Worker Long-Polling: `WaitTimeSeconds: 20` eliminates empty-receive spin and lets
 *    warm Fargate workers pick up jobs in milliseconds without 20s container cold starts.
 * 3. Lease Renewal Heartbeats: `ChangeMessageVisibility` extends message visibility while a
 *    worker is healthy; crashed workers stop heartbeating and redrive to `RunQueueDlq` (`maxReceiveCount: 3`).
 * 4. Seamless Local Fallback: Uses an in-process queue + claim-check store when `LYRA_RUN_QUEUE_URL`
 *    is unset so local development and unit tests run identically offline.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

export const CLAIM_CHECK_BYTE_THRESHOLD = 6_000;

export interface SqsTaskEnvelope<TPayload = Record<string, unknown>> {
  version: '1.0';
  envelopeId: string;
  runId: string;
  sessionId: string;
  enqueuedAt: string;
  claimCheck?: {
    bucket: string;
    key: string;
    byteLength: number;
  };
  inlinePayload?: TPayload;
}

export interface DequeuedTask<TPayload = Record<string, unknown>> {
  messageId: string;
  receiptHandle: string;
  receiveCount: number;
  usedClaimCheck: boolean;
  envelope: SqsTaskEnvelope<TPayload>;
  payload: TPayload;
}

export interface QueueHealthSnapshot {
  mode: 'aws-sqs' | 'local-memory';
  configured: boolean;
  queueUrl?: string;
  dlqUrl?: string;
  artifactBucket?: string;
  approximateVisible: number;
  approximateInFlight: number;
  approximateDlqVisible: number;
  claimChecksOffloaded: number;
  totalEnqueued: number;
  totalCompleted: number;
}

interface LocalQueueItem {
  messageId: string;
  body: string;
  receiveCount: number;
  receiptHandle?: string;
  invisibleUntil: number;
}

export class SqsTaskQueue<TPayload extends { runId: string; sessionId: string } = any> {
  private readonly sqs?: SQSClient;
  private readonly s3?: S3Client;
  private readonly queueUrl?: string;
  private readonly dlqUrl?: string;
  private readonly artifactBucket?: string;
  private readonly maxReceiveCount: number;

  // Local fallback state when AWS SQS env vars are not configured
  private readonly localQueue: LocalQueueItem[] = [];
  private readonly localDlq: LocalQueueItem[] = [];
  private readonly localClaimStore = new Map<string, string>();

  private claimChecksOffloaded = 0;
  private totalEnqueued = 0;
  private totalCompleted = 0;

  constructor(options?: {
    region?: string;
    queueUrl?: string;
    dlqUrl?: string;
    artifactBucket?: string;
    maxReceiveCount?: number;
    sqsClient?: SQSClient;
    s3Client?: S3Client;
  }) {
    const region = options?.region || process.env.AWS_REGION || 'us-east-1';
    this.queueUrl = options?.queueUrl ?? process.env.LYRA_RUN_QUEUE_URL;
    this.dlqUrl = options?.dlqUrl ?? process.env.LYRA_RUN_DLQ_URL;
    this.artifactBucket = options?.artifactBucket ?? process.env.LYRA_ARTIFACT_BUCKET;
    this.maxReceiveCount = options?.maxReceiveCount ?? 3;

    if (this.queueUrl) {
      this.sqs = options?.sqsClient || new SQSClient({ region });
    }
    if (this.artifactBucket) {
      this.s3 = options?.s3Client || new S3Client({ region });
    }
  }

  public isAwsConfigured(): boolean {
    return Boolean(this.queueUrl && this.sqs);
  }

  /**
   * Enqueues a runner task, automatically offloading payloads > 6,000 bytes via S3 Claim-Check.
   */
  public async enqueue(
    payload: TPayload,
    options?: { forceClaimCheck?: boolean }
  ): Promise<{
    messageId: string;
    usedClaimCheck: boolean;
    claimCheckKey?: string;
    byteLength: number;
  }> {
    const serialized = JSON.stringify(payload);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    const shouldOffload =
      Boolean(options?.forceClaimCheck) || byteLength > CLAIM_CHECK_BYTE_THRESHOLD;

    const envelopeId = `env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let envelope: SqsTaskEnvelope<TPayload>;
    let claimCheckKey: string | undefined;

    if (shouldOffload) {
      const safeRun = payload.runId.replace(/[^a-zA-Z0-9_-]/g, '-');
      claimCheckKey = `lyra/claim-checks/${safeRun}/${envelopeId}.json`;
      const bucketName = this.artifactBucket || 'local-memory-artifact-bucket';

      if (this.s3 && this.artifactBucket && this.isAwsConfigured()) {
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.artifactBucket,
            Key: claimCheckKey,
            Body: serialized,
            ContentType: 'application/json',
            ServerSideEncryption: 'AES256',
          })
        );
      } else {
        this.localClaimStore.set(`${bucketName}/${claimCheckKey}`, serialized);
      }

      this.claimChecksOffloaded += 1;
      envelope = {
        version: '1.0',
        envelopeId,
        runId: payload.runId,
        sessionId: payload.sessionId,
        enqueuedAt: new Date().toISOString(),
        claimCheck: {
          bucket: bucketName,
          key: claimCheckKey,
          byteLength,
        },
      };
    } else {
      envelope = {
        version: '1.0',
        envelopeId,
        runId: payload.runId,
        sessionId: payload.sessionId,
        enqueuedAt: new Date().toISOString(),
        inlinePayload: payload,
      };
    }

    const messageBody = JSON.stringify(envelope);
    this.totalEnqueued += 1;

    if (this.isAwsConfigured() && this.sqs && this.queueUrl) {
      const res = await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: messageBody,
          MessageAttributes: {
            RunId: { DataType: 'String', StringValue: payload.runId },
            SessionId: { DataType: 'String', StringValue: payload.sessionId },
            ClaimCheck: { DataType: 'String', StringValue: shouldOffload ? 'true' : 'false' },
          },
        })
      );
      return {
        messageId: res.MessageId || envelopeId,
        usedClaimCheck: shouldOffload,
        claimCheckKey,
        byteLength,
      };
    }

    const localMessageId = `local-msg-${envelopeId}`;
    this.localQueue.push({
      messageId: localMessageId,
      body: messageBody,
      receiveCount: 0,
      invisibleUntil: 0,
    });

    return {
      messageId: localMessageId,
      usedClaimCheck: shouldOffload,
      claimCheckKey,
      byteLength,
    };
  }

  /**
   * Long-polls for the next available task and hydrates any S3 Claim-Check payload transparently.
   */
  public async pollOnce(options?: {
    waitTimeSeconds?: number;
    visibilityTimeoutSeconds?: number;
  }): Promise<DequeuedTask<TPayload> | null> {
    const waitTimeSeconds = options?.waitTimeSeconds ?? 20;
    const visibilityTimeoutSeconds = options?.visibilityTimeoutSeconds ?? 180;

    if (this.isAwsConfigured() && this.sqs && this.queueUrl) {
      const res = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: waitTimeSeconds,
          VisibilityTimeout: visibilityTimeoutSeconds,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        })
      );

      const msg = res.Messages?.[0];
      if (!msg || !msg.Body || !msg.ReceiptHandle) return null;

      const receiveCount = Number(msg.Attributes?.ApproximateReceiveCount || '1');
      const envelope = JSON.parse(msg.Body) as SqsTaskEnvelope<TPayload>;
      const payload = await this.hydratePayload(envelope);

      return {
        messageId: msg.MessageId || envelope.envelopeId,
        receiptHandle: msg.ReceiptHandle,
        receiveCount,
        usedClaimCheck: Boolean(envelope.claimCheck),
        envelope,
        payload,
      };
    }

    // Local fallback consumer with redrive-to-DLQ semantics matching AWS SQS
    const now = Date.now();
    for (let i = 0; i < this.localQueue.length; i++) {
      const item = this.localQueue[i]!;
      if (item.invisibleUntil > now) continue;

      item.receiveCount += 1;
      if (item.receiveCount > this.maxReceiveCount) {
        this.localQueue.splice(i, 1);
        this.localDlq.push(item);
        i--;
        continue;
      }

      item.receiptHandle = `receipt-${item.messageId}-${item.receiveCount}-${now}`;
      item.invisibleUntil = now + visibilityTimeoutSeconds * 1000;

      const envelope = JSON.parse(item.body) as SqsTaskEnvelope<TPayload>;
      const payload = await this.hydratePayload(envelope);

      return {
        messageId: item.messageId,
        receiptHandle: item.receiptHandle,
        receiveCount: item.receiveCount,
        usedClaimCheck: Boolean(envelope.claimCheck),
        envelope,
        payload,
      };
    }

    return null;
  }

  /**
   * Hydrates an envelope by downloading the full payload from S3 if a Claim-Check pointer is present.
   */
  public async hydratePayload(envelope: SqsTaskEnvelope<TPayload>): Promise<TPayload> {
    if (envelope.inlinePayload) {
      return envelope.inlinePayload;
    }

    if (!envelope.claimCheck) {
      throw new Error(`Invalid SQS task envelope ${envelope.envelopeId}: missing inlinePayload and claimCheck.`);
    }

    const { bucket, key } = envelope.claimCheck;
    const localKey = `${bucket}/${key}`;
    if (this.localClaimStore.has(localKey)) {
      return JSON.parse(this.localClaimStore.get(localKey)!) as TPayload;
    }

    if (!this.s3) {
      throw new Error(`Cannot hydrate S3 claim-check s3://${bucket}/${key}: S3 client not initialized.`);
    }

    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    const raw = await response.Body?.transformToString('utf-8');
    if (!raw) {
      throw new Error(`Empty S3 claim-check object at s3://${bucket}/${key}.`);
    }
    return JSON.parse(raw) as TPayload;
  }

  /**
   * Acknowledges and deletes a completed task message from the queue.
   */
  public async complete(receiptHandle: string): Promise<void> {
    this.totalCompleted += 1;
    if (this.isAwsConfigured() && this.sqs && this.queueUrl) {
      await this.sqs.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: receiptHandle,
        })
      );
      return;
    }

    const idx = this.localQueue.findIndex((item) => item.receiptHandle === receiptHandle);
    if (idx >= 0) {
      const [removed] = this.localQueue.splice(idx, 1);
      if (removed) {
        try {
          const env = JSON.parse(removed.body) as SqsTaskEnvelope<TPayload>;
          if (env.claimCheck) {
            this.localClaimStore.delete(`${env.claimCheck.bucket}/${env.claimCheck.key}`);
          }
        } catch {}
      }
    }
  }

  /**
   * Extends message visibility timeout while a worker is actively processing a task.
   */
  public async extendVisibility(receiptHandle: string, visibilityTimeoutSeconds = 180): Promise<void> {
    if (this.isAwsConfigured() && this.sqs && this.queueUrl) {
      await this.sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: visibilityTimeoutSeconds,
        })
      );
      return;
    }

    const item = this.localQueue.find((q) => q.receiptHandle === receiptHandle);
    if (item) {
      item.invisibleUntil = Date.now() + visibilityTimeoutSeconds * 1000;
    }
  }

  /**
   * Releases a message immediately (e.g., on transient retryable failure) so it can be retried
   * or redriven to the DLQ after `maxReceiveCount`.
   */
  public async releaseForRetry(receiptHandle: string, backoffSeconds = 0): Promise<void> {
    await this.extendVisibility(receiptHandle, backoffSeconds);
  }

  /**
   * Starts a periodic visibility heartbeat timer for long-running swarm/Fargate jobs.
   */
  public startVisibilityHeartbeat(
    receiptHandle: string,
    options?: { intervalMs?: number; visibilityTimeoutSeconds?: number }
  ): () => void {
    const visibilityTimeoutSeconds = options?.visibilityTimeoutSeconds ?? 180;
    const intervalMs = options?.intervalMs ?? Math.max(15_000, Math.floor((visibilityTimeoutSeconds * 1000) / 3));

    const timer = setInterval(() => {
      void this.extendVisibility(receiptHandle, visibilityTimeoutSeconds).catch(() => undefined);
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();

    return () => clearInterval(timer);
  }

  /**
   * Queries live queue depth & DLQ attributes for CloudWatch EMF and the `/console` dashboard.
   */
  public async getQueueHealth(): Promise<QueueHealthSnapshot> {
    if (this.isAwsConfigured() && this.sqs && this.queueUrl) {
      try {
        const mainAttrs = await this.sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: this.queueUrl,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
            ],
          })
        );

        let dlqVisible = 0;
        if (this.dlqUrl) {
          const dlqAttrs = await this.sqs.send(
            new GetQueueAttributesCommand({
              QueueUrl: this.dlqUrl,
              AttributeNames: ['ApproximateNumberOfMessages'],
            })
          );
          dlqVisible = Number(dlqAttrs.Attributes?.ApproximateNumberOfMessages || '0');
        }

        return {
          mode: 'aws-sqs',
          configured: true,
          queueUrl: this.queueUrl,
          dlqUrl: this.dlqUrl,
          artifactBucket: this.artifactBucket,
          approximateVisible: Number(mainAttrs.Attributes?.ApproximateNumberOfMessages || '0'),
          approximateInFlight: Number(
            mainAttrs.Attributes?.ApproximateNumberOfMessagesNotVisible || '0'
          ),
          approximateDlqVisible: dlqVisible,
          claimChecksOffloaded: this.claimChecksOffloaded,
          totalEnqueued: this.totalEnqueued,
          totalCompleted: this.totalCompleted,
        };
      } catch {
        // Degrade gracefully if AWS network is unreachable
      }
    }

    const now = Date.now();
    const visible = this.localQueue.filter((q) => q.invisibleUntil <= now).length;
    const inFlight = this.localQueue.length - visible;

    return {
      mode: this.isAwsConfigured() ? 'aws-sqs' : 'local-memory',
      configured: this.isAwsConfigured(),
      queueUrl: this.queueUrl,
      dlqUrl: this.dlqUrl,
      artifactBucket: this.artifactBucket,
      approximateVisible: visible,
      approximateInFlight: inFlight,
      approximateDlqVisible: this.localDlq.length,
      claimChecksOffloaded: this.claimChecksOffloaded,
      totalEnqueued: this.totalEnqueued,
      totalCompleted: this.totalCompleted,
    };
  }
}

export const sqsTaskQueue = new SqsTaskQueue();

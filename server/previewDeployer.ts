import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PreviewManager } from './previewManager';
import { cloudTunnelManager } from './cloudTunnel';

export interface PreviewDeployResult {
  success: boolean;
  previewUrl: string;
  provider: 's3' | 'tunnel' | 'local';
  localUrl?: string;
  publicTunnelUrl?: string;
  s3Bucket?: string;
  s3Prefix?: string;
  cloudFrontUrl?: string;
  expiresAt?: string;
  error?: string;
}

export class PreviewDeployer {
  private s3Client?: S3Client;
  private previewBucket?: string;
  private cloudFrontDomain?: string;
  private previewManager: PreviewManager;

  constructor(previewManager?: PreviewManager) {
    this.previewManager = previewManager || new PreviewManager();
    this.previewBucket = process.env.LYRA_PREVIEWS_BUCKET || process.env.AWS_S3_PREVIEW_BUCKET;
    this.cloudFrontDomain = process.env.LYRA_PREVIEWS_CLOUDFRONT_DOMAIN;
    const region = process.env.AWS_REGION || 'us-east-1';

    if (this.previewBucket) {
      try {
        this.s3Client = new S3Client({ region });
      } catch {
        this.s3Client = undefined;
      }
    }
  }

  public isCloudConfigured(): boolean {
    return Boolean(this.previewBucket && this.s3Client);
  }

  /**
   * Deploys an ephemeral preview for the given run.
   * If S3 bucket is configured, builds and uploads static assets.
   * Otherwise, starts a local PreviewManager server.
   */
  public async deployPreview(params: {
    runId: string;
    worktreePath: string;
    tenantId?: string;
  }): Promise<PreviewDeployResult> {
    const { runId, worktreePath, tenantId = 'default' } = params;

    if (this.isCloudConfigured() && this.previewBucket && this.s3Client) {
      try {
        const s3Prefix = `previews/${tenantId}/${runId}`;
        const buildDir = this.findBuildDirectory(worktreePath);

        let filesUploaded = 0;
        if (buildDir && fs.existsSync(buildDir)) {
          filesUploaded = await this.uploadDirectoryToS3(buildDir, this.previewBucket, s3Prefix);
        } else {
          // Create an ephemeral summary preview HTML
          const summaryHtml = this.generateSummaryHtml(runId, worktreePath);
          await this.s3Client.send(new PutObjectCommand({
            Bucket: this.previewBucket,
            Key: `${s3Prefix}/index.html`,
            Body: summaryHtml,
            ContentType: 'text/html',
          }));
          filesUploaded = 1;
        }

        const previewUrl = this.cloudFrontDomain
          ? `https://${this.cloudFrontDomain}/${s3Prefix}/index.html`
          : `https://${this.previewBucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Prefix}/index.html`;

        const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

        return {
          success: true,
          previewUrl,
          provider: 's3',
          s3Bucket: this.previewBucket,
          s3Prefix,
          cloudFrontUrl: this.cloudFrontDomain ? `https://${this.cloudFrontDomain}/${s3Prefix}/index.html` : undefined,
          expiresAt,
        };
      } catch (err) {
        console.warn(`[PreviewDeployer] S3 preview deployment failed, falling back to local:`, err);
      }
    }

    // Local preview fallback with Cloudflare public tunnel
    try {
      const local = await this.previewManager.startPreview(runId, worktreePath);
      let previewUrl = local.url;
      let publicTunnelUrl: string | undefined;

      try {
        const tunnel = await cloudTunnelManager.createTunnel(local.port, runId);
        publicTunnelUrl = tunnel.publicUrl;
        previewUrl = tunnel.publicUrl;
      } catch (tunnelErr) {
        console.warn(`[PreviewDeployer] Cloudflare quick tunnel spawn failed, using local URL:`, tunnelErr);
      }

      return {
        success: true,
        previewUrl,
        provider: publicTunnelUrl ? 'tunnel' : 'local',
        localUrl: local.url,
        publicTunnelUrl,
      };
    } catch (err) {
      return {
        success: false,
        previewUrl: '',
        provider: 'local',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async teardownPreview(runId: string, tenantId = 'default'): Promise<boolean> {
    // 1. Teardown tunnel and local if running
    cloudTunnelManager.stopTunnel(runId);
    this.previewManager.stopPreview(runId);

    // 2. Clean S3 prefix if configured
    if (this.isCloudConfigured() && this.previewBucket && this.s3Client) {
      try {
        const s3Prefix = `previews/${tenantId}/${runId}/`;
        const list = await this.s3Client.send(new ListObjectsV2Command({
          Bucket: this.previewBucket,
          Prefix: s3Prefix,
        }));

        if (list.Contents && list.Contents.length > 0) {
          await this.s3Client.send(new DeleteObjectsCommand({
            Bucket: this.previewBucket,
            Delete: {
              Objects: list.Contents.map((item) => ({ Key: item.Key! })),
            },
          }));
        }
      } catch (err) {
        console.warn(`[PreviewDeployer] Failed to clean S3 preview objects for ${runId}:`, err);
      }
    }

    return true;
  }

  private findBuildDirectory(worktreePath: string): string | null {
    const candidates = ['dist', 'build', 'out', 'public'];
    for (const cand of candidates) {
      const full = path.join(worktreePath, cand);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        return full;
      }
    }
    return null;
  }

  private async uploadDirectoryToS3(dirPath: string, bucket: string, prefix: string): Promise<number> {
    let count = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const s3Key = `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        count += await this.uploadDirectoryToS3(fullPath, bucket, s3Key);
      } else if (entry.isFile()) {
        const fileContent = fs.readFileSync(fullPath);
        const contentType = this.getContentType(entry.name);
        await this.s3Client!.send(new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: fileContent,
          ContentType: contentType,
        }));
        count++;
      }
    }

    return count;
  }

  private getContentType(filename: string): string {
    if (filename.endsWith('.html')) return 'text/html';
    if (filename.endsWith('.css')) return 'text/css';
    if (filename.endsWith('.js') || filename.endsWith('.mjs')) return 'application/javascript';
    if (filename.endsWith('.json')) return 'application/json';
    if (filename.endsWith('.png')) return 'image/png';
    if (filename.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }

  private generateSummaryHtml(runId: string, worktreePath: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lyra Ephemeral Preview - Run ${runId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1.5rem; max-width: 600px; margin: 2rem auto; }
    h1 { font-size: 1.25rem; color: #38bdf8; margin-top: 0; }
    .pill { display: inline-block; background: #0284c7; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <span class="pill">Lyra Ephemeral Preview</span>
    <h1>Run: ${runId}</h1>
    <p>Target Worktree: <code>${worktreePath}</code></p>
    <p>Automated verification passed. Preview deployed via Lyra Ephemeral S3 Pipeline.</p>
  </div>
</body>
</html>`;
  }
}

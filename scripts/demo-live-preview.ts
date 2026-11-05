import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { cloudTunnelManager } from '../server/cloudTunnel';
import { VisualCapture } from '../server/visualCapture';
import { VisualCritic } from '../server/visualCritic';

async function main() {
  const targetDir = '/Users/taufeeqali/Projects/CollabCanvas';
  console.log(`\n🚀 [Lyra Live Validation] Validating real project: ${targetDir}`);

  // 1. Check if preview server is already running on 5175, or start it
  let previewProc: any = null;
  const port = 5175;

  let isListening = false;
  try {
    const res = await fetch(`http://localhost:${port}`);
    if (res.ok || res.status === 200 || res.status === 404) {
      isListening = true;
    }
  } catch {}

  if (!isListening) {
    console.log(`📦 Starting CollabCanvas preview on port ${port}...`);
    previewProc = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--host', '0.0.0.0'], {
      cwd: targetDir,
      stdio: 'ignore',
    });

    // Wait up to 5 seconds for port to open
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(`http://localhost:${port}`);
        if (res.ok || res.status === 200 || res.status === 404) {
          isListening = true;
          break;
        }
      } catch {}
    }
  }

  if (!isListening) {
    console.error(`❌ Could not connect to preview server on port ${port}`);
    process.exit(1);
  }

  console.log(`✅ Local preview server active at http://localhost:${port}`);

  // 2. Establish public Cloudflare Tunnel
  console.log(`🌐 Spawning Cloudflare quick tunnel for port ${port}...`);
  const tunnel = await cloudTunnelManager.createTunnel(port, `collabcanvas-${Date.now()}`);
  console.log(`\n======================================================`);
  console.log(`🔗 LIVE PUBLIC PREVIEW URL:`);
  console.log(`   👉 ${tunnel.publicUrl}`);
  console.log(`   (Both you and the agent swarm can view this live now!)`);
  console.log(`======================================================\n`);

  // 3. Playwright Visual Capture
  console.log(`📸 Launching Playwright to capture desktop and mobile viewports...`);
  const capture = new VisualCapture('.lyra/screenshots');
  const captureReport = await capture.capturePreview(tunnel.publicUrl, 'collabcanvas-live');

  if (!captureReport.success && captureReport.screenshots.length === 0) {
    console.error(`❌ Screenshot capture failed: ${captureReport.error}`);
    process.exit(1);
  }

  console.log(`✨ Captured ${captureReport.screenshots.length} screenshot(s):`);
  for (const s of captureReport.screenshots) {
    console.log(`   - ${s.viewport} (${s.width}x${s.height}): ${s.filePath}`);
  }

  // 4. AWS Bedrock Multimodal Visual Critic
  console.log(`\n🧠 Running AWS Bedrock Multimodal Visual Critic (Claude 3.5 Sonnet / Nova Pro)...`);
  const critic = new VisualCritic({ passScoreThreshold: 80 });
  const critique = await critic.evaluate(captureReport.screenshots, {
    url: tunnel.publicUrl,
    objective: 'Collaborative sticky note canvas with FigJam-grade floating toolbar, top bar, and tactile notes.',
    consoleErrors: captureReport.consoleErrors,
    pageErrors: captureReport.pageErrors,
  });

  console.log(`\n📊 [Visual Critic Scorecard]`);
  console.log(`   Score: ${critique.score} / 100 (${critique.passed ? 'PASSED CRAFT GATE' : 'NEEDS POLISH'})`);
  console.log(`   Summary: ${critique.summary}`);
  if (critique.defects.length > 0) {
    console.log(`   Defects Detected (${critique.defects.length}):`);
    for (const d of critique.defects) {
      console.log(`     - [${d.severity.toUpperCase()}] (${d.category}): ${d.description}`);
      console.log(`       Fix: ${d.suggestedFix}`);
    }
  } else {
    console.log(`   Defects: None detected! Clean visual layout.`);
  }

  console.log(`\n🎉 End-to-end validation complete! Live tunnel remains active for inspection.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

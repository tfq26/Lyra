import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCandidateFiles, formatCandidateFilesSection } from './repoScanner';

describe('RepoScanner - Deterministic 0-Token File Discovery', () => {
  it('identifies relevant target files from objective keywords without invoking any model', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-scanner-test-'));

    // Create realistic project layout
    fs.mkdirSync(path.join(tempDir, 'src/Draco.Api'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'src/Draco.Core'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'bin/Debug'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'node_modules/foo'), { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'src/Draco.Api/Program.cs'), '// main entrypoint\nvar app = builder.Build();');
    fs.writeFileSync(path.join(tempDir, 'src/Draco.Api/HealthEndpoints.cs'), '// health endpoints');
    fs.writeFileSync(path.join(tempDir, 'src/Draco.Core/User.cs'), '// domain model');
    fs.writeFileSync(path.join(tempDir, 'bin/Debug/Draco.Api.dll'), 'binary');
    fs.writeFileSync(path.join(tempDir, 'node_modules/foo/index.js'), 'vendor');

    const candidates = findCandidateFiles(tempDir, 'Add health and readiness endpoints in Draco.Api');

    // Should ignore bin and node_modules
    expect(candidates.some((c) => c.relativePath.includes('bin/'))).toBe(false);
    expect(candidates.some((c) => c.relativePath.includes('node_modules/'))).toBe(false);

    // Should prioritize HealthEndpoints.cs and Program.cs
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.relativePath).toContain('HealthEndpoints.cs');
    expect(candidates.some((c) => c.relativePath.includes('Program.cs'))).toBe(true);

    const formatted = formatCandidateFilesSection(candidates);
    expect(formatted).toContain('Identified Candidate Target Files');
    expect(formatted).toContain('HealthEndpoints.cs');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

import { describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import { GitHubAppAuth } from './githubAppAuth';

describe('GitHubAppAuth', () => {
  // Generate temporary 2048-bit RSA keypair for testing
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const appId = '123456';
  const appAuth = new GitHubAppAuth({
    appId,
    privateKey,
    installationId: '789012',
  });

  it('generates a valid RS256 JWT verifiable by RSA public key', () => {
    const jwt = appAuth.generateJwt();
    expect(jwt).toBeDefined();

    const parts = jwt.split('.');
    expect(parts.length).toBe(3);

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString('utf-8'));
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf-8'));

    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
    expect(payload.iss).toBe(appId);
    expect(payload.exp).toBeGreaterThan(payload.iat);

    // Cryptographic verification
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const isValid = verifier.verify(publicKey, signatureB64!, 'base64url');
    expect(isValid).toBe(true);
  });

  it('formats authenticated Git clone/push URLs correctly', () => {
    const gitUrl = appAuth.formatGitUrl('ghs_testToken12345', 'tfq26', 'Duit');
    expect(gitUrl).toBe('https://x-access-token:ghs_testToken12345@github.com/tfq26/Duit.git');
  });
});

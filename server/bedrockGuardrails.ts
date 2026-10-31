import { BedrockRuntimeClient, ApplyGuardrailCommand } from '@aws-sdk/client-bedrock-runtime';

export interface GuardrailViolation {
  type: 'SECRET_EXPOSURE' | 'DESTRUCTIVE_COMMAND' | 'PII' | 'POLICY_VIOLATION';
  description: string;
  detectedPattern?: string;
}

export interface GuardrailAssessmentResult {
  action: 'NONE' | 'BLOCKED';
  violations: GuardrailViolation[];
  sanitizedText?: string;
}

const SENSITIVE_PATTERNS: Array<{
  type: GuardrailViolation['type'];
  description: string;
  regex: RegExp;
}> = [
  {
    type: 'SECRET_EXPOSURE',
    description: 'AWS Access Key ID detected',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  {
    type: 'SECRET_EXPOSURE',
    description: 'GitHub Personal Access Token detected',
    regex: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g,
  },
  {
    type: 'SECRET_EXPOSURE',
    description: 'Private Cryptographic Key detected',
    regex: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----[\s\S]*?-----END/gi,
  },
  {
    type: 'DESTRUCTIVE_COMMAND',
    description: 'Destructive root filesystem wipe command detected',
    regex: /\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\s+(?:\/|\/\*|~\/|\$HOME)(?:\s|$|;)/gi,
  },
  {
    type: 'DESTRUCTIVE_COMMAND',
    description: 'Shell fork bomb detected',
    regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/g,
  },
  {
    type: 'DESTRUCTIVE_COMMAND',
    description: 'Direct raw disk overwrite command detected',
    regex: /\bdd\s+if=\/dev\/(?:zero|urandom)\s+of=\/dev\/(?:sd[a-z]|nvme[0-9]n[0-9]|disk[0-9])/gi,
  },
  {
    type: 'PII',
    description: 'Social Security Number detected',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
];

export class BedrockGuardrailService {
  private client?: BedrockRuntimeClient;
  private guardrailId?: string;
  private guardrailVersion: string;

  constructor(options?: { guardrailId?: string; guardrailVersion?: string; region?: string }) {
    this.guardrailId = options?.guardrailId || process.env.AWS_BEDROCK_GUARDRAIL_ID || process.env.BEDROCK_GUARDRAIL_ID;
    this.guardrailVersion = options?.guardrailVersion || process.env.AWS_BEDROCK_GUARDRAIL_VERSION || 'DRAFT';
    const region = options?.region || process.env.AWS_REGION || 'us-east-1';

    if (this.guardrailId) {
      try {
        this.client = new BedrockRuntimeClient({ region });
      } catch {
        // Fallback to local rule enforcement if AWS client init fails
        this.client = undefined;
      }
    }
  }

  public isCloudGuardrailConfigured(): boolean {
    return Boolean(this.guardrailId && this.client);
  }

  /**
   * Apply guardrails across both local pattern detectors and optional AWS Bedrock Guardrails
   */
  public async assessContent(text: string, source: 'INPUT' | 'OUTPUT' = 'INPUT'): Promise<GuardrailAssessmentResult> {
    const violations: GuardrailViolation[] = [];
    let sanitizedText = text;

    // 1. Fast local pattern detection
    for (const pattern of SENSITIVE_PATTERNS) {
      const matches = text.match(pattern.regex);
      if (matches && matches.length > 0) {
        violations.push({
          type: pattern.type,
          description: pattern.description,
          detectedPattern: matches[0].slice(0, 8) + '***',
        });
        // Sanitize
        sanitizedText = sanitizedText.replace(pattern.regex, '[REDACTED_BY_GUARDRAIL]');
      }
    }

    // 2. AWS Bedrock Guardrails API call (if configured)
    if (this.isCloudGuardrailConfigured() && this.client && this.guardrailId) {
      try {
        const command = new ApplyGuardrailCommand({
          guardrailIdentifier: this.guardrailId,
          guardrailVersion: this.guardrailVersion,
          source: source,
          content: [{ text: { text } }],
        });
        const response = await this.client.send(command);

        if (response.action === 'GUARDRAIL_INTERVENED') {
          violations.push({
            type: 'POLICY_VIOLATION',
            description: 'AWS Bedrock Guardrail policy triggered on content evaluation.',
          });
          if (response.outputs?.[0]?.text) {
            sanitizedText = response.outputs[0].text;
          }
        }
      } catch (err) {
        console.warn('[BedrockGuardrailService] Cloud guardrail assessment warning:', err);
      }
    }

    return {
      action: violations.length > 0 ? 'BLOCKED' : 'NONE',
      violations,
      sanitizedText: violations.length > 0 ? sanitizedText : text,
    };
  }

  public async screenPrompt(prompt: string): Promise<GuardrailAssessmentResult> {
    return this.assessContent(prompt, 'INPUT');
  }

  public async screenCompletion(completion: string): Promise<GuardrailAssessmentResult> {
    return this.assessContent(completion, 'OUTPUT');
  }
}

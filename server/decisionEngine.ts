import { BedrockGuardrailService } from './bedrockGuardrails';

export interface DecisionViolation {
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  target?: string;
}

export interface DecisionVerdict {
  allowed: boolean;
  action: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  violations: DecisionViolation[];
  rationale: string;
}

export interface DecisionContext {
  stage: 'plan' | 'tool_execution' | 'pre_merge';
  objective?: string;
  filesChanged?: string[];
  diff?: string;
  command?: string;
  networkHost?: string;
  allowedHosts?: string[];
  maxFilesPerTask?: number;
}

export class DecisionEngine {
  private guardrails: BedrockGuardrailService;
  private defaultAllowedHosts = new Set(['github.com', 'api.github.com', 'registry.npmjs.org', 'bun.sh', 'amazonaws.com']);

  constructor(guardrails?: BedrockGuardrailService) {
    this.guardrails = guardrails || new BedrockGuardrailService();
  }

  /**
   * Grounded decision gatekeeper: Evaluates context against policy invariants.
   */
  public async evaluate(context: DecisionContext): Promise<DecisionVerdict> {
    const violations: DecisionViolation[] = [];

    // 1. Guardrail Screening (Secret Leaks & Destructive Commands)
    if (context.diff) {
      const guardResult = await this.guardrails.screenPrompt(context.diff);
      if (guardResult.action === 'BLOCKED') {
        for (const v of guardResult.violations) {
          violations.push({
            rule: `SECURITY_${v.type}`,
            severity: 'critical',
            message: `Guardrail violation: ${v.description}`,
            target: v.detectedPattern,
          });
        }
      }
    }

    if (context.command) {
      const cmdCheck = await this.guardrails.screenPrompt(context.command);
      if (cmdCheck.action === 'BLOCKED') {
        for (const v of cmdCheck.violations) {
          violations.push({
            rule: `COMMAND_${v.type}`,
            severity: 'critical',
            message: `Command blocked: ${v.description}`,
            target: context.command,
          });
        }
      }
    }

    // 2. Blast Radius Enforcement
    const maxFiles = context.maxFilesPerTask ?? 20;
    if (context.filesChanged && context.filesChanged.length > maxFiles) {
      violations.push({
        rule: 'BLAST_RADIUS_EXCEEDED',
        severity: 'high',
        message: `Task modified ${context.filesChanged.length} files (exceeding safety ceiling of ${maxFiles}). Requires user review.`,
      });
    }

    // 3. Database Schema Breaking Change Canary
    if (context.diff) {
      if (/\bDROP\s+TABLE\b/i.test(context.diff)) {
        violations.push({
          rule: 'BREAKING_SCHEMA_DROP_TABLE',
          severity: 'critical',
          message: 'Destructive DROP TABLE detected in migration diff. Breaches backward compatibility invariant.',
        });
      }
      if (/\bDROP\s+COLUMN\b/i.test(context.diff)) {
        violations.push({
          rule: 'BREAKING_SCHEMA_DROP_COLUMN',
          severity: 'critical',
          message: 'Destructive DROP COLUMN detected in migration diff without phased deprecation.',
        });
      }
    }

    // 4. Unauthorized Network Egress Gate
    if (context.networkHost) {
      const allowed = new Set([...this.defaultAllowedHosts, ...(context.allowedHosts || [])]);
      const hostMatch = Array.from(allowed).some((h) => context.networkHost!.endsWith(h));
      if (!hostMatch) {
        violations.push({
          rule: 'UNAUTHORIZED_NETWORK_EGRESS',
          severity: 'high',
          message: `Network egress to host "${context.networkHost}" is not on the allowed list.`,
          target: context.networkHost,
        });
      }
    }

    const hasCritical = violations.some((v) => v.severity === 'critical');
    const hasHigh = violations.some((v) => v.severity === 'high');

    let action: DecisionVerdict['action'] = 'ALLOW';
    let allowed = true;

    if (hasCritical) {
      action = 'DENY';
      allowed = false;
    } else if (hasHigh) {
      action = 'REQUIRE_APPROVAL';
      allowed = false;
    }

    const rationale = violations.length === 0
      ? 'All policy invariants satisfied. Action is grounded and compliant.'
      : `Action triggers ${violations.length} policy invariant violation(s): ${violations.map((v) => v.message).join('; ')}`;

    return {
      allowed,
      action,
      violations,
      rationale,
    };
  }
}

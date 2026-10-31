export interface CostDeltaItem {
  resource: string;
  category: 'compute' | 'database' | 'storage' | 'network' | 'ai';
  monthlyDeltaUsd: number;
  explanation: string;
}

export interface FinOpsAnalysisResult {
  monthlyTotalDeltaUsd: number;
  items: CostDeltaItem[];
  warnings: string[];
  summary: string;
}

/**
 * AWS Standard us-east-1 Baseline Rates
 */
const RATES = {
  FARGATE_VCPU_PER_HOUR: 0.04048,
  FARGATE_GB_PER_HOUR: 0.004445,
  NAT_GATEWAY_PER_MONTH: 32.85,
  ALB_BASE_PER_MONTH: 16.20,
  RDS_T4G_MICRO_PER_MONTH: 12.41,
  S3_GB_PER_MONTH: 0.023,
  HOURS_PER_MONTH: 730,
};

export class FinOpsAnalyzer {
  public analyzeCloudFormation(templateYaml: string): FinOpsAnalysisResult {
    const items: CostDeltaItem[] = [];
    const warnings: string[] = [];

    // 1. NAT Gateway check
    if (templateYaml.includes('AWS::EC2::NatGateway')) {
      items.push({
        resource: 'AWS::EC2::NatGateway',
        category: 'network',
        monthlyDeltaUsd: RATES.NAT_GATEWAY_PER_MONTH,
        explanation: 'NAT Gateway provisioned for outbound VPC traffic (~$32.85/month base + bandwidth).',
      });
      warnings.push('NAT Gateways incur a flat monthly fee even when idle. Consider VPC Endpoints for S3/DynamoDB if possible.');
    }

    // 2. Application Load Balancer
    if (templateYaml.includes('AWS::ElasticLoadBalancingV2::LoadBalancer')) {
      items.push({
        resource: 'Application Load Balancer',
        category: 'network',
        monthlyDeltaUsd: RATES.ALB_BASE_PER_MONTH,
        explanation: 'ALB base hourly fee (~$16.20/month + LCU usage).',
      });
    }

    // 3. ECS Fargate Service
    const fargateCpuMatch = templateYaml.match(/Cpu:\s*['"]?(\d+)['"]?/);
    const fargateMemoryMatch = templateYaml.match(/Memory:\s*['"]?(\d+)['"]?/);
    if (templateYaml.includes('AWS::ECS::TaskDefinition') || templateYaml.includes('FARGATE')) {
      const cpu = fargateCpuMatch && fargateCpuMatch[1] ? parseInt(fargateCpuMatch[1], 10) / 1024 : 0.5;
      const memory = fargateMemoryMatch && fargateMemoryMatch[1] ? parseInt(fargateMemoryMatch[1], 10) / 1024 : 1;

      const fargateMonthly = (cpu * RATES.FARGATE_VCPU_PER_HOUR + memory * RATES.FARGATE_GB_PER_HOUR) * RATES.HOURS_PER_MONTH;
      items.push({
        resource: `ECS Fargate Task (${cpu} vCPU, ${memory}GB RAM)`,
        category: 'compute',
        monthlyDeltaUsd: parseFloat(fargateMonthly.toFixed(2)),
        explanation: `Fargate task running 24/7 (~$${fargateMonthly.toFixed(2)}/month). Use Scale-to-Zero when idle.`,
      });
    }

    // 4. RDS Database
    if (templateYaml.includes('AWS::RDS::DBInstance')) {
      items.push({
        resource: 'Amazon RDS DB Instance',
        category: 'database',
        monthlyDeltaUsd: RATES.RDS_T4G_MICRO_PER_MONTH,
        explanation: 'Relational database instance (~$12.41/month for db.t4g.micro baseline).',
      });
    }

    // 5. S3 Buckets
    const s3Count = (templateYaml.match(/AWS::S3::Bucket/g) || []).length;
    if (s3Count > 0) {
      items.push({
        resource: `${s3Count}x S3 Bucket(s)`,
        category: 'storage',
        monthlyDeltaUsd: 1.0, // baseline estimate for initial storage & API calls
        explanation: 'S3 storage scales with data ($0.023/GB/month). Estimated initial base: ~$1.00/month.',
      });
    }

    const monthlyTotalDeltaUsd = items.reduce((sum, item) => sum + item.monthlyDeltaUsd, 0);

    const summary = items.length === 0
      ? 'No billable cloud infrastructure components detected in this template.'
      : `Estimated AWS infrastructure cost: ~$${monthlyTotalDeltaUsd.toFixed(2)}/month across ${items.length} resource(s).`;

    return {
      monthlyTotalDeltaUsd: parseFloat(monthlyTotalDeltaUsd.toFixed(2)),
      items,
      warnings,
      summary,
    };
  }

  public analyzeDiff(changedFiles: Array<{ file: string; patch?: string }>): FinOpsAnalysisResult {
    const items: CostDeltaItem[] = [];
    const warnings: string[] = [];

    for (const change of changedFiles) {
      if (change.file.endsWith('template.yaml') || change.file.endsWith('template.yml')) {
        return this.analyzeCloudFormation(change.patch || '');
      }

      if (change.file.toLowerCase().includes('dockerfile')) {
        items.push({
          resource: 'Container Image Build',
          category: 'compute',
          monthlyDeltaUsd: 0.0,
          explanation: 'Dockerfile modification. Image storage in ECR incurs minimal storage cost (~$0.10/GB/month).',
        });
      }
    }

    return {
      monthlyTotalDeltaUsd: 0,
      items,
      warnings,
      summary: 'No substantial cloud billing impact detected for these code changes.',
    };
  }

  // --- FinOps Spend Ceilings & Budget Controls ---
  private recordedRunSpends = new Map<string, number>();
  private monthlyTenantSpends = new Map<string, number>();

  public checkRunBudget(
    currentCostUsd: number,
    customCeilingUsd?: number
  ): {
    allowed: boolean;
    ratio: number;
    action: 'continue' | 'warn' | 'halt';
    ceilingUsd: number;
    warning?: string;
  } {
    const ceilingUsd = customCeilingUsd ?? parseFloat(process.env.LYRA_RUN_BUDGET_CEILING_USD || '2.00');
    const ratio = ceilingUsd > 0 ? currentCostUsd / ceilingUsd : 0;

    if (currentCostUsd >= ceilingUsd) {
      return {
        allowed: false,
        ratio,
        action: 'halt',
        ceilingUsd,
        warning: `Run cost ($${currentCostUsd.toFixed(2)}) has reached or exceeded the maximum budget ceiling ($${ceilingUsd.toFixed(2)}). Halting further model dispatches.`,
      };
    }

    if (ratio >= 0.85) {
      return {
        allowed: true,
        ratio,
        action: 'warn',
        ceilingUsd,
        warning: `Run cost ($${currentCostUsd.toFixed(2)}) has consumed ${(ratio * 100).toFixed(0)}% of the budget ceiling ($${ceilingUsd.toFixed(2)}).`,
      };
    }

    return {
      allowed: true,
      ratio,
      action: 'continue',
      ceilingUsd,
    };
  }

  public recordRunSpend(runId: string, costUsd: number, tenantId = 'default'): void {
    this.recordedRunSpends.set(runId, costUsd);
    const existingMonthly = this.monthlyTenantSpends.get(tenantId) || 0;
    this.monthlyTenantSpends.set(tenantId, parseFloat((existingMonthly + costUsd).toFixed(4)));
  }

  public getMonthlySpend(tenantId = 'default', customCeilingUsd?: number): {
    totalSpendUsd: number;
    ceilingUsd: number;
    remainingUsd: number;
    ratio: number;
  } {
    const ceilingUsd = customCeilingUsd ?? parseFloat(process.env.LYRA_MONTHLY_BUDGET_CEILING_USD || '25.00');
    const totalSpendUsd = this.monthlyTenantSpends.get(tenantId) || 0;
    const remainingUsd = Math.max(0, parseFloat((ceilingUsd - totalSpendUsd).toFixed(2)));
    const ratio = ceilingUsd > 0 ? parseFloat((totalSpendUsd / ceilingUsd).toFixed(4)) : 0;

    return {
      totalSpendUsd,
      ceilingUsd,
      remainingUsd,
      ratio,
    };
  }

  public resetMonthlySpend(tenantId = 'default'): void {
    this.monthlyTenantSpends.delete(tenantId);
  }
}

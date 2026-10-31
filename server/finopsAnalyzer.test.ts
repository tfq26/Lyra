import { describe, expect, it } from 'bun:test';
import { FinOpsAnalyzer } from './finopsAnalyzer';

describe('FinOpsAnalyzer', () => {
  it('correctly calculates AWS cost estimates from a CloudFormation template', () => {
    const analyzer = new FinOpsAnalyzer();

    const sampleCfn = `
Resources:
  MyVpc:
    Type: AWS::EC2::VPC
  MyNatGateway:
    Type: AWS::EC2::NatGateway
  MyAlb:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
  MyDatabase:
    Type: AWS::RDS::DBInstance
  MyBucket:
    Type: AWS::S3::Bucket
  MyTaskDef:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Cpu: "512"
      Memory: "1024"
    `;

    const result = analyzer.analyzeCloudFormation(sampleCfn);
    expect(result.items.length).toBe(5);
    expect(result.monthlyTotalDeltaUsd).toBeGreaterThan(50);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('NAT Gateways incur a flat monthly fee');
  });

  it('evaluates diffs with zero cost impact when no infra files are changed', () => {
    const analyzer = new FinOpsAnalyzer();
    const result = analyzer.analyzeDiff([
      { file: 'src/App.tsx', patch: '+ const x = 1;' },
      { file: 'server/api.ts', patch: '+ export const a = 2;' },
    ]);

    expect(result.monthlyTotalDeltaUsd).toBe(0);
    expect(result.items.length).toBe(0);
    expect(result.summary).toContain('No substantial cloud billing impact');
  });

  it('enforces spend ceilings and warns on near-threshold budgets', () => {
    const analyzer = new FinOpsAnalyzer();

    // Under budget
    const low = analyzer.checkRunBudget(0.50, 2.00);
    expect(low.allowed).toBe(true);
    expect(low.action).toBe('continue');

    // Approaching ceiling (>= 85%)
    const warn = analyzer.checkRunBudget(1.80, 2.00);
    expect(warn.allowed).toBe(true);
    expect(warn.action).toBe('warn');
    expect(warn.warning).toContain('90% of the budget ceiling');

    // Reaching ceiling
    const halt = analyzer.checkRunBudget(2.05, 2.00);
    expect(halt.allowed).toBe(false);
    expect(halt.action).toBe('halt');
    expect(halt.warning).toContain('reached or exceeded');

    // Monthly tracking
    analyzer.resetMonthlySpend();
    analyzer.recordRunSpend('run-1', 1.50);
    analyzer.recordRunSpend('run-2', 2.00);
    const monthly = analyzer.getMonthlySpend('default', 10.00);
    expect(monthly.totalSpendUsd).toBe(3.50);
    expect(monthly.remainingUsd).toBe(6.50);
  });
});

import { WorktreeManager } from './worktreeManager';
import { VerificationRunner } from './verificationRunner';
import type { CheckItem, FileDiff } from './types';

export interface TournamentContender {
  id: string; // e.g. 'minimal' | 'idiomatic'
  name: string;
  strategyDescription: string;
  branchName?: string;
  worktreePath?: string;
  checks?: CheckItem[];
  diffs?: FileDiff[];
  allPassed?: boolean;
  score?: number;
  metrics?: {
    linesAdded: number;
    linesDeleted: number;
    executionTimeMs: number;
  };
}

export interface TournamentResult {
  runId: string;
  objective: string;
  winningContenderId: string;
  winner: TournamentContender;
  contenders: TournamentContender[];
  scorecardRationale: string;
}

export class TournamentManager {
  private worktreeManager: WorktreeManager;
  private verificationRunner: VerificationRunner;

  constructor(options?: {
    worktreeManager?: WorktreeManager;
    verificationRunner?: VerificationRunner;
  }) {
    this.worktreeManager = options?.worktreeManager || new WorktreeManager();
    this.verificationRunner = options?.verificationRunner || new VerificationRunner();
  }

  /**
   * Evaluates multiple competing contender worktrees and selects the optimal implementation.
   */
  public evaluateTournament(params: {
    runId: string;
    objective: string;
    contenders: TournamentContender[];
  }): TournamentResult {
    const { runId, objective, contenders } = params;

    if (!contenders || contenders.length === 0) {
      throw new Error('Tournament requires at least one contender to evaluate.');
    }

    // Score contenders based on test passing, diff blast radius, and execution speed
    let highestScore = -Infinity;
    let winningContender = contenders[0]!;

    for (const c of contenders) {
      let score = 0;

      // 1. Passing tests is a hard requirement (+100 points)
      if (c.allPassed) {
        score += 100;
      } else {
        score -= 50;
      }

      // 2. Blast radius efficiency (prefer focused diffs)
      const totalChanges = (c.metrics?.linesAdded || 0) + (c.metrics?.linesDeleted || 0);
      if (totalChanges > 0) {
        // Reward compact diffs, penalize runaway changes (> 500 lines)
        if (totalChanges <= 100) score += 30;
        else if (totalChanges <= 300) score += 15;
        else if (totalChanges > 500) score -= 20;
      }

      // 3. Execution speed
      if (c.metrics?.executionTimeMs) {
        if (c.metrics.executionTimeMs < 5000) score += 10;
        else if (c.metrics.executionTimeMs > 30000) score -= 10;
      }

      c.score = score;

      if (score > highestScore) {
        highestScore = score;
        winningContender = c;
      }
    }

    const rationale = `Selected contender "${winningContender.name}" (${winningContender.id}) with score ${highestScore}. Strategy: ${winningContender.strategyDescription}. Tests passed: ${winningContender.allPassed ? 'Yes' : 'No'}.`;

    return {
      runId,
      objective,
      winningContenderId: winningContender.id,
      winner: winningContender,
      contenders,
      scorecardRationale: rationale,
    };
  }
}

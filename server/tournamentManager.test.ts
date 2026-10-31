import { describe, it, expect } from 'bun:test';
import { TournamentManager, type TournamentContender } from './tournamentManager';

describe('TournamentManager', () => {
  const manager = new TournamentManager();

  it('selects the contender with passing tests and superior blast radius efficiency', () => {
    const contenders: TournamentContender[] = [
      {
        id: 'minimal',
        name: 'Minimal Backward-Compatible Adapter',
        strategyDescription: 'Wraps existing legacy methods with a modern adapter interface.',
        allPassed: true,
        metrics: {
          linesAdded: 45,
          linesDeleted: 5,
          executionTimeMs: 2500,
        },
      },
      {
        id: 'full-rewrite',
        name: 'Complete Architectural Rewrite',
        strategyDescription: 'Rewrites the entire module from scratch.',
        allPassed: true,
        metrics: {
          linesAdded: 850,
          linesDeleted: 620,
          executionTimeMs: 12000,
        },
      },
      {
        id: 'broken',
        name: 'Failing Fast Prototype',
        strategyDescription: 'Experimental implementation that fails checks.',
        allPassed: false,
        metrics: {
          linesAdded: 20,
          linesDeleted: 0,
          executionTimeMs: 1000,
        },
      },
    ];

    const result = manager.evaluateTournament({
      runId: 'tourn-123',
      objective: 'Refactor Auth Token Storage',
      contenders,
    });

    expect(result.winningContenderId).toBe('minimal');
    expect(result.winner.score).toBeGreaterThan(result.contenders[1]!.score!);
    expect(result.scorecardRationale).toContain('Minimal Backward-Compatible Adapter');
  });
});

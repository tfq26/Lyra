import { describe, expect, it, mock } from 'bun:test';
import { IdleManager } from './idleManager';

describe('IdleManager', () => {
  it('initializes with default settings and active state', () => {
    const manager = new IdleManager();
    expect(manager.isHibernated()).toBe(false);
    expect(manager.getHibernatedAt()).toBeNull();
    expect(typeof manager.getLastActivity()).toBe('number');
  });

  it('triggers hibernate when inactivity exceeds timeout', async () => {
    let hibernated = false;
    let recordedDuration = 0;

    const manager = new IdleManager({
      idleTimeoutMs: 100, // 100ms for test
      onHibernate: (duration) => {
        hibernated = true;
        recordedDuration = duration;
      },
    });

    // Wait 120ms
    await new Promise((r) => setTimeout(r, 120));

    const checked = await manager.checkIdle();
    expect(checked).toBe(true);
    expect(manager.isHibernated()).toBe(true);
    expect(hibernated).toBe(true);
    expect(recordedDuration).toBeGreaterThanOrEqual(100);
  });

  it('wakes up when activity is recorded while hibernated', async () => {
    let wokeUp = false;
    let sleepDuration = 0;

    const manager = new IdleManager({
      idleTimeoutMs: 50,
      onWake: (duration) => {
        wokeUp = true;
        sleepDuration = duration;
      },
    });

    await manager.hibernateNow();
    expect(manager.isHibernated()).toBe(true);

    await new Promise((r) => setTimeout(r, 20));

    manager.recordActivity();
    expect(manager.isHibernated()).toBe(false);
    expect(wokeUp).toBe(true);
    expect(sleepDuration).toBeGreaterThanOrEqual(15);
  });

  it('does not hibernate repeatedly if already hibernated', async () => {
    let callCount = 0;
    const manager = new IdleManager({
      idleTimeoutMs: 50,
      onHibernate: () => {
        callCount++;
      },
    });

    await manager.hibernateNow();
    expect(callCount).toBe(1);

    await manager.hibernateNow();
    expect(callCount).toBe(1);

    const checked = await manager.checkIdle();
    expect(checked).toBe(false);
    expect(callCount).toBe(1);
  });
});

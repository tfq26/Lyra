import { EventEmitter } from 'events';

export interface IdleManagerOptions {
  idleTimeoutMs?: number; // default: 5 minutes (300,000 ms)
  checkIntervalMs?: number; // default: 15,000 ms
  onHibernate?: (idleDurationMs: number) => Promise<void> | void;
  onWake?: (wasHibernatedDurationMs: number) => Promise<void> | void;
}

export class IdleManager extends EventEmitter {
  private lastActivityTimestamp: number;
  private hibernated: boolean = false;
  private hibernatedAt: number | null = null;
  private readonly idleTimeoutMs: number;
  private readonly checkIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private readonly onHibernateCallback?: (idleDurationMs: number) => Promise<void> | void;
  private readonly onWakeCallback?: (wasHibernatedDurationMs: number) => Promise<void> | void;

  constructor(options: IdleManagerOptions = {}) {
    super();
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000; // 5 min default
    this.checkIntervalMs = options.checkIntervalMs ?? 15 * 1000;
    this.onHibernateCallback = options.onHibernate;
    this.onWakeCallback = options.onWake;
    this.lastActivityTimestamp = Date.now();
  }

  public recordActivity(): void {
    const wasHibernated = this.hibernated;
    const now = Date.now();
    this.lastActivityTimestamp = now;

    if (wasHibernated) {
      this.wakeNow();
    }
  }

  public isHibernated(): boolean {
    return this.hibernated;
  }

  public getLastActivity(): number {
    return this.lastActivityTimestamp;
  }

  public getHibernatedAt(): number | null {
    return this.hibernatedAt;
  }

  public startMonitoring(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkIdle();
    }, this.checkIntervalMs);
    this.timer.unref();
  }

  public stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async checkIdle(): Promise<boolean> {
    if (this.hibernated) return false;

    const idleTime = Date.now() - this.lastActivityTimestamp;
    if (idleTime >= this.idleTimeoutMs) {
      await this.hibernateNow();
      return true;
    }
    return false;
  }

  public async hibernateNow(): Promise<void> {
    if (this.hibernated) return;
    this.hibernated = true;
    this.hibernatedAt = Date.now();
    const idleDuration = this.hibernatedAt - this.lastActivityTimestamp;

    this.emit('hibernate', {
      idleDurationMs: idleDuration,
      idleMinutes: Math.round(idleDuration / 60000),
    });

    if (this.onHibernateCallback) {
      try {
        await this.onHibernateCallback(idleDuration);
      } catch (err) {
        console.error('[IdleManager] Error during onHibernate callback:', err);
      }
    }
  }

  public async wakeNow(): Promise<void> {
    if (!this.hibernated) return;
    const now = Date.now();
    const sleepDuration = this.hibernatedAt ? now - this.hibernatedAt : 0;
    this.hibernated = false;
    this.hibernatedAt = null;
    this.lastActivityTimestamp = now;

    this.emit('wake', {
      sleptDurationMs: sleepDuration,
      sleptMinutes: Math.round(sleepDuration / 60000),
    });

    if (this.onWakeCallback) {
      try {
        await this.onWakeCallback(sleepDuration);
      } catch (err) {
        console.error('[IdleManager] Error during onWake callback:', err);
      }
    }
  }
}

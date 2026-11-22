import crypto from 'crypto';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import { executeDeliveryAttempt } from '../services/dispatcher.js';

export class RetryWorker {
  private readonly db: HookRelayDB;
  private readonly config: AppConfig;
  private readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private activeJobs = 0;
  private pendingWake = false;

  constructor(db: HookRelayDB, config: AppConfig) {
    this.db = db;
    this.config = config;
    this.workerId = `wrk_${crypto.randomBytes(4).toString('hex')}`;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    // Recover any jobs left in 'processing' from a previous server crash/restart
    this.recoverStaleLocks(0);

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.workerPollIntervalMs);
    this.timer.unref();

    // Immediately process anything already due in SQLite
    void this.tick();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public wakeUp(): void {
    if (!this.running) return;
    if (this.activeJobs >= this.config.workerConcurrency) {
      this.pendingWake = true;
      return;
    }
    setImmediate(() => {
      void this.tick();
    });
  }

  public getStatus(): { running: boolean; active_jobs: number; poll_interval_ms: number } {
    return {
      running: this.running,
      active_jobs: this.activeJobs,
      poll_interval_ms: this.config.workerPollIntervalMs,
    };
  }

  public recoverStaleLocks(staleAfterMs = 120000): number {
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE deliveries
         SET status = CASE WHEN attempt_count = 0 THEN 'pending' ELSE 'retrying' END,
             locked_at = NULL,
             locked_by = NULL,
             next_attempt_at = COALESCE(next_attempt_at, ?),
             updated_at = ?
         WHERE status = 'processing' AND (locked_at IS NULL OR locked_at <= ?)`
      )
      .run(now, now, cutoff);
    return res.changes;
  }

  public claimDueDeliveries(batchSize: number): string[] {
    if (batchSize <= 0) return [];
    const now = new Date().toISOString();

    const claimTx = this.db.transaction((limit: number): string[] => {
      const due = this.db
        .prepare(
          `SELECT id FROM deliveries
           WHERE status IN ('pending', 'retrying')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             AND locked_at IS NULL
           ORDER BY COALESCE(next_attempt_at, created_at) ASC
           LIMIT ?`
        )
        .all(now, limit) as Array<{ id: string }>;

      if (due.length === 0) return [];

      const updateStmt = this.db.prepare(
        `UPDATE deliveries
         SET status = 'processing', locked_at = ?, locked_by = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'retrying') AND locked_at IS NULL`
      );

      const claimed: string[] = [];
      for (const row of due) {
        const res = updateStmt.run(now, this.workerId, now, row.id);
        if (res.changes === 1) {
          claimed.push(row.id);
        }
      }
      return claimed;
    });

    return claimTx(batchSize);
  }

  public async processDueNow(): Promise<number> {
    this.recoverStaleLocks();
    const availableSlots = Math.max(0, this.config.workerConcurrency - this.activeJobs);
    if (availableSlots === 0) return 0;

    const claimedIds = this.claimDueDeliveries(availableSlots);
    if (claimedIds.length === 0) return 0;

    await Promise.all(
      claimedIds.map(async (deliveryId) => {
        this.activeJobs += 1;
        try {
          await executeDeliveryAttempt(this.db, this.config, deliveryId);
        } catch (err) {
          console.error(`[HookRelay Worker] Unexpected error executing ${deliveryId}:`, err);
          // Release lock so it doesn't stay stuck
          this.db
            .prepare(
              `UPDATE deliveries
               SET status = 'retrying', locked_at = NULL, locked_by = NULL, updated_at = ?
               WHERE id = ? AND status = 'processing'`
            )
            .run(new Date().toISOString(), deliveryId);
        } finally {
          this.activeJobs -= 1;
        }
      })
    );

    return claimedIds.length;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const processed = await this.processDueNow();
      if (processed > 0 || this.pendingWake) {
        this.pendingWake = false;
        // Check if more due deliveries remain queued
        const remaining = this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM deliveries
             WHERE status IN ('pending', 'retrying')
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
               AND locked_at IS NULL`
          )
          .get(new Date().toISOString()) as { count: number };
        if (remaining.count > 0 && this.running) {
          setImmediate(() => {
            void this.tick();
          });
        }
      }
    } catch (err) {
      // Database may be closed during test teardown
      if (this.running) {
        console.error('[HookRelay Worker] Tick error:', err);
      }
    }
  }
}

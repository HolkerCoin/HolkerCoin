import { POLL } from './config.js';

/**
 * Self-scheduling poller with exponential backoff and jitter.
 * Success resets to the base interval; each failure doubles the wait up to backoffMaxMs.
 * Pauses while the tab is hidden and fires immediately when it returns.
 */
export class Poller {
  constructor({ run, intervalMs, onData, onFail }) {
    Object.assign(this, { run, intervalMs, onData, onFail });
    this.fails = 0; this.timer = null; this.stopped = true; this.busy = false;
    document.addEventListener('visibilitychange', () => {
      if (this.stopped) return;
      clearTimeout(this.timer);
      if (!document.hidden && !this.busy) this.tick();
    });
  }
  start() { this.stopped = false; this.tick(); }
  async tick() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), POLL.timeoutMs);
    let wait;
    try {
      const data = await this.run(ctl.signal);
      this.fails = 0; wait = this.intervalMs;
      this.onData(data);
    } catch (err) {
      this.fails += 1;
      const base = Math.min(POLL.backoffMaxMs, this.intervalMs * 2 ** this.fails);
      wait = Math.round(base * (0.85 + Math.random() * 0.3));
      this.onFail(err, wait, this.fails);
    } finally { clearTimeout(to); this.busy = false; }
    if (!this.stopped && !document.hidden) this.timer = setTimeout(() => this.tick(), wait);
  }
}

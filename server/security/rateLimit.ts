/** In-memory fixed-window limiter. Bounded memory. For multi-instance deploys, front with a shared limiter (CDN/WAF/Redis). */
export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(limit: number, windowMs = 60_000, maxKeys = 20_000, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
  }

  check(key: string): LimitResult {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= t) {
      if (this.hits.size >= this.maxKeys) this.sweep(t);
      e = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, e);
    }
    e.count += 1;
    const allowed = e.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - e.count),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((e.resetAt - t) / 1000)),
    };
  }

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    // Still full (attack): drop oldest entries so memory stays bounded.
    let over = this.hits.size - this.maxKeys + 1;
    for (const k of this.hits.keys()) {
      if (over-- <= 0) break;
      this.hits.delete(k);
    }
  }
}

/** Global per-UTC-day cap on paid upstream calls (e.g. Gemini). */
export class DailyBudget {
  private readonly max: number;
  private readonly now: () => number;
  private day = '';
  private used = 0;

  constructor(max: number, now: () => number = Date.now) {
    this.max = max;
    this.now = now;
  }

  tryConsume(): boolean {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.used = 0;
    }
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
}

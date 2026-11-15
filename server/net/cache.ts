/** Small LRU+TTL cache with in-flight de-duplication and short negative caching of failures. */
export class TtlCache<V> {
  private readonly max: number;
  private readonly now: () => number;
  private readonly store = new Map<string, { value: V; expires: number }>();
  private readonly inflight = new Map<string, Promise<V>>();
  private readonly failures = new Map<string, { until: number; error: unknown }>();

  constructor(max = 500, now: () => number = Date.now) {
    this.max = max;
    this.now = now;
  }

  get(key: string): V | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key); // refresh LRU order
    this.store.set(key, e);
    return e.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: this.now() + ttlMs });
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  async getOrLoad(key: string, ttlMs: number, loader: () => Promise<V>, errorTtlMs = 30_000): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const f = this.failures.get(key);
    if (f && f.until > this.now()) throw f.error;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = loader()
      .then((v) => {
        this.set(key, v, ttlMs);
        this.failures.delete(key);
        return v;
      })
      .catch((err) => {
        this.failures.set(key, { until: this.now() + errorTtlMs, error: err });
        if (this.failures.size > this.max) this.failures.delete(this.failures.keys().next().value as string);
        throw err;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

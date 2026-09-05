export interface PoolOptions<T> {
  size: number;
  /** The key carries model, effort and prompt version: all baked in at spawn. */
  spawnFn: (key: string) => T;
}

/**
 * Keeps CLI processes booted ahead of demand so the ~570ms boot does not land in
 * the critical path of every batch.
 *
 * Two invariants: every process is single-use, which is what keeps token cost
 * linear in batch count instead of quadratic; and the pool is keyed by
 * configuration, because model, effort and system prompt are fixed at spawn time
 * and a process warmed for one settings combination cannot serve another.
 */
export class ProcessPool<T extends { kill(): void }> {
  #warm: T[] = [];
  #key: string | null = null;
  #opts: PoolOptions<T>;

  constructor(opts: PoolOptions<T>) { this.#opts = opts; }

  size(): number { return this.#warm.length; }
  currentKey(): string | null { return this.#key; }

  acquire(key: string): T {
    if (key !== this.#key) {
      this.drain();
      this.#key = key;
    }
    const p = this.#warm.shift() ?? this.#opts.spawnFn(key);
    while (this.#warm.length < this.#opts.size) this.#warm.push(this.#opts.spawnFn(key));
    return p;
  }

  drain(): void {
    for (const p of this.#warm) { try { p.kill(); } catch { /* already gone */ } }
    this.#warm = [];
    this.#key = null;
  }
}

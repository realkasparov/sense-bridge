export interface Poolable {
  spawnedAt: number;
  isAlive(): boolean;
  kill(): void;
}

export interface PoolOptions<T> {
  size: number;
  /** The key carries model, effort and prompt version: all baked in at spawn. */
  spawnFn: (key: string) => T;
  /** Warm processes older than this are discarded rather than handed out. */
  maxAgeMs?: number;
  now?: () => number;
}

/**
 * Keeps CLI processes booted ahead of demand so the ~570ms boot does not land in
 * the critical path of every batch.
 *
 * Three invariants: every process is single-use, which is what keeps token cost
 * linear in batch count instead of quadratic; the pool is keyed by configuration,
 * because model, effort and system prompt are fixed at spawn time; and a process
 * is only handed out while it is alive and fresh, since a warm CLI can exit on
 * its own and an idle one must not linger for the life of the Chrome connection.
 */
export class ProcessPool<T extends Poolable> {
  #warm: T[] = [];
  #key: string | null = null;
  #opts: Required<Pick<PoolOptions<T>, "size" | "spawnFn">> & { maxAgeMs: number; now: () => number };

  constructor(opts: PoolOptions<T>) {
    this.#opts = {
      size: opts.size,
      spawnFn: opts.spawnFn,
      maxAgeMs: opts.maxAgeMs ?? 120_000,
      now: opts.now ?? (() => Date.now()),
    };
  }

  size(): number { return this.#warm.length; }
  currentKey(): string | null { return this.#key; }

  acquire(key: string): T {
    if (key !== this.#key) {
      this.drain();
      this.#key = key;
    }
    this.#dropStale();

    const process = this.#warm.shift() ?? this.#opts.spawnFn(key);
    while (this.#warm.length < this.#opts.size) this.#warm.push(this.#opts.spawnFn(key));
    return process;
  }

  /** Kills warm processes that have died or gone stale. Safe to call on a timer. */
  reap(): void {
    this.#dropStale();
  }

  drain(): void {
    for (const warm of this.#warm) { try { warm.kill(); } catch { /* already gone */ } }
    this.#warm = [];
    this.#key = null;
  }

  #dropStale(): void {
    const cutoff = this.#opts.now() - this.#opts.maxAgeMs;
    const keep: T[] = [];
    for (const warm of this.#warm) {
      if (warm.isAlive() && warm.spawnedAt > cutoff) keep.push(warm);
      else { try { warm.kill(); } catch { /* already gone */ } }
    }
    this.#warm = keep;
  }
}

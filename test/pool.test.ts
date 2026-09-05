import { describe, it, expect } from "vitest";
import { ProcessPool } from "../src/pool.js";

interface FakeProc { id: number; key: string; kill(): void }

function counter() {
  let n = 0;
  const killed: number[] = [];
  const spawnFn = (key: string): FakeProc => {
    const id = ++n;
    return { id, key, kill: () => { killed.push(id); } };
  };
  return { spawnFn, killed, spawned: () => n };
}

const K = "sonnet|low|v1";

describe("ProcessPool", () => {
  it("does not spawn anything before the first acquire", () => {
    const c = counter();
    const pool = new ProcessPool({ size: 3, spawnFn: c.spawnFn });
    expect(c.spawned()).toBe(0);
    expect(pool.size()).toBe(0);
    pool.drain();
  });

  it("warms the pool to its configured size after the first acquire", () => {
    const c = counter();
    const pool = new ProcessPool({ size: 3, spawnFn: c.spawnFn });
    pool.acquire(K);
    expect(pool.size()).toBe(3);
    pool.drain();
  });

  it("never hands the same process out twice", () => {
    const c = counter();
    const pool = new ProcessPool({ size: 2, spawnFn: c.spawnFn });
    const ids = new Set<number>();
    for (let i = 0; i < 8; i++) ids.add(pool.acquire(K).id);
    expect(ids.size).toBe(8);
    pool.drain();
  });

  it("serves later acquires from already-warm processes", () => {
    const c = counter();
    const pool = new ProcessPool({ size: 2, spawnFn: c.spawnFn });
    pool.acquire(K);
    const spawnedAfterWarmup = c.spawned();
    const p = pool.acquire(K);
    expect(p.id).toBeLessThanOrEqual(spawnedAfterWarmup);
    pool.drain();
  });

  it("drains and respawns when the configuration key changes", () => {
    const c = counter();
    const pool = new ProcessPool({ size: 2, spawnFn: c.spawnFn });
    pool.acquire(K);
    const stale = c.killed.length;
    const p = pool.acquire("opus|high|v1");
    expect(p.key).toBe("opus|high|v1");
    expect(c.killed.length).toBeGreaterThan(stale);
    expect(pool.currentKey()).toBe("opus|high|v1");
    pool.drain();
  });

  it("kills every idle process on drain", () => {
    const c = counter();
    const pool = new ProcessPool({ size: 3, spawnFn: c.spawnFn });
    pool.acquire(K);
    pool.drain();
    expect(pool.size()).toBe(0);
    expect(c.killed.length).toBeGreaterThanOrEqual(3);
  });
});

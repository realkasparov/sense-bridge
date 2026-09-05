import { describe, it, expect } from "vitest";
import { ProcessPool } from "../src/pool.js";

interface FakeProc {
  id: number; key: string; spawnedAt: number; alive: boolean;
  isAlive(): boolean; kill(): void;
}

function counter(now = () => Date.now()) {
  let n = 0;
  const all: FakeProc[] = [];
  const killed: number[] = [];
  const spawnFn = (key: string): FakeProc => {
    const id = ++n;
    const p: FakeProc = {
      id, key, spawnedAt: now(), alive: true,
      isAlive: () => p.alive,
      kill: () => { p.alive = false; killed.push(id); },
    };
    all.push(p);
    return p;
  };
  return { spawnFn, killed, all, spawned: () => n };
}

const K = "sonnet|low|v1";

describe("ProcessPool", () => {
  it("does not spawn anything before the first acquire", () => {
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 3, spawnFn: c.spawnFn });
    expect(c.spawned()).toBe(0);
    expect(pool.size()).toBe(0);
    pool.drain();
  });

  it("warms up to its configured size after the first acquire", () => {
    // The size is a budget for processes altogether: one in use plus two warm.
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 3, spawnFn: c.spawnFn });
    pool.acquire(K);
    expect(pool.size() + pool.inUse()).toBe(3);
    expect(pool.size()).toBeGreaterThan(0);
    pool.drain();
  });

  it("never hands the same process out twice", () => {
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 2, spawnFn: c.spawnFn });
    const ids = new Set<number>();
    for (let i = 0; i < 8; i++) ids.add(pool.acquire(K).id);
    expect(ids.size).toBe(8);
    pool.drain();
  });

  it("serves later acquires from already-warm processes", () => {
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 2, spawnFn: c.spawnFn });
    pool.acquire(K);
    const spawnedAfterWarmup = c.spawned();
    const p = pool.acquire(K);
    expect(p.id).toBeLessThanOrEqual(spawnedAfterWarmup);
    pool.drain();
  });

  it("drains and respawns when the configuration key changes", () => {
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 2, spawnFn: c.spawnFn });
    pool.acquire(K);
    const stale = c.killed.length;
    const p = pool.acquire("opus|high|v1");
    expect(p.key).toBe("opus|high|v1");
    expect(c.killed.length).toBeGreaterThan(stale);
    expect(pool.currentKey()).toBe("opus|high|v1");
    pool.drain();
  });

  it("never hands out a process that has died while idle", () => {
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 2, spawnFn: c.spawnFn });
    pool.acquire(K);
    // A warm CLI can exit on its own: a crash, an expired session, its own timeout.
    for (const p of c.all) p.alive = false;
    const got = pool.acquire(K);
    expect(got.isAlive()).toBe(true);
    pool.drain();
  });

  it("discards warm processes older than maxAgeMs", () => {
    let clock = 1_000;
    const c = counter(() => clock);
    const pool = new ProcessPool<FakeProc>({
      size: 2, spawnFn: c.spawnFn, maxAgeMs: 5_000, now: () => clock,
    });
    const first = pool.acquire(K);
    clock += 10_000;
    const later = pool.acquire(K);
    expect(later.spawnedAt).toBeGreaterThan(first.spawnedAt);
    pool.drain();
  });

  it("reap() clears stale warm processes without an acquire", () => {
    let clock = 1_000;
    const c = counter(() => clock);
    const pool = new ProcessPool<FakeProc>({
      size: 2, spawnFn: c.spawnFn, maxAgeMs: 5_000, now: () => clock,
    });
    pool.acquire(K);
    expect(pool.size()).toBeGreaterThan(0);
    clock += 10_000;
    pool.reap();
    // Idle CLI processes must not linger for the life of the Chrome connection.
    expect(pool.size()).toBe(0);
  });

  it("counts processes in use against its size, not only warm ones", () => {
    // Refilling to the full size regardless meant three lanes running alongside
    // three spares: six processes at once for a pool nominally holding three.
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 3, spawnFn: c.spawnFn });
    const held = [pool.acquire(K), pool.acquire(K), pool.acquire(K)];
    expect(held).toHaveLength(3);
    expect(pool.size() + pool.inUse()).toBeLessThanOrEqual(3);
    pool.drain();
  });

  it("warms up again once the processes in use have finished", () => {
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 3, spawnFn: c.spawnFn });
    const held = pool.acquire(K);
    held.kill();                       // the request finished
    pool.acquire(K);
    expect(pool.size() + pool.inUse()).toBeLessThanOrEqual(3);
    pool.drain();
  });

  it("kills every idle process on drain", () => {
    const c = counter();
    const pool = new ProcessPool<FakeProc>({ size: 3, spawnFn: c.spawnFn });
    pool.acquire(K);
    const warm = pool.size();
    pool.drain();
    expect(pool.size() + pool.inUse()).toBe(0);
    expect(c.killed.length).toBeGreaterThanOrEqual(warm);
  });
});

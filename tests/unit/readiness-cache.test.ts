import { describe, expect, it, vi } from "vitest";

import { createReadinessCache } from "@/adapters/persistence/readiness-cache";

describe("readiness cache", () => {
  it("deduplicates concurrent loads and reuses the value only within its bounded TTL", async () => {
    let now = 1_000;
    const cache = createReadinessCache<number>({ ttlMs: 100, now: () => now });
    const key = {};
    const loader = vi.fn(async () => 24);

    const [first, second, third] = await Promise.all([
      cache.resolve(key, loader),
      cache.resolve(key, loader),
      cache.resolve(key, loader),
    ]);
    expect([first, second, third]).toEqual([24, 24, 24]);
    expect(loader).toHaveBeenCalledTimes(1);

    now += 99;
    await expect(cache.resolve(key, loader)).resolves.toBe(24);
    expect(loader).toHaveBeenCalledTimes(1);

    now += 1;
    await expect(cache.resolve(key, loader)).resolves.toBe(24);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not let a load started before invalidation overwrite the new generation", async () => {
    const cache = createReadinessCache<string>({ ttlMs: 1_000 });
    const key = {};
    let finishStaleLoad: ((value: string) => void) | undefined;
    const staleLoad = cache.resolve(
      key,
      () =>
        new Promise<string>((resolve) => {
          finishStaleLoad = resolve;
        }),
    );

    cache.invalidate(key);
    await expect(cache.resolve(key, async () => "fresh")).resolves.toBe("fresh");
    finishStaleLoad?.("stale");
    await expect(staleLoad).resolves.toBe("stale");

    const loader = vi.fn(async () => "unexpected");
    await expect(cache.resolve(key, loader)).resolves.toBe("fresh");
    expect(loader).not.toHaveBeenCalled();
  });

  it("clears a rejected in-flight load so the next request can retry", async () => {
    const cache = createReadinessCache<number>({ ttlMs: 1_000 });
    const key = {};
    const loader = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("temporary database failure"))
      .mockResolvedValueOnce(30);

    await expect(cache.resolve(key, loader)).rejects.toThrow("temporary database failure");
    await expect(cache.resolve(key, loader)).resolves.toBe(30);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

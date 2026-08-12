interface ReadinessCacheEntry<Value> {
  expiresAt: number;
  value: Value;
}

interface ReadinessCacheState<Value> {
  generation: number;
  entry?: ReadinessCacheEntry<Value>;
  inFlight?: {
    generation: number;
    promise: Promise<Value>;
  };
}

interface ReadinessCacheOptions {
  ttlMs: number;
  now?: () => number;
}

/**
 * A small cross-request cache keyed by the database connection object.
 *
 * Weak keys prevent retired connections from accumulating, the TTL bounds how
 * long an out-of-band data change can remain unseen, and generations ensure an
 * operation that started before reset/seed cannot repopulate a stale entry.
 */
export function createReadinessCache<Value>({ ttlMs, now = Date.now }: ReadinessCacheOptions) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Readiness cache TTL must be a positive integer.");
  }

  const states = new WeakMap<object, ReadinessCacheState<Value>>();

  function stateFor(key: object): ReadinessCacheState<Value> {
    const existing = states.get(key);
    if (existing) return existing;
    const created: ReadinessCacheState<Value> = { generation: 0 };
    states.set(key, created);
    return created;
  }

  return {
    async resolve(key: object, loader: () => Promise<Value>): Promise<Value> {
      const state = stateFor(key);
      const currentTime = now();
      if (state.entry && state.entry.expiresAt > currentTime) return state.entry.value;
      state.entry = undefined;

      if (state.inFlight?.generation === state.generation) return state.inFlight.promise;

      const generation = state.generation;
      const promise = Promise.resolve()
        .then(loader)
        .then((value) => {
          if (state.generation === generation) {
            state.entry = { expiresAt: now() + ttlMs, value };
          }
          return value;
        })
        .finally(() => {
          if (state.inFlight?.promise === promise) state.inFlight = undefined;
        });
      state.inFlight = { generation, promise };
      return promise;
    },

    invalidate(key: object): void {
      const state = stateFor(key);
      state.generation += 1;
      state.entry = undefined;
    },
  };
}

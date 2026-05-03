/**
 * Immutable map abstraction. Phase 1 implementation: plain Map cloned per
 * edit. Hides implementation so we can swap to a HAMT later if benchmarks
 * demand without touching consumers.
 */
export interface PersistentMap<K, V> {
  readonly size: number;
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): PersistentMap<K, V>;
  delete(key: K): PersistentMap<K, V>;
  entries(): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
}

export function createPersistentMap<K, V>(initial?: Iterable<[K, V]>): PersistentMap<K, V> {
  const inner = new Map<K, V>(initial);
  return wrap(inner);
}

function wrap<K, V>(inner: ReadonlyMap<K, V>): PersistentMap<K, V> {
  return {
    get size() { return inner.size; },
    has: (k) => inner.has(k),
    get: (k) => inner.get(k),
    set(k, v) {
      const next = new Map(inner);
      next.set(k, v);
      return wrap(next);
    },
    delete(k) {
      if (!inner.has(k)) return wrap(inner);
      const next = new Map(inner);
      next.delete(k);
      return wrap(next);
    },
    entries: () => inner.entries(),
    keys: () => inner.keys(),
    values: () => inner.values(),
  };
}

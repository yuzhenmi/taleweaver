/**
 * A persistent (immutable, structurally shared) string-keyed hash map: a 32-way
 * bitmap-compressed HAMT. Every `set` / `delete` returns a new map and shares all
 * untouched nodes with the old one, so a version keeps its records while the next
 * version is derived (D4). O(log32 n) per operation.
 *
 * Salvaged from the eager-model proof (`scratchpad/eager-model/hamt.ts`).
 * ponytail: no transients (a batch of sets copies each path once per set); hash
 * collisions fall into a linear bucket at max depth.
 */
interface Branch<V> {
  readonly leaf: false;
  readonly bitmap: number;
  readonly slots: readonly Slot<V>[];
}
interface Bucket<V> {
  readonly leaf: true;
  readonly entries: readonly (readonly [string, V])[];
}
type Slot<V> = Branch<V> | Bucket<V>;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function popcnt(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const MAX_SHIFT = 30;

export class PMap<V> {
  private constructor(
    private readonly root: Branch<V>,
    readonly size: number,
  ) {}

  static empty<V>(): PMap<V> {
    return new PMap<V>({ leaf: false, bitmap: 0, slots: [] }, 0);
  }

  get(k: string): V | undefined {
    const h = hash(k);
    let n: Slot<V> = this.root;
    for (let shift = 0; ; shift += 5) {
      if (n.leaf) {
        for (const e of n.entries) if (e[0] === k) return e[1];
        return undefined;
      }
      const bit = 1 << ((h >>> shift) & 31);
      if ((n.bitmap & bit) === 0) return undefined;
      const next: Slot<V> | undefined = n.slots[popcnt(n.bitmap & (bit - 1))];
      if (next === undefined) return undefined;
      n = next;
    }
  }

  has(k: string): boolean {
    return this.get(k) !== undefined;
  }

  set(k: string, v: V): PMap<V> {
    const r = insert(this.root, hash(k), 0, k, v);
    if (r.leaf) throw new Error("pmap: root became a bucket");
    return new PMap(r, this.size + (added ? 1 : 0));
  }

  delete(k: string): PMap<V> {
    if (this.get(k) === undefined) return this;
    const r = remove(this.root, hash(k), 0, k);
    if (r === null || r.leaf) return r === null ? PMap.empty<V>() : PMap.empty<V>().setAll(r.entries);
    return new PMap(r, this.size - 1);
  }

  private setAll(entries: readonly (readonly [string, V])[]): PMap<V> {
    let m: PMap<V> = this;
    for (const [k, v] of entries) m = m.set(k, v);
    return m;
  }

  *entries(): Generator<readonly [string, V]> {
    yield* walk(this.root);
  }
}

// `insert` reports whether it added a key through this flag (avoids a result object per level).
let added = false;

function insert<V>(n: Slot<V>, h: number, shift: number, k: string, v: V): Slot<V> {
  if (n.leaf) {
    const i = n.entries.findIndex((e) => e[0] === k);
    if (i >= 0) {
      added = false;
      const entries = n.entries.slice();
      entries[i] = [k, v];
      return { leaf: true, entries };
    }
    if (shift >= MAX_SHIFT) {
      added = true;
      return { leaf: true, entries: [...n.entries, [k, v]] };
    }
    let node: Slot<V> = { leaf: false, bitmap: 0, slots: [] };
    for (const [ek, ev] of n.entries) node = insert(node, hash(ek), shift, ek, ev);
    return insert(node, h, shift, k, v);
  }
  const bit = 1 << ((h >>> shift) & 31);
  const idx = popcnt(n.bitmap & (bit - 1));
  const child = n.slots[idx];
  if ((n.bitmap & bit) === 0 || child === undefined) {
    added = true;
    const slots = n.slots.slice();
    slots.splice(idx, 0, { leaf: true, entries: [[k, v]] });
    return { leaf: false, bitmap: n.bitmap | bit, slots };
  }
  const slots = n.slots.slice();
  slots[idx] = insert(child, h, shift + 5, k, v);
  return { leaf: false, bitmap: n.bitmap, slots };
}

/** Remove `k`; an emptied node becomes null and a non-root branch left holding one bucket collapses into it. */
function remove<V>(n: Slot<V>, h: number, shift: number, k: string): Slot<V> | null {
  if (n.leaf) {
    const entries = n.entries.filter((e) => e[0] !== k);
    return entries.length === 0 ? null : { leaf: true, entries };
  }
  const bit = 1 << ((h >>> shift) & 31);
  const idx = popcnt(n.bitmap & (bit - 1));
  const child = n.slots[idx];
  if (child === undefined) return n;
  const next = remove(child, h, shift + 5, k);
  const slots = n.slots.slice();
  let bitmap = n.bitmap;
  if (next === null) {
    slots.splice(idx, 1);
    bitmap &= ~bit;
  } else {
    slots[idx] = next;
  }
  if (slots.length === 0) return null;
  const only = slots[0];
  if (shift > 0 && slots.length === 1 && only !== undefined && only.leaf) return only;
  return { leaf: false, bitmap, slots };
}

function* walk<V>(n: Slot<V>): Generator<readonly [string, V]> {
  if (n.leaf) {
    yield* n.entries;
    return;
  }
  for (const s of n.slots) yield* walk(s);
}

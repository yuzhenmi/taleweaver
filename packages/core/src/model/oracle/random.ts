/** xorshift32 in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/** Fisher–Yates, in place. */
export function shuffle<T>(r: () => number, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const a = xs[i];
    const b = xs[j];
    if (a === undefined || b === undefined) continue;
    xs[i] = b;
    xs[j] = a;
  }
  return xs;
}

export function pick<T>(r: () => number, xs: readonly T[]): T | undefined {
  return xs[Math.floor(r() * xs.length)];
}

/** A numeric env var (Node), or `fallback`. */
export function envNumber(name: string, fallback: number): number {
  const proc: unknown = Reflect.get(globalThis, "process");
  const env: unknown = typeof proc === "object" && proc !== null ? Reflect.get(proc, "env") : undefined;
  const v: unknown = typeof env === "object" && env !== null ? Reflect.get(env, name) : undefined;
  return typeof v === "string" && v !== "" ? Number(v) : fallback;
}

/** [from, to] seed ranges of at most 250 seeds. */
export function seedChunks(seeds: number): [number, number][] {
  const out: [number, number][] = [];
  for (let from = 1; from <= seeds; from += 250) out.push([from, Math.min(seeds, from + 249)]);
  return out;
}

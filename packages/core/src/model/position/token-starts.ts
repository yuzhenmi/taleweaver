import type { Segment } from "../scan/tokens";

const tokenStarts = new WeakMap<Segment, readonly number[]>();

/** Storage index of each token of `seg` in its piece (memoized: segments are immutable). */
export function starts(seg: Segment): readonly number[] {
  const memo = tokenStarts.get(seg);
  if (memo !== undefined) return memo;
  const out: number[] = [];
  let i = seg.start;
  for (const t of seg.tokens) {
    out.push(i);
    i += t.len;
  }
  tokenStarts.set(seg, out);
  return out;
}

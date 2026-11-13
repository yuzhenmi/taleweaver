import type { FloatEnvironment, PlacedFloat } from "./float-context";
import type { AbsPosEnvironment } from "./abs-pos-context";

/** Passes before giving up on a fixpoint. */
const MAX_PASSES = 4;

/**
 * Lay out a BFC root's fragment until its risen anchored floats are stable
 * (R2-3; Word re-lays until stable). Each pass after the first is rolled back
 * and re-run with the seeds the last pass settled: the floats that rose (so the
 * content before them wraps around them) and the earlier seeds whose paragraph
 * landed. A seed whose paragraph did not land was pushed off by its own risen
 * float: that paragraph is forced to the next fragmentainer, where it takes the
 * float with it. Stops when the seed set is unchanged; at the cap, re-runs the
 * last pass whose seeds all landed. Pages where no float rose run once.
 */
export function layoutWithAnchoredFloats<R>(
  env: FloatEnvironment,
  abs: AbsPosEnvironment,
  run: () => R,
): R {
  const floatMark = env.mark();
  const absMark = abs.mark();
  let seeds: readonly PlacedFloat[] = [];
  let breaks: ReadonlySet<string> = new Set();
  let settled = { seeds, breaks };
  const reset = (next: { readonly seeds: readonly PlacedFloat[]; readonly breaks: ReadonlySet<string> }): void => {
    env.rollback(floatMark);
    abs.rollback(absMark);
    for (const s of next.seeds) env.seedPlaced(s);
    env.setBreaksBefore(next.breaks);
  };
  for (let pass = 1; ; pass++) {
    const result = run();
    const landed = env.landedSince(floatMark);
    const used = seeds.filter((s) => s.anchorKey !== undefined && landed.has(s.anchorKey));
    const unused = seeds.filter((s) => !used.includes(s));
    const rose = env.getPlacedFloats().slice(floatMark.placed + seeds.length).filter((f) => f.rose === true);
    if (unused.length === 0) {
      if (rose.length === 0) return result;
      settled = { seeds, breaks };
    }
    if (pass === MAX_PASSES) {
      reset(settled);
      return run();
    }
    const nextBreaks = new Set(breaks);
    for (const u of unused) if (u.paragraphKey !== undefined) nextBreaks.add(u.paragraphKey);
    seeds = [...used, ...rose];
    breaks = nextBreaks;
    reset({ seeds, breaks });
  }
}

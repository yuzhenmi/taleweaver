import type { FloatEnvironment, PlacedFloat } from "./float-context";
import { createFloatEnvironment } from "./float-context";
import type { BreakToken } from "./fragmentation";

/**
 * R2-1: the float exclusions (cumulative) that lines of a paragraph wrapped
 * around: those reaching below `from`, where the lines' queries began, cut at
 * `until` — the furthest end of the block extents they were checked over.
 * Within that range the cut copies answer every query the lines made exactly
 * as the env did.
 */
export function floatsBeforeBreak(
  env: FloatEnvironment,
  from: number,
  until: number,
): readonly PlacedFloat[] | undefined {
  // Canonical (the same exclusions give the same token whichever env held
  // them): copies of one rectangle cut at different ends merge into the tallest;
  // sorted by position.
  const byRect = new Map<string, PlacedFloat>();
  for (const f of env.getPlacedFloats()) {
    if (f.blockOffset >= until || f.blockOffset + f.blockSize <= from) continue;
    const blockSize = Math.min(f.blockSize, until - f.blockOffset);
    const key = `${f.side}|${f.inlineOffset}|${f.blockOffset}|${f.inlineSize}`;
    const prev = byRect.get(key);
    if (prev !== undefined && prev.blockSize >= blockSize) continue;
    byRect.set(key, { side: f.side, inlineOffset: f.inlineOffset, blockOffset: f.blockOffset, inlineSize: f.inlineSize, blockSize });
  }
  if (byRect.size === 0) return undefined;
  return [...byRect.values()].sort((x, y) =>
    x.blockOffset - y.blockOffset || x.inlineOffset - y.inlineOffset || x.blockSize - y.blockSize ||
    (x.side === y.side ? 0 : x.side === "inline-start" ? -1 : 1));
}

/**
 * The env each line of a resumed paragraph wraps in: a line before the token's
 * `resumeAtLine` re-wraps against only the exclusions its fragment carried (read
 * only — the IFC never places floats); later lines against `env`, this
 * fragmentainer's.
 */
export function resumeFloatEnvs(env: FloatEnvironment, resumeFrom: BreakToken | null | undefined): (line: number) => FloatEnvironment {
  if (resumeFrom?.type !== "ifc") return () => env;
  const resumeAtLine = resumeFrom.resumeAtLine;
  const empty = createFloatEnvironment();
  const segments = (resumeFrom.floats ?? []).map((seg) => {
    const segEnv = createFloatEnvironment();
    for (const f of seg.floats) segEnv.seedPlaced(f);
    return { seg, env: segEnv };
  });
  return (line) => line >= resumeAtLine
    ? env
    : segments.find(({ seg }) => seg.fromLine <= line && line < seg.untilLine)?.env ?? empty;
}

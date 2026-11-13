import type { FloatEnvironment, PlacedFloat } from "./float-context";
import { createFloatEnvironment } from "./float-context";
import type { BreakToken } from "./fragmentation";

/**
 * R2-1: the float exclusions a paragraph's lines in `[paraFlowStart, breakAt)`
 * wrapped around (cumulative), cut at the break — what its resumed fragment must
 * re-wrap those lines against. A float reaching past the break is the next
 * fragmentainer's business (its carry), not this paragraph's.
 */
export function floatsBeforeBreak(
  env: FloatEnvironment,
  paraFlowStart: number,
  breakAt: number,
): readonly PlacedFloat[] | undefined {
  // Canonical (the same exclusions give the same token whichever env held
  // them): an earlier fragment's carried copy of a float is the same rectangle
  // cut shorter, so copies merge into the tallest; sorted by position.
  const byRect = new Map<string, PlacedFloat>();
  for (const f of env.getPlacedFloats()) {
    if (f.blockOffset >= breakAt || f.blockOffset + f.blockSize <= paraFlowStart) continue;
    const blockSize = Math.min(f.blockSize, breakAt - f.blockOffset);
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
 * The env a resumed paragraph wraps in: its fragmentainer's floats plus the
 * exclusions its token carries (read-only — the IFC never places floats).
 */
export function resumeFloatEnv(env: FloatEnvironment, resumeFrom: BreakToken | null | undefined): FloatEnvironment {
  const carried = resumeFrom?.type === "ifc" ? resumeFrom.floats : undefined;
  if (carried === undefined) return env;
  const overlay = createFloatEnvironment();
  for (const f of env.getPlacedFloats()) overlay.seedPlaced(f);
  for (const f of carried) overlay.seedPlaced(f);
  return overlay;
}

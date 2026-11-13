import type { PlacedFloat } from "./float-context";
import type { BreakToken } from "./fragmentation";
import type { ColumnsFitResult } from "./column-fit";

/**
 * The floats a page hands to the next one: those still hanging below the next
 * page's content top (cumulative flow frame). An anchored float (a wrapped
 * image) stays on its anchor's page (R2-3), so it never carries.
 */
export function floatsCarriedPast(placed: readonly PlacedFloat[], nextContentTop: number): readonly PlacedFloat[] {
  return placed.filter((f) => f.anchorKey === undefined && f.blockOffset + f.blockSize > nextContentTop);
}

/**
 * A reused plan entry's floats moved into the current cumulative flow frame:
 * `shift` is the current page's flow base minus the one the entry was built at.
 * Page layout is translation-invariant in that frame, so this is the carry a
 * re-fit would produce (T-ae).
 */
export function shiftFloats(floats: readonly PlacedFloat[], shift: number): readonly PlacedFloat[] {
  return shift === 0 ? floats : floats.map((f) => ({ ...f, blockOffset: f.blockOffset + shift }));
}

/**
 * A reused entry's break token moved into the current cumulative flow frame:
 * every IFC token's `paraFlowStart` and carried exclusions (R2-1), through
 * nested block / column / table-cell tokens. Same reference when `shift` is 0.
 */
export function shiftBreakToken<T extends BreakToken | null>(token: T, shift: number): T;
export function shiftBreakToken(token: BreakToken | null, shift: number): BreakToken | null {
  if (token === null || shift === 0) return token;
  switch (token.type) {
    case "ifc":
      return {
        ...token,
        paraFlowStart: token.paraFlowStart + shift,
        ...(token.floats !== undefined
          ? { floats: token.floats.map((c) => ({ ...c, floats: shiftFloats(c.floats, shift) })) }
          : {}),
      };
    case "block":
    case "column":
      return { ...token, resumeChildToken: shiftBreakToken(token.resumeChildToken, shift) };
    case "table":
      return token.spanningCells === undefined
        ? token
        : {
            ...token,
            spanningCells: token.spanningCells.map((s) => ({
              ...s,
              interiorBreakToken: shiftBreakToken(s.interiorBreakToken, shift),
            })),
          };
  }
}

/** A reused multicol page's per-column distribution in the current flow frame. */
export function shiftColumnsFit(fit: ColumnsFitResult | undefined, shift: number): ColumnsFitResult | undefined {
  if (fit === undefined || shift === 0) return fit;
  return {
    ...fit,
    columns: fit.columns.map((c) => ({
      ...c,
      resumeInto: shiftBreakToken(c.resumeInto, shift),
      resumeOut: shiftBreakToken(c.resumeOut, shift),
    })),
    pageResumeOut: shiftBreakToken(fit.pageResumeOut, shift),
  };
}

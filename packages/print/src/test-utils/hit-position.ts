import { resolvePositionFromPixel as resolveHitRaw } from "../cursor/hit-test";
import type { Position, State } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";

/**
 * Test helper: position-only view of `resolvePositionFromPixel`.
 *
 * P4-C.2.2b changed `resolvePositionFromPixel` to return
 * `{ position, caretAffinity }` so a click seeds `EditorState.caretAffinity` at
 * a bidi direction boundary. Tests that assert ONLY the resolved `Position`
 * (offset / blockId) use this thin wrapper to keep the prior `Position | null`
 * shape. The affinity SEED itself is asserted directly via the raw
 * `resolvePositionFromPixel` in hit-test.test.ts / set-selection tests.
 */
export function resolveHitPosition(
  state: State,
  tree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  x: number,
  y: number,
  pageIndex?: number,
): Position | null {
  const hit = resolveHitRaw(state, tree, shaperOrMeasurer, x, y, pageIndex);
  return hit === null ? null : hit.position;
}

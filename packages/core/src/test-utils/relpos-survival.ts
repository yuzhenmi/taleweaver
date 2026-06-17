/**
 * Test-only helpers for measuring Yjs `RelativePosition` survival across the
 * engine's structural ops — the SOUND way (with a liveness check). Shared by the
 * comment-anchor-survival spike and the inline-op identity-survival suites.
 *
 * A `RelativePosition` "survives" an op only if it resolves to a `Y.Text` that is
 * STILL LIVE in the document (reachable from the blocks map) AND holds the
 * expected char at the resolved index. The liveness check is load-bearing: Yjs can
 * still resolve a position into a REPLACED/CLONED-but-store-resident `Y.Text`
 * (whose `_item` isn't tombstoned when only its containing array slot was
 * replaced) — a false positive. A rebuilt/cloned `Y.Text` is not in the live set →
 * correctly reported as orphaned. Uniform across insert/delete/split/merge.
 */
import * as Y from "yjs";
import type { State } from "../state/state";
import { STATE_INTERNAL } from "../state/state-internal";
import { getBlocksMap, getYBlock } from "../state/yjs-doc";
import type { BlockId } from "../state/block-id";

/** The underlying Y.Doc of a State (test-only encapsulation pierce). */
export function docOf(state: State): Y.Doc {
  return state[STATE_INTERNAL].doc;
}

/** A text item's live `Y.Text` for block `id` at `itemIndex` (used to MINT an anchor pre-op). */
export function itemText(state: State, id: string, itemIndex = 0): Y.Text {
  const yBlock = getYBlock(docOf(state), id as BlockId, "itemText");
  const yInline = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  return yInline.get(itemIndex).get("text") as Y.Text;
}

/** Mint a `RelativePosition` at `charIndex` within block `id`'s `itemIndex`-th text item. */
export function relAt(state: State, id: string, charIndex: number, itemIndex = 0): Y.RelativePosition {
  return Y.createRelativePositionFromTypeIndex(itemText(state, id, itemIndex), charIndex);
}

/**
 * Every LIVE text-item `Y.Text` reachable from the MAIN blocks map (the "alive" set).
 *
 * SCOPE LIMITATION: this scans only `getBlocksMap` — it does NOT include `Y.Text`s in
 * embed-content (footnote/caption) or template-content (header/footer) body blocks. A
 * test that mints an anchor inside such a body and calls `survives()` would get a
 * FALSE "orphaned" report. Tests stay in the main tree, or extend this to scan all
 * three trees, before anchoring into embed/template bodies.
 */
export function liveItemTexts(state: State): Set<Y.Text> {
  const out = new Set<Y.Text>();
  for (const yBlock of getBlocksMap(docOf(state)).values()) {
    const yInline = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>> | null;
    if (yInline === null) continue;
    for (let i = 0; i < yInline.length; i++) {
      const yItem = yInline.get(i);
      if (yItem.get("kind") === "text") out.add(yItem.get("text") as Y.Text);
    }
  }
  return out;
}

/**
 * True iff `rel` resolves (against `state`'s post-op doc) to a STILL-LIVE `Y.Text`
 * holding `expectChar` at the resolved index. See module docstring for why the
 * liveness check is load-bearing.
 */
export function survives(rel: Y.RelativePosition, state: State, expectChar: string): boolean {
  const doc = docOf(state);
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc); // (relPos, doc) — relPos FIRST
  if (abs === null || !(abs.type instanceof Y.Text)) return false;
  if (!liveItemTexts(state).has(abs.type)) return false; // resolved into a dead/replaced text
  return abs.type.toString().charAt(abs.index) === expectChar;
}

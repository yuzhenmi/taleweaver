/**
 * Test-only helpers for measuring CHARACTER-level `RelativePosition` survival
 * across the engine's ops. A leaf block's inline content is ONE `Y.Text`, so a
 * `RelativePosition` minted at a block offset anchors to that character's CRDT
 * item.
 *
 * A position "survives" an op only if its anchor character is STILL LIVE (not
 * deleted — Yjs would otherwise silently resolve a dead char to its old neighbour)
 * in a block `Y.Text` that is still reachable from one of the three block trees,
 * AND that character is `expectChar`. A re-minted character (e.g. one moved
 * between blocks by a split / merge) is a different item → reported as orphaned.
 */
import * as Y from "yjs";
import type { State } from "../state/state";
import { STATE_INTERNAL } from "../state/state-internal";
import { getTreeMaps, getYBlock, type BlockTreeKind } from "../state/yjs-doc";
import type { BlockId } from "../state/block-id";
import { followRedoneItem, inlineItemsFromYText, requireYInline } from "../state/y-inline";

/** The underlying Y.Doc of a State (test-only encapsulation pierce). */
export function docOf(state: State): Y.Doc {
  return state[STATE_INTERNAL].doc;
}

/** Block `id`'s inline `Y.Text`. */
export function blockText(state: State, id: string, kind: BlockTreeKind = "block"): Y.Text {
  return requireYInline(getYBlock(docOf(state), id as BlockId, "blockText", kind), id as BlockId, "blockText");
}

/** Mint a `RelativePosition` anchored to the character at block offset `offset` of block `id`. */
export function relAt(state: State, id: string, offset: number, kind: BlockTreeKind = "block"): Y.RelativePosition {
  return Y.createRelativePositionFromTypeIndex(blockText(state, id, kind), offset);
}

/** Every live block `Y.Text` across the three block trees. */
function liveBlockTexts(state: State): Set<Y.Text> {
  const out = new Set<Y.Text>();
  for (const tree of getTreeMaps(docOf(state))) {
    for (const yBlock of tree.values()) {
      const inline = yBlock.get("inlineContent");
      if (inline instanceof Y.Text) out.add(inline);
    }
  }
  return out;
}

/** The block offset-aligned text of `yText` (each embed is one U+FFFC). */
function alignedText(yText: Y.Text): string {
  return inlineItemsFromYText(yText)
    .map((it) => (it.kind === "text" ? it.text : "￼"))
    .join("");
}

/**
 * True iff `rel`'s anchor character is still live, in a live block `Y.Text`, and
 * is `expectChar`. See module docstring.
 */
export function survives(rel: Y.RelativePosition, state: State, expectChar: string): boolean {
  const doc = docOf(state);
  const item = rel.item === null ? null : followRedoneItem(doc, rel.item);
  if (item === null || item.deleted) return false;
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
  if (abs === null || !(abs.type instanceof Y.Text)) return false;
  if (!liveBlockTexts(state).has(abs.type)) return false;
  return alignedText(abs.type).charAt(abs.index) === expectChar;
}

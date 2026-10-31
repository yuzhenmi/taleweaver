/**
 * Test-only helpers for measuring CHARACTER-level `RelativePosition` survival
 * across the engine's ops. A block's content is a region of a flow (pieces of
 * `Y.Text`), so a `RelativePosition` minted at a block offset anchors to that
 * character's CRDT item.
 *
 * A position "survives" an op only if its anchor character is STILL LIVE (not
 * deleted — Yjs would otherwise silently resolve a dead char to its old neighbour)
 * in a live block, AND that character is `expectChar`. A re-minted character (e.g.
 * one moved between blocks) is a different item → reported as orphaned.
 */
import * as Y from "yjs";
import type { Document } from "../state/state";
import { getBlock, resolveBlock } from "../state/state";
import { STATE_INTERNAL } from "../state/state-internal";
import type { BlockId } from "../state/block-id";
import { followRedoneItem } from "../state/y-inline";
import { requireBlockText, pointInRegion, type BlockText } from "../state/block-text";
import { readCtx, regionOf, positionAtPieceIndex } from "../state/flow-read";
import { isPiece } from "../state/y-flow";

/** The underlying Y.Doc of a Document (test-only encapsulation pierce). */
export function docOf(state: Document): Y.Doc {
  return state[STATE_INTERNAL].doc;
}

/** Block `id`'s inline text surface. */
export function blockText(state: Document, id: string): BlockText {
  return requireBlockText(docOf(state), id as BlockId, "blockText");
}

/** Mint a `RelativePosition` anchored to the character at block offset `offset` of block `id`. */
export function relAt(state: Document, id: string, offset: number): Y.RelativePosition {
  const doc = docOf(state);
  const ctx = readCtx(doc);
  const region = regionOf(ctx, id);
  if (region === null) throw new Error(`relAt: block "${id}" has no inline content`);
  // The char AT `offset` starts right after the point at `offset` (index of that char).
  const p = pointInRegion(ctx, region, offset + 1);
  return Y.createRelativePositionFromTypeIndex(p.piece, p.index - 1);
}

/**
 * True iff `rel`'s anchor character is still live, in a live block, and is
 * `expectChar`. See module docstring.
 */
export function survives(rel: Y.RelativePosition, state: Document, expectChar: string): boolean {
  const doc = docOf(state);
  const item = rel.item === null ? null : followRedoneItem(doc, rel.item);
  if (item === null || item.deleted) return false;
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
  if (abs === null || !isPiece(abs.type)) return false;
  const at = positionAtPieceIndex(readCtx(doc), abs.type, abs.index + 1);
  if (at === null) return false;
  const block = getBlock(state, at.id as BlockId) ?? resolveBlock(state, at.id as BlockId)?.block ?? null;
  const items = block?.inlineContent?.items ?? null;
  if (items === null) return false;
  const text = items.map((it) => (it.kind === "text" ? it.text : "￼")).join("");
  return text.charAt(at.offset - 1) === expectChar;
}

// packages/core/src/layout/resolve-goto-destination.ts
//
// #522 — internal /GoTo destination resolution for the PDF exporter. Maps a
// cross-reference / TOC target block id to its exact PDF destination
// `{ pageIndex, yTopPx, xLeftPx }` (or `null` for a broken / slot target),
// wrapping the shipped `resolvePixelPosition` (exact-y, materializes only the
// touched page) + `pageOfFieldTarget` (broken-ref / slot-target gate). A factory
// partial-applies the document context into the `(targetId) => …` closure the
// PDF page-emitter injects as `EmitPdfInput.resolveInternalDestination`.

import type { State, BlockId } from "@taleweaver/core";
import { asBlockId } from "@taleweaver/core";
import type { VirtualLayoutTree } from "./virtual-layout-tree";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { resolvePixelPosition } from "../cursor/cursor-position";
import { pageOfFieldTarget, type BlockParentLookup } from "./page-of-field-target";

/** An internal-link destination: the 0-based page and the page-relative
 *  top-left (px) the viewer should align to (PDF /XYZ left top). */
export interface InternalDestination {
  readonly pageIndex: number;
  readonly yTopPx: number;
  readonly xLeftPx: number;
}

/**
 * Resolve a cross-reference / TOC target block id to its exact PDF destination,
 * or `null` when the target is broken (deleted / unindexed) or lives in a
 * header/footer/footnote slot body (→ no internal annotation, graceful).
 *
 * Exact-y is the shipped `resolvePixelPosition` (materializes only the touched
 * page); `pageOfFieldTarget` is the broken-ref / slot-target gate (-1 for a
 * target with no indexed body page). `xLeftPx`/`yTopPx` are the target's caret
 * coords at offset 0 (page-relative, physical), consumed by the emitter's
 * `pointYUp`.
 */
export function resolveGotoDestination(
  state: State,
  targetId: BlockId,
  virtualTree: VirtualLayoutTree,
  shaper: TextShaper | TextMeasurer,
  parentOf: BlockParentLookup,
): InternalDestination | null {
  const page = pageOfFieldTarget(virtualTree.plan, targetId, parentOf);
  if (page < 0) return null;
  const pos = resolvePixelPosition(
    state,
    { blockId: targetId, offset: 0 },
    virtualTree,
    shaper,
  );
  if (pos === null) return null;
  return { pageIndex: pos.pageIndex, yTopPx: pos.lineY, xLeftPx: pos.x };
}

/**
 * Partial-apply `resolveGotoDestination` over the document context, yielding the
 * `(targetId) => InternalDestination | null` closure injected as
 * `EmitPdfInput.resolveInternalDestination`. The boundary takes a raw `string`
 * (the page-emitter's targetId/navTarget) and brands it via `asBlockId`.
 */
export function makeInternalDestinationResolver(
  state: State,
  virtualTree: VirtualLayoutTree,
  shaper: TextShaper | TextMeasurer,
  parentOf: BlockParentLookup,
): (targetId: string) => InternalDestination | null {
  return (targetId: string) =>
    resolveGotoDestination(state, asBlockId(targetId), virtualTree, shaper, parentOf);
}

import type { BlockId } from "../block";
import { resolveBlock } from "../document/blocks";
import type { Document, FlowState } from "../document/types";
import { holdsFlows, isBlockObject } from "../scan/kinds";
import { isTableStart } from "../storage/table-marks";
import { type ParagraphLayout, type StoragePoint, type TerminatorRef, flowOfBlock, terminatorOf } from "./paragraph-layout";
import { pointOf } from "./storage-points";
import { tableExtent } from "./table-extent";
import { followingOf } from "./terminator-neighbours";

/** A block object read in a version, and its storage. */
export interface BlockObject {
  readonly fs: FlowState;
  /** Its item: a TOC, or a table's `⟦`. */
  readonly term: TerminatorRef;
  /** The point just before it. */
  readonly point: StoragePoint;
  /** The point just after it (a table's: after its `⟧`, or where it is closed). */
  readonly end: StoragePoint;
  /** The terminator the paragraph after it follows: its item, a table's `⟧`; null for a table no `⟧` closes. */
  readonly last: TerminatorRef | null;
}

/**
 * Block object `id` of version `d`; null when `id` is no block object read in `d`. A table
 * is its whole bracket; its rows, cells and `⟧` are not objects.
 */
export function blockObjectAt(d: Document, id: BlockId): BlockObject | null {
  const b = resolveBlock(d, id);
  const fs = b === null ? undefined : flowOfBlock(d, b.block, b.kind);
  const term = fs === undefined ? null : terminatorOf(d, fs, id);
  const point = fs === undefined || term === null ? null : pointOf(fs, term);
  if (fs === undefined || term === null || point === null || !isBlockObject(term.token.k)) return null;
  if (!holdsFlows(term.token.k)) return { fs, term, point, end: { ...point, index: point.index + term.token.len }, last: term };
  const x = isTableStart(term.token.map) ? tableExtent(fs, term) : null;
  return x === null ? null : { fs, term, point, end: x.end, last: x.close };
}

/** The paragraph right after block object `o` (its implicit one when no paragraph starts there); null when it is not read in `d`, or is a table no `⟧` closes. */
export function paragraphAfterObject(d: Document, o: BlockObject): ParagraphLayout | null {
  if (o.last === null) return null;
  const next = followingOf(d, o.fs, o.last);
  return next.k === "paragraph" ? next.L : null;
}

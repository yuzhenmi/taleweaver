import type { BlockId } from "../block";
import { resolveBlock } from "../document/blocks";
import type { Document, FlowState } from "../document/types";
import { isBlockObject } from "../scan/kinds";
import { type ParagraphLayout, type StoragePoint, type TerminatorRef, flowOfBlock, terminatorOf } from "./paragraph-layout";
import { pointOf } from "./storage-points";
import { followingOf } from "./terminator-neighbours";

/** Block object `id` of version `d`: its flow, its terminator and the storage point just before it; null when `id` is no block object read in `d`. */
export function blockObjectAt(d: Document, id: BlockId): { readonly fs: FlowState; readonly term: TerminatorRef; readonly point: StoragePoint } | null {
  const b = resolveBlock(d, id);
  const fs = b === null ? undefined : flowOfBlock(d, b.block, b.kind);
  const term = fs === undefined ? null : terminatorOf(d, fs, id);
  const point = fs === undefined || term === null ? null : pointOf(fs, term);
  return fs === undefined || term === null || point === null || !isBlockObject(term.token.k) ? null : { fs, term, point };
}

/** The paragraph right after block object `t` (its implicit one when no paragraph starts there); null only when `t` is not read in `d`. */
export function paragraphAfterObject(d: Document, fs: FlowState, t: TerminatorRef): ParagraphLayout | null {
  const next = followingOf(d, fs, t);
  return next.k === "paragraph" ? next.L : null;
}

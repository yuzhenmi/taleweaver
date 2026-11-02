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

/** The paragraph after block object `t` (past the block objects abutting it: a concurrent W2 break), or null (an `[S]` / the flow end follows). */
export function paragraphAfterObject(d: Document, fs: FlowState, t: TerminatorRef): ParagraphLayout | null {
  for (let next = followingOf(d, fs, t); ; next = followingOf(d, fs, next.term)) {
    if (next.k === "paragraph") return next.L;
    if (next.k === "end" || !isBlockObject(next.term.token.k)) return null;
  }
}

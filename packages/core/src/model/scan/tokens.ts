import type * as Y from "yjs";
import type { InlineItem } from "../block";
import type { ObjectKindRegistry } from "../object-kinds";
import type { MarkRole } from "../storage/table-marks";
import type { TerminatorKind } from "./kinds";

export interface FootnoteRef {
  /** The anchor embed's item id; its body's root id is `${id}/body`. */
  readonly id: string;
  readonly body: Y.Map<unknown> | null;
}

export interface RunToken {
  readonly k: "run";
  /** Storage index units (Y.Text length) the run spans in its piece. */
  readonly len: number;
  readonly items: readonly InlineItem[];
  readonly footnotes: readonly FootnoteRef[];
  /**
   * Run-relative storage offsets (ascending) of the INERT units — storage that reads
   * as nothing. Read offset ↔ storage index within the run skips exactly these.
   */
  readonly inert: readonly number[];
  /**
   * Some of its inert units are table marks read inert in their context (folded in by
   * `derive/table/inert-marks.ts`): a re-read whose context may differ must rescan it.
   */
  readonly foldedMarks?: true;
}

export interface TerminatorToken {
  readonly k: TerminatorKind;
  readonly len: number;
  readonly id: string;
  readonly map: Y.Map<unknown>;
  /**
   * A table mark's role and stored depth (null: invalid), read at scan time: an old
   * version's tokens keep them after a later transaction deletes the mark (a deleted
   * map reads no keys).
   */
  readonly mark?: { readonly role: MarkRole | null; readonly d: number | null };
}

/** A table mark token's role (null for any other token). */
export const roleOf = (t: TerminatorToken): MarkRole | null => t.mark?.role ?? null;
/** A table mark token's stored depth (null for any other token, or an invalid depth). */
export const depthOf = (t: TerminatorToken): number | null => t.mark?.d ?? null;

export type Token = RunToken | TerminatorToken;

export const isTerminator = (t: Token): t is TerminatorToken => t.k !== "run";

/**
 * A SEGMENT: the tokens of `[start, start + len)` of one piece, a range holding no
 * sub-flow item. A flow reads as its segments in reading order: a piece holding
 * sub-flows splits into one segment per gap around its sub-flow items, and each
 * sub-flow's pieces' segments sit between them (X12, read in place). Every piece is
 * therefore scanned — and re-scanned on a delta — on its own.
 */
export interface Segment {
  readonly piece: Y.Text;
  /** Sub-flow depth of the piece (0 = top level). */
  readonly depth: number;
  /** Storage index of the segment's start in its piece. */
  readonly start: number;
  /** Storage index units the segment spans. */
  readonly len: number;
  readonly tokens: readonly Token[];
}

/** What a flow's read depends on besides storage. */
export interface ScanCtx {
  readonly registry: ObjectKindRegistry;
  /** Footnote anchors are read (main tree only); otherwise they are inert. */
  readonly footnotes: boolean;
}

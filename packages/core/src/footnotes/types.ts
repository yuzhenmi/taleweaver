/**
 * @module footnotes/types
 *
 * Shared types for the footnote-numbering module (FN-3). Kept in one place so
 * `collect-anchors`, `numbering`, and consumers (render markers, the
 * `resolveFootnotes` layout pass) import from a single source.
 */
import type { BlockId } from "../state";
import type { CounterFormat } from "./format-counter";

/**
 * A reference to one footnote anchor, in document order. The anchor's STABLE
 * IDENTITY is its `contentBlockId` (the footnote body root in `embedContents`);
 * `blockId` / `sectionId` are positional context the numbering engine needs.
 */
export interface FootnoteAnchorRef {
  /**
   * The footnote body root id (`EmbedItem.properties.contentBlockId`). This is
   * the footnote's identity and the key the numbering map is keyed on.
   */
  readonly contentBlockId: BlockId;
  /** The leaf block whose `inlineContent` carries this anchor's `EmbedItem`. */
  readonly blockId: BlockId;
  /**
   * The id of the enclosing `section` block, or `null` for the implicit root
   * section (anchors in blocks that are direct children of the document root,
   * before any `section` boundary). Drives `restart-per-section`.
   */
  readonly sectionId: BlockId | null;
}

/**
 * How footnote numbers reset, plus the displayed format. Mirrors the Google
 * Docs footnote settings (per-section in the full model; FN-3 takes a single
 * doc-wide policy — per-section policy variation is a later refinement that
 * does not change this shape).
 */
export interface FootnoteNumberingPolicy {
  readonly reset: "continuous" | "restart-per-section" | "restart-per-page";
  readonly format: CounterFormat;
}

/** The computed number for one footnote: raw value + its formatted string. */
export interface FootnoteNumber {
  /** The raw 1-based counter value (before formatting). */
  readonly value: number;
  /** `formatCounter(value, policy.format)`. */
  readonly formatted: string;
}

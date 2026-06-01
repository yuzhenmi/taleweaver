/**
 * @module footnotes
 *
 * Footnote-specific cross-cutting logic. FN-3 lands the pure numbering module:
 * `formatCounter` (counter-format function), `collectFootnoteAnchors` (ordered
 * anchor walk over the main document), and `footnoteNumbers` (the numbering
 * engine: continuous + restart-per-section, with restart-per-page reserved for
 * FN-6). Later footnote work (FN-4's `resolveFootnotes` layout pass, FN-6's
 * per-page numbering) co-locates here.
 */
export type { CounterFormat } from "./format-counter";
export { formatCounter } from "./format-counter";

export type {
  FootnoteAnchorRef,
  FootnoteNumber,
  FootnoteNumberingPolicy,
} from "./types";

export { collectFootnoteAnchors, EMPTY_FOOTNOTE_ANCHORS, SECTION_BLOCK_TYPE } from "./collect-anchors";
export { footnoteNumbers, footnoteRenumberedBlocks } from "./numbering";
export {
  documentFootnotePolicy,
  DEFAULT_FOOTNOTE_NUMBERING_POLICY,
  isValidFootnoteReset,
  isValidFootnoteFormat,
} from "./policy";

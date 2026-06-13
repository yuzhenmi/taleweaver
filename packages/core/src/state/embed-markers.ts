import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "./comments";
import {
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
} from "./suggestions";

/**
 * The `embedType`s of ZERO-WIDTH STRUCTURAL MARKER embeds — embeds that carry no
 * user content and exist only to delimit a range or mark a tracked-change
 * boundary:
 *   - `comment-start` / `comment-end` — the paired markers delimiting a comment's
 *     anchored range (see `comments.ts`);
 *   - `block-join-suggestion` / `block-split-suggestion` — the change-tracking
 *     markers recording a suggested paragraph merge / split (see `suggestions.ts`).
 *
 * These markers are NOT user content: their appearance (when shown at all) is
 * intrinsic to the render layer, and their meaning lives in `properties`
 * (`commentId` / `suggestionId`), never in text-formatting `attrs`. Operations
 * that apply inline formatting to a range MUST NOT stamp format attrs onto them
 * (see {@link isStructuralMarkerEmbedType}). Contrast VISIBLE field embeds
 * (`footnote-anchor`, `cross-reference`, `page-field`, `tab`), which are real
 * cursor positions that legitimately inherit run formatting.
 */
export const STRUCTURAL_MARKER_EMBED_TYPES: ReadonlySet<string> = new Set([
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
]);

/**
 * True when `embedType` names a zero-width structural marker embed (see
 * {@link STRUCTURAL_MARKER_EMBED_TYPES}). Used by `applyAttrsToRange` to skip
 * stamping inline-format attrs onto markers — they carry no formattable content,
 * and stamping a tracked-change provenance attr onto one leaves a dangling
 * reference after the suggestion resolves.
 */
export function isStructuralMarkerEmbedType(embedType: string): boolean {
  return STRUCTURAL_MARKER_EMBED_TYPES.has(embedType);
}

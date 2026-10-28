import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "./comments";

/** Bookmark markers (`bookmarks.ts`; literals here to keep this module import-cycle free). */
const BOOKMARK_MARKER_TYPES = ["bookmark-start", "bookmark-end"] as const;

/**
 * The `embedType`s of ZERO-WIDTH STRUCTURAL MARKER embeds — embeds that carry no
 * user content and exist only to delimit a range: `comment-start` /
 * `comment-end`, the paired markers delimiting a comment's anchored range (see
 * `comments.ts`), and `bookmark-start` / `bookmark-end` (a bookmark, `bookmarks.ts`). (Paragraph-break suggestions are not inline items: they are tags
 * on the paragraph mark, see `break-tags.ts`.)
 *
 * These markers are NOT user content: their appearance (when shown at all) is
 * intrinsic to the render layer, and their meaning lives in `properties`
 * (`commentId`), never in text-formatting `attrs`. Operations that apply inline
 * formatting to a range MUST NOT stamp format attrs onto them (see
 * {@link isStructuralMarkerEmbedType}). Contrast VISIBLE field embeds
 * (`footnote-anchor`, `cross-reference`, `page-field`, `tab`), which are real
 * cursor positions that legitimately inherit run formatting.
 */
export const STRUCTURAL_MARKER_EMBED_TYPES: ReadonlySet<string> = new Set([
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  ...BOOKMARK_MARKER_TYPES,
]);

/**
 * True when `embedType` names a zero-width structural marker embed (see
 * {@link STRUCTURAL_MARKER_EMBED_TYPES}). Used by `applyAttrsToRange` to skip
 * stamping inline-format attrs onto markers — they carry no formattable content.
 */
export function isStructuralMarkerEmbedType(embedType: string): boolean {
  return STRUCTURAL_MARKER_EMBED_TYPES.has(embedType);
}

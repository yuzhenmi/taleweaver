/** The inline (character-level) formatting attr keys. Single source of truth
 * for "what counts as inline character formatting" — consumed by
 * CLEAR_FORMATTING. Add new inline formats here when they ship (e.g. a future
 * superscript/subscript). */
export const INLINE_FORMAT_ATTR_KEYS = [
  "bold", "italic", "underline", "strikethrough",
  "color", "backgroundColor", "fontSize", "fontFamily", "link", "textTransform",
] as const;
export type InlineFormatAttrKey = (typeof INLINE_FORMAT_ATTR_KEYS)[number];

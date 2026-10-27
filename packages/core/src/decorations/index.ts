export type {
  Decoration,
  DecorationStyle,
  DecorationAttrs,
  InlineDecoration,
  WidgetDecoration,
  BlockDecoration,
  InlineSegment,
  BlockDecorations,
  DecorationSet,
} from "./decorations";
export {
  EMPTY_DECORATION_SET,
  createDecorationSet,
  mapDecorationSet,
  changedDecorationBlocks,
  mergeDecorationSets,
  patchDecorationSet,
  mapDecorations,
  decorationsAt,
} from "./decorations";
export type { CommentHighlight, SuggestionHighlight } from "./builtin-highlights";
export {
  findHighlightDecorations,
  findDecorationId,
  commentHighlightDecorations,
  suggestionHighlightDecorations,
  FIND_HIGHLIGHT_FILL,
  ACTIVE_FIND_HIGHLIGHT_FILL,
  COMMENT_HIGHLIGHT_FILL,
  ACTIVE_COMMENT_HIGHLIGHT_FILL,
  SUGGESTION_HIGHLIGHT_FILL,
  ACTIVE_SUGGESTION_HIGHLIGHT_FILL,
} from "./builtin-highlights";
export type { DecorationLayers } from "./decoration-layers";
export { createDecorationLayers, transitionMapping } from "./decoration-layers";

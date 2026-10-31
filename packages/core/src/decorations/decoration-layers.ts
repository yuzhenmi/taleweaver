import type { EditorState } from "../editor/editor-state";
import type { DocumentChange } from "../editor/document-change";
import type { Block, BlockId, Position, Document, TextMatch, SuggestionGroup } from "../state";
import { mappingAcross, IDENTITY_MAPPING, UNKNOWN_MAPPING, type PositionMapping } from "../state/position-mapping";
import { peekBlock, resolveBlock } from "../state/document";
import { recordSample } from "../perf/perf-trace";
import {
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  isFormattingSuggestionKey,
} from "../state";
import {
  createDecorationSet,
  mapDecorationSet,
  mergeDecorationSets,
  patchDecorationSet,
  EMPTY_DECORATION_SET,
  type Decoration,
  type DecorationAttrs,
  type DecorationSet,
} from "./decorations";
import {
  findHighlightDecorations,
  commentHighlightDecorations,
  suggestionHighlightDecorations,
  suggestionGroupDecorations,
  type CommentHighlight,
  type SuggestionHighlight,
} from "./builtin-highlights";

/**
 * The position mapping for one editor transition `prev → next` (any reducer action, undo,
 * or a foreign change reconciled into `next`, optionally followed by selection-only
 * actions). Selection-only transitions are identity; a state change of unknown extent
 * (document replaced) or spanning several document changes is unknown.
 */
export function transitionMapping(prev: EditorState, next: EditorState): PositionMapping {
  if (prev.document === next.document) return IDENTITY_MAPPING;
  // `lastChange` links the recent document changes. Walk back to the one made from
  // `prev.document` (a host may batch several dispatches before handing the controller a
  // state) and diff `prev.document` → `next.document` ONCE over the union of their dirty blocks.
  // Only the two endpoints are read — `prev` through the cache-only peek, `next` live —
  // never a superseded intermediate Document (whose uncached blocks would read the current
  // Y.Doc). Past the bounded chain the extent is unknown: map conservatively.
  const links: DocumentChange[] = [];
  for (let c = next.lastChange; c !== null; c = c.prior) {
    links.push(c);
    if (c.from === prev.document) return mappingAcross(links.reverse(), next.document, editStart(prev), editStart(next));
  }
  return UNKNOWN_MAPPING;
}

/**
 * A position the edit from `prev` touches: the selection's start when both ends share a
 * block, else the focus. Computed from the selection alone — ordering a cross-block span
 * would read the superseded `prev.document`, whose Y.Doc has already been mutated.
 */
function editStart(editor: EditorState): Position {
  const { anchor, focus } = editor.selection;
  return anchor.blockId === focus.blockId && anchor.offset < focus.offset ? anchor : focus;
}

/** Comment markers in a block, as a comparable signature ("" when none). */
function markerSignature(block: Block | undefined): string {
  let sig = "";
  for (const i of block?.inlineContent?.items ?? []) {
    if (i.kind === "embed" && (i.embedType === COMMENT_START_EMBED_TYPE || i.embedType === COMMENT_END_EMBED_TYPE)) {
      sig += `${i.embedType}:${String(i.properties.commentId)};`;
    }
  }
  return sig;
}

/** Did the transition add, remove or move a comment marker between blocks? Unknown ⇒ yes. */
function markersChanged(prev: Document, next: Document, dirty: ReadonlySet<BlockId> | null): boolean {
  if (dirty === null) return true;
  let before = "";
  let after = "";
  for (const id of dirty) {
    const p = peekBlock(prev, id);
    if (p === undefined && resolveBlock(next, id) !== null && markerSignature(resolveBlock(next, id)?.block) !== "") return true;
    before += `${id}=${markerSignature(p)}|`;
    after += `${id}=${markerSignature(resolveBlock(next, id)?.block)}|`;
  }
  return before !== after;
}
function holdsSuggestion(block: Block | undefined): boolean {
  // A boundary tag (paragraph / section-break suggestion) lives on the block itself.
  if (block?.breakSuggestion !== undefined) return true;
  return (block?.inlineContent?.items ?? []).some(
    (i) =>
      i.attrs[INSERTION_SUGGESTION_ATTR] !== undefined ||
      i.attrs[DELETION_SUGGESTION_ATTR] !== undefined ||
      Object.keys(i.attrs).some(isFormattingSuggestionKey),
  );
}

/** Does the transition touch (before or after) a block matching `pred`? Unknown ⇒ yes. */
function dirtyTouches(
  prev: Document,
  next: Document,
  dirty: ReadonlySet<BlockId> | null,
  pred: (b: Block | undefined) => boolean,
): boolean {
  if (dirty === null) return true;
  for (const id of dirty) {
    if (pred(peekBlock(prev, id)) || pred(resolveBlock(next, id)?.block)) return true;
  }
  return false;
}

/**
 * A controller's decoration layers, drawn bottom-to-top: suggestion highlights, comment
 * highlights, find highlights, host decorations. Host and find layers are carried through
 * edits by position mapping; comment and suggestion highlights are re-resolved from live
 * state (their anchors live in the document and move with the text).
 */
export interface DecorationLayers {
  /** The host layer, mapped to the current state. */
  readonly host: DecorationSet;
  /** Every layer merged — what a backend draws. */
  readonly merged: DecorationSet;
  setHost(document: Document, decorations: readonly Decoration[]): void;
  setFind(document: Document, matches: readonly TextMatch[], activeIndex: number): void;
  /** Redraw only the find highlights in `blocks` (an incremental find refresh). */
  patchFind(document: Document, matches: readonly TextMatch[], activeIndex: number, blocks: ReadonlySet<BlockId>): void;
  setComments(document: Document, highlights: readonly CommentHighlight[] | null): void;
  setSuggestions(document: Document, highlights: readonly SuggestionHighlight[] | null): void;
  /**
   * Host per-group styling of suggestions (e.g. a colour per `metadata.source`), kept
   * LIVE: re-derived from the document whenever an edit touches tracked runs or group
   * records (a proposal landing, accept / reject, undo). `null` clears it.
   */
  setSuggestionStyles(document: Document, styleOf: SuggestionGroupStyle | null): void;
  /** Carry every layer through the transition `prev → next`. */
  advance(prev: EditorState, next: EditorState, mapping?: PositionMapping): void;
}

/** How the host styles a suggestion group (null = leave it to the built-in visuals). */
export type SuggestionGroupStyle = (group: SuggestionGroup) => DecorationAttrs | null;

export function createDecorationLayers(): DecorationLayers {
  let host = EMPTY_DECORATION_SET;
  let groupStyle: SuggestionGroupStyle | null = null;
  let groupStyleSet = EMPTY_DECORATION_SET;
  let find = EMPTY_DECORATION_SET;
  let comments: readonly CommentHighlight[] | null = null;
  let suggestions: readonly SuggestionHighlight[] | null = null;
  let commentSet = EMPTY_DECORATION_SET;
  let suggestionSet = EMPTY_DECORATION_SET;
  let merged = EMPTY_DECORATION_SET;

  const remerge = (): void => {
    merged = mergeDecorationSets([suggestionSet, groupStyleSet, commentSet, find, host]);
  };
  // Each content-derived layer is re-derived on its own (a setter / trigger never
  // re-scans the others). The counters let tests prove it.
  const deriveComments = (document: Document): DecorationSet => {
    if (comments === null) return EMPTY_DECORATION_SET;
    recordSample("decorations.deriveComments", 0);
    return createDecorationSet(document, commentHighlightDecorations(document, comments));
  };
  const deriveSuggestions = (document: Document): DecorationSet => {
    if (suggestions === null) return EMPTY_DECORATION_SET;
    recordSample("decorations.deriveSuggestions", 0);
    return createDecorationSet(document, suggestionHighlightDecorations(document, suggestions));
  };
  const deriveGroupStyles = (document: Document): DecorationSet => {
    if (groupStyle === null) return EMPTY_DECORATION_SET;
    recordSample("decorations.deriveGroupStyles", 0);
    return createDecorationSet(document, suggestionGroupDecorations(document, groupStyle));
  };

  return {
    get host() {
      return host;
    },
    get merged() {
      return merged;
    },
    setHost(document, decorations) {
      host = createDecorationSet(document, decorations);
      remerge();
    },
    setFind(document, matches, activeIndex) {
      find = createDecorationSet(document, findHighlightDecorations(matches, activeIndex));
      remerge();
    },
    patchFind(document, matches, activeIndex, blocks) {
      find = patchDecorationSet(find, document, blocks, findHighlightDecorations(matches, activeIndex, blocks));
      remerge();
    },
    setComments(document, highlights) {
      comments = highlights;
      commentSet = deriveComments(document);
      remerge();
    },
    setSuggestions(document, highlights) {
      suggestions = highlights;
      suggestionSet = deriveSuggestions(document);
      remerge();
    },
    setSuggestionStyles(document, styleOf) {
      groupStyle = styleOf;
      groupStyleSet = deriveGroupStyles(document);
      remerge();
    },
    advance(prev, next, given) {
      if (prev.document === next.document) return;
      const anything =
        host !== EMPTY_DECORATION_SET ||
        find !== EMPTY_DECORATION_SET ||
        comments !== null ||
        suggestions !== null ||
        groupStyle !== null;
      if (!anything) return;
      const mapping = given ?? transitionMapping(prev, next);
      // A text-identical change (formatting, accepting/rejecting a suggestion) moves no
      // position but can still change which runs are tracked.
      const changed = mapping.dirty ?? null;
      const touched = mapping.identity ? (next.lastChange?.from === prev.document ? next.lastChange.dirtyIds : null) : changed;
      if (mapping.identity && touched === null) return;
      host = mapDecorationSet(host, mapping, next.document);
      find = mapDecorationSet(find, mapping, next.document);
      // Comment / suggestion ranges are derived from document content: re-scan only when
      // the edit touched a marker / tracked run (it may have created, split or removed
      // one); otherwise their ranges move exactly like any other positions.
      if (comments !== null) {
        // Markers are characters in the text, so unless one was added/removed/moved across
        // blocks the ranges map exactly (end inclusive — see commentHighlightDecorations).
        commentSet = markersChanged(prev.document, next.document, touched)
          ? deriveComments(next.document)
          : mapDecorationSet(commentSet, mapping, next.document);
      }
      // ponytail: re-scans the whole document when an edit touches a tracked run (every
      // keystroke in suggesting mode while suggestion highlights are shown); upgrade to a
      // per-block incremental suggestion range index if it shows up in profiles.
      if (suggestions !== null) {
        suggestionSet = dirtyTouches(prev.document, next.document, touched, holdsSuggestion)
          ? deriveSuggestions(next.document)
          : mapDecorationSet(suggestionSet, mapping, next.document);
      }
      // Group styling: group records live in a side table (a change to them surfaces the
      // root as dirty), runs in the blocks — re-derive when either was touched.
      if (groupStyle !== null) {
        const records = touched === null || touched.has(next.document.rootId);
        groupStyleSet =
          records || dirtyTouches(prev.document, next.document, touched, holdsSuggestion)
            ? deriveGroupStyles(next.document)
            : mapDecorationSet(groupStyleSet, mapping, next.document);
      }
      remerge();
    },
  };
}

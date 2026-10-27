import type { EditorState } from "../editor/editor-state";
import type { Block, BlockId, Position, State, TextMatch, SuggestionGroup } from "../state";
import { createPositionMapping, IDENTITY_MAPPING, UNKNOWN_MAPPING, type PositionMapping } from "../state/position-mapping";
import { peekBlock, resolveBlock } from "../state/state";
import { recordSample } from "../perf/perf-trace";
import {
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
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
  if (prev.state === next.state) return IDENTITY_MAPPING;
  // `lastChange` links the recent document changes. Walk back to the one made from
  // `prev.state` (a host may batch several dispatches before handing the controller a
  // state) and diff `prev.state` → `next.state` ONCE over the union of their dirty blocks.
  // Only the two endpoints are read — `prev` through the cache-only peek, `next` live —
  // never a superseded intermediate State (whose uncached blocks would read the current
  // Y.Doc). Past the bounded chain the extent is unknown: map conservatively.
  let dirty: Set<BlockId> | null = null;
  for (let c = next.lastChange; c !== null; c = c.prior) {
    if (dirty === null) dirty = new Set(c.dirtyIds);
    else for (const id of c.dirtyIds) dirty.add(id);
    if (c.from === prev.state) return createPositionMapping(prev.state, next.state, dirty, editStart(prev), editStart(next));
  }
  return UNKNOWN_MAPPING;
}

/**
 * A position the edit from `prev` touches: the selection's start when both ends share a
 * block, else the focus. Computed from the selection alone — ordering a cross-block span
 * would read the superseded `prev.state`, whose Y.Doc has already been mutated.
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
function markersChanged(prev: State, next: State, dirty: ReadonlySet<BlockId> | null): boolean {
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
  return (block?.inlineContent?.items ?? []).some(
    (i) =>
      i.attrs[INSERTION_SUGGESTION_ATTR] !== undefined ||
      i.attrs[DELETION_SUGGESTION_ATTR] !== undefined ||
      i.attrs[FORMATTING_SUGGESTION_ATTR] !== undefined,
  );
}

/** Does the transition touch (before or after) a block matching `pred`? Unknown ⇒ yes. */
function dirtyTouches(
  prev: State,
  next: State,
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
  setHost(state: State, decorations: readonly Decoration[]): void;
  setFind(state: State, matches: readonly TextMatch[], activeIndex: number): void;
  /** Redraw only the find highlights in `blocks` (an incremental find refresh). */
  patchFind(state: State, matches: readonly TextMatch[], activeIndex: number, blocks: ReadonlySet<BlockId>): void;
  setComments(state: State, highlights: readonly CommentHighlight[] | null): void;
  setSuggestions(state: State, highlights: readonly SuggestionHighlight[] | null): void;
  /**
   * Host per-group styling of suggestions (e.g. a colour per `metadata.source`), kept
   * LIVE: re-derived from the document whenever an edit touches tracked runs or group
   * records (a proposal landing, accept / reject, undo). `null` clears it.
   */
  setSuggestionStyles(state: State, styleOf: SuggestionGroupStyle | null): void;
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
  const deriveComments = (state: State): DecorationSet => {
    if (comments === null) return EMPTY_DECORATION_SET;
    recordSample("decorations.deriveComments", 0);
    return createDecorationSet(state, commentHighlightDecorations(state, comments));
  };
  const deriveSuggestions = (state: State): DecorationSet => {
    if (suggestions === null) return EMPTY_DECORATION_SET;
    recordSample("decorations.deriveSuggestions", 0);
    return createDecorationSet(state, suggestionHighlightDecorations(state, suggestions));
  };
  const deriveGroupStyles = (state: State): DecorationSet => {
    if (groupStyle === null) return EMPTY_DECORATION_SET;
    recordSample("decorations.deriveGroupStyles", 0);
    return createDecorationSet(state, suggestionGroupDecorations(state, groupStyle));
  };

  return {
    get host() {
      return host;
    },
    get merged() {
      return merged;
    },
    setHost(state, decorations) {
      host = createDecorationSet(state, decorations);
      remerge();
    },
    setFind(state, matches, activeIndex) {
      find = createDecorationSet(state, findHighlightDecorations(matches, activeIndex));
      remerge();
    },
    patchFind(state, matches, activeIndex, blocks) {
      find = patchDecorationSet(find, state, blocks, findHighlightDecorations(matches, activeIndex, blocks));
      remerge();
    },
    setComments(state, highlights) {
      comments = highlights;
      commentSet = deriveComments(state);
      remerge();
    },
    setSuggestions(state, highlights) {
      suggestions = highlights;
      suggestionSet = deriveSuggestions(state);
      remerge();
    },
    setSuggestionStyles(state, styleOf) {
      groupStyle = styleOf;
      groupStyleSet = deriveGroupStyles(state);
      remerge();
    },
    advance(prev, next, given) {
      if (prev.state === next.state) return;
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
      const touched = mapping.identity ? (next.lastChange?.from === prev.state ? next.lastChange.dirtyIds : null) : changed;
      if (mapping.identity && touched === null) return;
      host = mapDecorationSet(host, mapping, next.state);
      find = mapDecorationSet(find, mapping, next.state);
      // Comment / suggestion ranges are derived from document content: re-scan only when
      // the edit touched a marker / tracked run (it may have created, split or removed
      // one); otherwise their ranges move exactly like any other positions.
      if (comments !== null) {
        // Markers are characters in the text, so unless one was added/removed/moved across
        // blocks the ranges map exactly (end inclusive — see commentHighlightDecorations).
        commentSet = markersChanged(prev.state, next.state, touched)
          ? deriveComments(next.state)
          : mapDecorationSet(commentSet, mapping, next.state);
      }
      // ponytail: re-scans the whole document when an edit touches a tracked run (every
      // keystroke in suggesting mode while suggestion highlights are shown); upgrade to a
      // per-block incremental suggestion range index (ticket T2) if it shows up in profiles.
      if (suggestions !== null) {
        suggestionSet = dirtyTouches(prev.state, next.state, touched, holdsSuggestion)
          ? deriveSuggestions(next.state)
          : mapDecorationSet(suggestionSet, mapping, next.state);
      }
      // Group styling: group records live in a side table (a change to them surfaces the
      // root as dirty), runs in the blocks — re-derive when either was touched.
      if (groupStyle !== null) {
        const records = touched === null || touched.has(next.state.rootId);
        groupStyleSet =
          records || dirtyTouches(prev.state, next.state, touched, holdsSuggestion)
            ? deriveGroupStyles(next.state)
            : mapDecorationSet(groupStyleSet, mapping, next.state);
      }
      remerge();
    },
  };
}

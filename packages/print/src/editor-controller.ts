import { inspectDocument, type IncompatibleDocumentReport, createSpan, createPosition, isCollapsed, extractText, builtinEmbedSerializer, selectWord, selectParagraph, getBlock, findItemAtOffset, selectionContextOf, spanStart, spanEnd, markStart, markEnd, recordSample, buildAccessibilityTree, extractFragment, encodeHtml, encodeFragmentClip, TALEWEAVER_CLIP_MIME, type Position, type BlockId, type TextShaper, type TextMeasurer, type Hyphenator, type EditorAction, type EditorState, type State, type TextMatch, type FindMatchesOptions, type Span, type CaretAffinity, isOpenableLinkUrl, makeBlockParentLookup, runKeyBinding, resolveCommand, modConventionFor, escapeWouldChange, type Command, createAnchorSet, mapPositionFrom, type Proposal, type ProposeResult, type ProposalOutcome, proposeResultOf, type SuggestionGroupStyle, subscribeRemoteChanges, getYDoc, UNKNOWN_MAPPING, type Anchor, type AnchorOptions, type Assoc, type MappedPosition, createDecorationLayers, createFindSession, createMappingLog, mapDecorations, transitionMapping, EMPTY_DECORATION_SET, type FindStatus, type Decoration, type DecorationSet, type WidgetDecoration, type CommentHighlight, type SuggestionHighlight } from "@taleweaver/core";
import { resolvePixelPosition, type PixelPosition } from "./cursor/cursor-position";
import { resolvePositionFromPixel } from "./cursor/hit-test";
import { computeSelectionRects, computeSelectionRectsForPage, type SelectionRect } from "./cursor/selection-geometry";
import type { LayoutBox } from "./layout/layout-node";
import type { VirtualLayoutTree } from "./layout/virtual-layout-tree";
import { buildPdfOutline } from "./layout/pdf-outline";
import { makeInternalDestinationResolver } from "./layout/resolve-goto-destination";
import type { PdfEmitter } from "./pdf-export";
import { mapKeyEvent, isNavIntent } from "./key-handler";
import { resolveNavIntent } from "./nav/nav-intent";
import { FONT_CONFIG } from "./font-config";
import { paintCanvas, paintPage, type CursorState } from "./canvas-renderer";
import { blockIdsInBand, computeDecorationRects, CURRENT_COLOR, type DecorationRect } from "./decoration-geometry";

/** A `color` set on the colour probe so a computed `currentcolor` is recognizable. Written
 *  in the serialized computed form (`rgb()` with spaces), so it compares as-is. */
const PROBE_SENTINEL = "rgb(1, 2, 3)";
import { getLineIndex } from "./cursor/line-flatten";
import { createWidgetOverlay, type PlacedWidget } from "./decoration-overlay";
import { createDecorationPointer, type DecorationHit, type PointerProbe, type PrintDecorationPointerEvent } from "./decoration-pointer";
import { createPaintCache, type PaintCache } from "./paint-cache";
import { ImageCache } from "./image-cache";
import { createDomMirrorHost, type DomMirrorHost } from "./dom-mirror-host";
import { createLayoutDriver } from "./layout-driver/layout-driver";

const DEFAULT_PAGE_GAP = 24;
const SCROLL_DURATION = 250;

/**
 * Walk a layout box depth-first and return the first text-run's content
 * `language` (cascaded BCP-47 tag), or `null` when no run carries one. Used by
 * `exportToPdf` to fill the PDF catalog `/Lang` from the document's language —
 * an empty `language` ("" = no language) is skipped so a language-free document
 * emits no `/Lang`.
 */
/** `editorState` is, or was reduced from, a forbidden State (its change chain reaches one; bounded walk). */
function descendsFrom(editorState: EditorState, forbidden: (s: State) => boolean): boolean {
  if (forbidden(editorState.state)) return true;
  for (let c = editorState.lastChange; c !== null; c = c.prior) if (forbidden(c.from)) return true;
  return false;
}

function firstBodyLanguage(box: LayoutBox): string | null {
  if (box.type === "text-run" && box.computedStyle.language !== "") {
    return box.computedStyle.language;
  }
  if ("children" in box) {
    for (const child of box.children) {
      const lang = firstBodyLanguage(child);
      if (lang !== null) return lang;
    }
  }
  if ("columns" in box) {
    for (const column of box.columns) {
      const lang = firstBodyLanguage(column);
      if (lang !== null) return lang;
    }
  }
  return null;
}

// The built-in highlight descriptors are core's (decorations: find / comment /
// suggestion highlights are ordinary decorations drawn through one mechanism).
export type { CommentHighlight, SuggestionHighlight } from "@taleweaver/core";
export type { PrintDecorationPointerEvent } from "./decoration-pointer";

/**
 * Get the link URL at a Position, or null if the position isn't on
 * a hyperlink. Used by Cmd+Click handling.
 */
function linkUrlAtPosition(
  state: import("@taleweaver/core").State,
  pos: Position,
): string | null {
  const block = getBlock(state, pos.blockId);
  if (block === null || block.inlineContent === null) return null;
  const { itemIndex } = findItemAtOffset(block.inlineContent, pos.offset);
  const item = block.inlineContent.items[itemIndex];
  if (item === undefined || item.kind !== "text") return null;
  const link = item.attrs.link;
  return typeof link === "string" && link.length > 0 ? link : null;
}

export interface EditorControllerOptions {
  measurer: TextShaper | TextMeasurer;
  dispatch: (action: EditorAction) => void;
  pageHeight?: number;
  pageGap?: number;
  /**
   * Injected auto-hyphenation capability, passed to the layout-driver as
   * `LayoutConfig.hyphenator`. `undefined` ⇒ no hyphenation.
   */
  hyphenator?: Hyphenator;
  /**
   * When true, mount a hidden, AT-visible accessibility mirror that subsumes the
   * textarea as the focus/IME/clipboard host. Default false — the
   * textarea path is unchanged. Flipping the default ON is gated on the user's in-browser IME/screen-reader smoke.
   */
  accessibilityMirror?: boolean;
  /**
   * Collaboration: `"observe"` (default) — every peer update that lands in the current
   * document's Y.Doc is dispatched to the host as `APPLY_FOREIGN_CHANGE`; `"ignore"` —
   * nothing is. Exactly ONE controller per document should observe; any other
   * controller over the same document passes `"ignore"`. Either way the controller
   * shape-checks every peer update and HALTS on legacy storage (`onIncompatibleDocument`).
   */
  remoteChanges?: "observe" | "ignore";
  /** Initial host decorations (view-only; see {@link EditorController.setDecorations}).
   *  Applied against the first `update()`'s document. */
  decorations?: readonly Decoration[];
  /**
   * Pointer events on painted decorations: `enter` / `leave` as the pointer moves
   * over a decoration's painted fragment (or a widget overlay), `click` on it.
   * Reports the live (edit-mapped) decoration and its on-screen viewport rects.
   * Fires for built-in highlights too (ids prefixed `tw-`).
   */
  onDecorationPointer?: (event: PrintDecorationPointerEvent) => void;
  /**
   * The document is incompatible (`report.reason`: a legacy client wrote into the frozen
   * legacy root — its blocks and current legacy text are surfaced, not merged; a peer
   * raised the schema past this engine's; a second Yjs instance; or a replacement's
   * document is not upgraded yet): the controller HALTS — it ignores every action and
   * further remote change, keeps the last good render on screen, and every member has a
   * defined no-op result without touching the Y.Doc. Called once per halt — and again,
   * while still halted, when a legacy write lands after `onDocumentCompatible` was
   * reported. Do not keep reading the halted State with core read functions. Exit: the
   * host calls `update` with a FRESH EditorState that holds no legacy storage — one built
   * anew (`createEditorStateFromState`) over the same Y.Doc, or one over another
   * document, possibly with edits on top. A State reduced from the halted one (its change
   * chain reaches the halted State) is ignored. While halted, setters and clears of
   * decorations / highlights / styles are no-ops; the replacement drops every layer (the
   * host sets them again).
   */
  onIncompatibleDocument?: (report: IncompatibleDocumentReport) => void;
  /**
   * While HALTED on a NOT-YET-UPGRADED document ("legacy-schema"), it was upgraded (by
   * this host or an upgraded peer — any transaction is re-checked): the host can now
   * resume by calling `update` with a fresh EditorState over the same Y.Doc
   * (`createState({ rootId, doc })`). Called once per halt; the controller stays halted
   * until that `update`. Never for a sticky halt.
   */
  onDocumentCompatible?: () => void;
  /**
   * @internal Start HALTED on `startHaltedOn`'s document (a React view re-created while
   * its editor is halted): nothing is shown and no action runs; the document is watched
   * so `onDocumentCompatible` fires once it is upgraded. `update` resumes as usual.
   */
  startHaltedOn?: EditorState;
}

// The find-bar status ("n of N"; `activeIndex` -1 when no match is active) is
// core's: both backends drive ONE geometry-free find session (`createFindSession`).
export type { FindStatus } from "@taleweaver/core";

/**
 * The viewport-relative pixel geometry of a caret at a `Position`, as returned
 * by `getCaretRect`: `left`/`top` are CSS viewport coordinates (the space of
 * `getBoundingClientRect` / `position: fixed`), `height` is the caret bar
 * height. Hosts use this to overlay UI anchored to a document position —
 * e.g. a collaborator's remote cursor.
 */
export interface CaretViewportRect {
  left: number;
  top: number;
  height: number;
}

export interface EditorController {
  /** True while halted on incompatible (legacy) document storage — see `onIncompatibleDocument`. */
  readonly halted: boolean;
  update(editorState: EditorState): void;
  focus(): void;
  destroy(): void;
  /**
   * Resolve a document `Position` to its caret's viewport-relative pixel rect
   * (CSS `position: fixed` space), or `null` when no document is loaded, the
   * position can't be resolved, or the layout isn't ready. Pure read-only query
   * — no mutation, no repaint. The geometry reflects the LATEST `update()`; call
   * after the controller has rendered the state the position refers to. Used to
   * overlay position-anchored UI (e.g. remote collaborator cursors).
   */
  getCaretRect(position: Position): CaretViewportRect | null;
  /**
   * Run a host command — by name (`config.extensions.commands`) or directly —
   * against the current state with this controller's `dispatch`. Returns whether it
   * ran (false: unknown name, no state yet, or the command declined).
   */
  runCommand(command: string | Command): boolean;
  /** The current document version (an opaque token for `mapPosition` / `createAnchor`); null before the first `update`. */
  readonly version: State | null;
  /**
   * Map `position` from an earlier `version` to the current document: `{ position, deleted }`,
   * or null once that version has aged out of the controller's mapping log.
   */
  mapPosition(position: Position, version: State, assoc?: Assoc): MappedPosition | null;
  /**
   * Anchor a point (`to` omitted) or range that follows every later edit (local, undo /
   * redo, collaborative). `basedOn`: the version the positions refer to (default: the
   * current one); null when that version can no longer be mapped, the content is gone,
   * or before the first `update`.
   */
  createAnchor(from: Position, to?: Position, options?: AnchorOptions & { readonly basedOn?: State }): Anchor | null;
  /**
   * Offer `proposal` as ONE suggestion group, dispatched to the host as `PROPOSE` (any
   * editing mode; the caret is only rebased). `basedOn`: the version its positions refer
   * to (default: the version this controller shows); the host's reducer maps it through
   * the edits made since and validates it. Resolves with that TRUE verdict once an `update`
   * carrying it arrives (`EditorState.lastProposal`); "stale" when the document is
   * replaced before the host applies it; rejected ("controller destroyed") when the
   * controller is destroyed first, and at once before the first `update` ("no document
   * yet") or after `destroy`.
   */
  propose(proposal: Proposal, options?: { readonly basedOn?: State }): Promise<ProposeResult>;
  /**
   * Host per-group styling of suggestions (e.g. per `metadata.source`), kept live through
   * proposals, accept / reject and undo. `null` clears it.
   */
  setSuggestionStyles(styleOf: SuggestionGroupStyle | null): void;
  /** Compose the live document into a PDF byte stream (pages + outline bookmarks
   *  + internal /GoTo + external /URI links). Pure query — no mutation. `print`
   *  never imports `@taleweaver/pdf`, so the host injects the pdf emitter (e.g.
   *  `createPdfEmitter({ fontProvider })` from `@taleweaver/pdf`). Std-14 fonts /
   *  grey image placeholders unless the injected emitter supplies font/image
   *  providers. Throws when no document is loaded, or for the non-paginated
   *  (float/clear) layout fallback. */
  exportToPdf(emit: PdfEmitter): Uint8Array;
  /** The host decoration layer, mapped through every edit since it was set. */
  readonly decorations: DecorationSet;
  /**
   * Replace the host decorations. They are computed against the
   * CURRENT document and stay attached through later edits (position-mapped)
   * until replaced; a decoration whose range is deleted disappears. Inline
   * decorations paint `style.backgroundColor` bands and `style.underline`
   * strokes; block decorations paint a background in the block box's background
   * slot (under its borders, image and children); widget
   * decorations render as DOM overlays at their anchor's caret rect. Only the
   * pages whose painted decorations change are repainted.
   *
   * `basedOn` is the document `State` the decorations were computed against
   * (default: the current one). A host that computes asynchronously passes it so
   * its result is mapped through the edits made meanwhile (the controller's
   * mapping log); if that State is unknown or too old to map, the decorations are
   * dropped rather than drawn on the wrong text.
   */
  setDecorations(decorations: readonly Decoration[], basedOn?: State): void;
  /**
   * Show the find-match highlights: `matches` as translucent yellow
   * decorations (`tw-find:*`), the match at `activeIndex` emphasized in orange.
   * `activeIndex` out of range → no match emphasized. There is ONE find layer:
   * this writes it directly (mapped through edits until replaced); `findStart`
   * takes it over, the open session's refresh owns it, `findClose` clears it.
   * Not a session — `findStatus` / next / prev / replace ignore it. Repaints.
   */
  setFindHighlights(matches: readonly TextMatch[], activeIndex: number): void;
  /** Clear the (one) find layer and repaint (erases the band). */
  clearFindHighlights(): void;
  /**
   * Show the comment highlights: each given comment's anchored
   * range as a translucent amber decoration (`tw-comment:*`), `active` ones in a
   * deeper amber. Ranges are mapped through edits and re-scanned from the
   * document only when an edit adds or removes a comment marker, so the host
   * re-calls only when the SET or active-flag changes. Orphaned comments
   * emit nothing. Triggers a repaint.
   */
  setCommentHighlights(highlights: readonly CommentHighlight[]): void;
  /** Hide the comment highlights and repaint (erases the band). */
  clearCommentHighlights(): void;
  /**
   * Show the suggestion highlights: each pending
   * tracked-change's range as a translucent teal decoration (`tw-suggestion:*`),
   * `active` ones deeper. Mapped through edits; re-scanned when an edit touches
   * a tracked run. A
   * suggestion whose tagged content is gone emits nothing. Triggers a repaint.
   */
  setSuggestionHighlights(highlights: readonly SuggestionHighlight[]): void;
  /** Hide the suggestion highlights and repaint (erases the band). */
  clearSuggestionHighlights(): void;
  /**
   * Start a find session: run `findMatches(state, query, options)`,
   * highlight every match, pick the initial active match (the first at/after the
   * document cursor — Google Docs "find from here"), and scroll it into view.
   * Stores the session so a doc edit live-recomputes the matches (in `update()`).
   * Calling it again overwrites the session and re-queries. `options` defaults to
   * `{ caseSensitive: false, wholeWord: false }`. Returns the find status.
   */
  findStart(query: string, options?: FindMatchesOptions): FindStatus;
  /**
   * The current find status — `{ total, activeIndex }` for the active session
   * (`total 0` / `activeIndex -1` when there's no session or no matches). The
   * find bar polls this each render for the authoritative "n of N" count, since
   * `replaceActive`/`replaceAll` dispatch asynchronously (the post-replace count
   * only lands after the React reducer feeds the new state back via `update()`).
   */
  findStatus(): FindStatus;
  /**
   * Replace the ACTIVE find match with `replacement`. When a session is
   * active and there's an active match, dispatches `REPLACE_MATCH` with that
   * match (the core session's active match). Does NOT manually advance the
   * active index — the session's refresh in the following `update()` moves it to
   * the first match after the replacement text (wrapping). Returns the CURRENT
   * (pre-refresh) status; the find bar polls `findStatus()` after the update for
   * the authoritative count. No-op (returns the current status, no dispatch) when
   * there's no session / no active match.
   */
  replaceActive(replacement: string): FindStatus;
  /**
   * Replace EVERY match in the active session with `replacement` in one
   * undo step — dispatches `REPLACE_ALL` with the session's matches
   * (the core session's matches). Returns the current (pre-refresh) status. No-op
   * (no dispatch) when there's no session / no matches.
   */
  replaceAll(replacement: string): FindStatus;
  /**
   * Advance to the next match (wrapping last → first), re-emphasize, and scroll
   * it into view. No-op (returns the current status, no scroll) when there are no
   * matches. Does NOT move the document cursor.
   */
  findNext(): FindStatus;
  /**
   * Retreat to the previous match (wrapping first → last), re-emphasize, and
   * scroll it into view. No-op when there are no matches. Does NOT move the
   * document cursor.
   */
  findPrev(): FindStatus;
  /**
   * End the find session and clear the (one) find layer — including anything a
   * `setFindHighlights` call put there. Does NOT move the document selection
   * (Google Docs keeps the caret where it was).
   */
  findClose(): void;
}

export function createEditorController(
  container: HTMLElement,
  options: EditorControllerOptions,
): EditorController {
  const { measurer } = options;
  // HALTED (a peer update carried legacy inline storage): controller-local runtime
  // state — the reducer knows nothing of it. Every action and remote change is ignored.
  let halted = options.startHaltedOn !== undefined;
  const dispatch = (action: EditorAction): void => {
    if (!halted) options.dispatch(action);
  };
  // Anchors follow every transition `update` sees (the same mapping the decorations use).
  const anchors = createAnchorSet();
  // A peer's change landing in the current document's Y.Doc is DISPATCHED to the host
  // as APPLY_FOREIGN_CHANGE (the host owns the state; its reducer rebases the selection
  // and the next `update` advances decorations / anchors / mapping log as usual).
  let remoteDoc: unknown = null;
  let unsubscribeRemote: (() => void) | null = null;
  // Host keymap `Mod` = Cmd on Mac, Ctrl elsewhere (the same rule as the digital backend).
  const modConvention = modConventionFor(typeof navigator === "undefined" ? "" : navigator.userAgent);
  // The registries, page setup and host extensions are the host's `EditorState.config` —
  // the same config its reducer runs with — read from the latest state at each use.
  const driver = createLayoutDriver({ measurer: options.measurer, hyphenator: options.hyphenator });
  const pageHeight = options.pageHeight;
  const pageGap = options.pageGap ?? DEFAULT_PAGE_GAP;
  // Accessibility mirror: when ON, a hidden AT-visible DOM mirror
  // SUBSUMES the textarea as the focus/IME/clipboard host. Default OFF — the
  // textarea path is byte-identical to today. Assigned inside the gated
  // construction below; null whenever the flag is off.
  const mirrorEnabled = options.accessibilityMirror === true;
  let mirrorHost: DomMirrorHost | null = null;

  // ── State ──────────────────────────────────────────────────────────────

  let state: EditorState | null = null;
  // The current layout tree, built by the backend layout-driver from
  // `state.state` + `state.lastDirtyIds` in `update()`. In paginated mode
  // it is a `VirtualLayoutTree` (a `PagePlan` + lazily-materialized pages); in
  // unpaginated / unsupported-feature-fallback mode it is a fully-positioned
  // `LayoutBox`. The HOT PATH (paint visible pages, slot sizing, caret) reads
  // the plan + `getPage(visible ∪ cursorPage)` directly and never materializes
  // every page.
  let layoutTree: LayoutBox | VirtualLayoutTree | null = null;
  /** The layout tree the page slots / single canvas were last synced to. */
  let syncedTree: LayoutBox | VirtualLayoutTree | null = null;
  // The positioned `LayoutBox` for the NON-paginated paths only (single-canvas
  // paint/sizing + the `pageIndex === null` selection/find/comment branches).
  // In those branches `layoutTree` is already a fully-positioned `LayoutBox`
  // (non-paginated / float-clear legacy fallback), never a `VirtualLayoutTree`
  // (virtualization only happens in paginated mode). Returns null defensively
  // if ever called in paginated mode — those callers union per-page instead and
  // never reach here. The whole document is NEVER materialized.
  function nonPaginatedTree(): LayoutBox | null {
    if (layoutTree === null || layoutTree.type === "virtual-root") return null;
    return layoutTree;
  }
  // Hit-test against ONLY the clicked page (virtual) — never the whole tree.
  // `resolvePositionFromPixel` filters its line index by `pageIndex`, so a
  // single `PageBox` resolves correctly (mirrors the per-page line-nav
  // migration). Non-paginated mode has a positioned `LayoutBox` already.
  function treeForPageHitTest(pageIndex: number): LayoutBox | null {
    if (layoutTree === null) return null;
    if (layoutTree.type === "virtual-root") return layoutTree.getPage(pageIndex);
    return layoutTree;
  }
  // True when `blockId` straddles a page break. Per-page selection rects can't
  // see a block's fragment on the other page (and `resolvePixelPosition` snaps a
  // boundary at a page edge to the continuation page), so a selection whose
  // start/end block spans pages falls back to the full bridge for that render.
  function blockSpansPages(plan: VirtualLayoutTree["plan"], blockId: BlockId): boolean {
    const s = plan.pageSpanOfBlock(blockId);
    return s !== null && s.first !== s.last;
  }
  // Spanning-block selection rects WITHOUT materializing the whole tree: resolve the
  // span's start/end pixel positions once against the virtual tree, then union
  // computeSelectionRectsForPage over the pages the span covers. Equivalent to
  // computeSelectionRects over the materialized tree for a spanning boundary
  // block (computeSelectionRectsForPage self-culls pages outside the range), but
  // materializes only the spanned pages instead of every page.
  function selectionRectsAcrossPages(
    st: State,
    span: Span,
    tree: VirtualLayoutTree,
    m: TextShaper | TextMeasurer,
    anchorAffinity?: CaretAffinity,
    focusAffinity?: CaretAffinity,
  ): SelectionRect[] {
    const start = spanStart(st, span);
    const end = spanEnd(st, span);
    const startPos = resolvePixelPosition(st, start, tree, m);
    const endPos = resolvePixelPosition(st, end, tree, m);
    if (startPos === null || endPos === null) return [];
    const rects: SelectionRect[] = [];
    // `startPos`/`endPos` were resolved against `tree`, so every index in
    // [startPos.pageIndex, endPos.pageIndex] is a valid page (getPage throws
    // only on out-of-range). computeSelectionRectsForPage self-culls, so this
    // union equals computeSelectionRects over the fully-materialized tree.
    for (let p = startPos.pageIndex; p <= endPos.pageIndex; p++) {
      rects.push(
        ...computeSelectionRectsForPage(
          st, span, tree.getPage(p), p, startPos, endPos, m, anchorAffinity, focusAffinity,
        ),
      );
    }
    return rects;
  }
  let focused = true;
  let cursorVisible = true;
  let blinkIntervalId: ReturnType<typeof setInterval> | null = null;
  let scrollRafId = 0;
  let scrollAnimId = 0;
  let isDragging = false;
  let dragAnchor: Position | null = null;
  // TOC click-to-navigate (live `table-of-contents` entry lines). A plain
  // single click on an entry line navigates the caret to its heading; a DRAG
  // past a small epsilon abandons nav and text-selects instead (Google Docs).
  // The entry boxes are SYNTHESIZED (not state-backed), so they carry the target
  // on `metadata.navTarget` and are detected by `pickTocEntryAt` (a page-box
  // walk), NOT by `resolvePositionFromPixel`. `pendingTocNav` holds the deferred
  // target between mousedown and mouseup; the down-point seeds the drag-abandon
  // epsilon check.
  let pendingTocNav: BlockId | null = null;
  let tocNavDownX = 0;
  let tocNavDownY = 0;
  let isComposing = false;
  let destroyed = false;
  // Proposals dispatched to the host, awaiting the reducer's verdict on a later update
  // (dispatch order). `seenProposal`: the newest verdict already settled.
  let pendingProposals: Array<{ readonly proposal: Proposal; readonly resolve: (result: ProposeResult) => void }> = [];
  let seenProposal: ProposalOutcome | undefined;
  const rejectedProposal = (message: string): ProposeResult => ({ ok: false, reason: "rejected", problem: { kind: "invalid", message } });
  const HALTED_RESULT: ProposeResult = { ok: false, reason: "halted" };
  const EMPTY_FIND: FindStatus = { total: 0, activeIndex: -1 };

  /** `onDocumentCompatible` was reported since the last `onIncompatibleDocument`. */
  let toldCompatible = false;
  /** Replacement States refused while halted (legacy storage): their descendants never resume. */
  let refusedStates = new WeakSet<State>();

  /**
   * Halt on legacy storage in a peer update (see `onIncompatibleDocument`). Once per
   * halt — again while still halted only if the host was told "compatible" since.
   */
  function halt(report: IncompatibleDocumentReport): void {
    if (destroyed) return;
    if (halted) {
      if (!toldCompatible) return;
      toldCompatible = false;
      options.onIncompatibleDocument?.(report);
      return;
    }
    halted = true;
    // Abandon an in-flight IME composition: its text would land on a halted editor.
    // The composed text is dropped and the composed block shows its last good
    // projection again (the canvas never drew it; the a11y mirror is restored).
    if (isComposing) {
      isComposing = false;
      textarea.value = "";
      textarea.blur();
      mirrorHost?.abandonComposition();
    }
    for (const p of pendingProposals) p.resolve(HALTED_RESULT);
    pendingProposals = [];
    options.onIncompatibleDocument?.(report);
  }

  /**
   * Watch `editorState`'s Y.Doc: peer changes are dispatched (unless `remoteChanges`
   * is `"ignore"`), and EVERY controller shape-checks them — legacy storage halts it;
   * while halted, a document that became compatible again fires `onDocumentCompatible`.
   */
  function watchDocument(editorState: EditorState, startHalted: boolean): void {
    unsubscribeRemote?.();
    remoteDoc = getYDoc(editorState.state);
    unsubscribeRemote = subscribeRemoteChanges(
      editorState.state,
      (dirtyIds) => {
        if (options.remoteChanges !== "ignore") dispatch({ type: "APPLY_FOREIGN_CHANGE", dirtyIds });
      },
      halt,
      () => {
        if (!halted || destroyed) return;
        toldCompatible = true;
        options.onDocumentCompatible?.();
      },
      { startHalted },
    );
  }

  /**
   * Settle the pending proposals whose verdicts arrived in `latest`'s chain (matched by
   * the dispatched object, oldest first). Dispatches apply in order, so a pending proposal
   * dispatched BEFORE a settled one with no verdict in the chain was never applied by the
   * host ("proposal was not applied by the host") — or, when the chain was cut (more than
   * MAX_PROPOSAL_CHAIN proposals between two updates), its verdict aged out. After a
   * document replacement (`replaced`) the rest can no longer land on the document they
   * were computed for: stale. A host that never updates again leaves the rest pending
   * until the next update / replacement / destroy.
   */
  function settleProposals(latest: ProposalOutcome | undefined, replaced: boolean): void {
    const fresh: ProposalOutcome[] = [];
    // Walk back to the last verdict already seen — by its dispatch number, which copies of
    // a trimmed chain keep (object identity does not survive a trim). A gap between the
    // oldest verdict walked and the one seen means the chain was cut.
    const seenSeq = seenProposal?.seq ?? 0;
    for (let o = latest; o !== undefined && o.seq > seenSeq; o = o.prior) fresh.push(o);
    const oldest = fresh.at(-1);
    const cut = oldest !== undefined && oldest.seq > seenSeq + 1;
    seenProposal = latest;
    if (pendingProposals.length === 0) return;
    const settled = new Set<number>();
    let lastSettled = -1;
    for (let k = fresh.length - 1; k >= 0; k--) {
      const outcome = fresh[k];
      const i = pendingProposals.findIndex((p, j) => !settled.has(j) && p.proposal === outcome?.proposal);
      const entry = pendingProposals[i];
      if (outcome === undefined || entry === undefined) continue;
      settled.add(i);
      lastSettled = Math.max(lastSettled, i);
      entry.resolve(proposeResultOf(outcome));
    }
    pendingProposals.forEach((p, j) => {
      if (settled.has(j)) return;
      if (j < lastSettled) p.resolve(rejectedProposal(cut ? "verdict aged out" : "proposal was not applied by the host"));
      else if (replaced) p.resolve({ ok: false, reason: "stale" });
      else return;
      settled.add(j);
    });
    pendingProposals = pendingProposals.filter((_p, j) => !settled.has(j));
  }

  // Image cache for rendering image blocks
  const imageCache = new ImageCache(() => paint());

  // Paint caches: one for the single-canvas mode, one per page index for
  // paginated mode. These make paint take the
  // incremental path with root-reference short-circuit. Without these,
  // every paint pass clears the entire canvas and repaints every box —
  // O(N) per cursor move. Pruned on page removal in the excess-slot loop
  // (see `pageCaches.delete(i)` there) so the map never outgrows the live
  // page count.
  const canvasCache: PaintCache = createPaintCache();
  const pageCaches: Map<number, PaintCache> = new Map();
  function getOrCreatePageCache(idx: number): PaintCache {
    let c = pageCaches.get(idx);
    if (!c) {
      c = createPaintCache();
      pageCaches.set(idx, c);
    }
    return c;
  }

  // Computed on update
  let cursorPos: PixelPosition = {
    x: 0,
    y: 0,
    height: 16,
    lineY: 0,
    lineHeight: 24,
    lineMarginTop: 0,
    lineMarginBottom: 0,
    pageIndex: 0,
  };
  let selectionRects: SelectionRect[] = [];
  // Selection-highlight state (set in `update()`, consumed in `paintPages` and
  // `getCursorState`). Paginated mode computes rects PER VISIBLE PAGE in
  // `paintPages` from the cached span boundary positions — `selectionRects`
  // above is then empty (it carries rects only for the non-paginated path and
  // the rare spanning-block fallback). `hasSelectionHighlight` lets the caret
  // hide over a selection even when `selectionRects` is empty.
  let hasSelectionHighlight = false;
  let selStart: PixelPosition | null = null;
  let selEnd: PixelPosition | null = null;
  let selSpanningFallback = false;

  // ── Find session ──────────────────────────────────────────────────
  //
  // Core's geometry-free find session (shared with the digital backend) owns the
  // query, the match list and navigation; this controller draws it as the find
  // decoration layer and scrolls the active match into view. `setFindHighlights`
  // stays a display-only primitive (no session): its decorations are mapped
  // through edits by the find layer itself.
  const find = createFindSession();
  /** Push the session's matches into the find layer and repaint. */
  function showFind(scroll: boolean): FindStatus {
    if (state !== null) layers.setFind(state.state, find.matches(), find.activeIndex());
    redrawDecorations();
    if (scroll) scrollActiveMatchIntoView();
    return find.status();
  }

  // ── Decoration layers ────────────────────────────────────────────────────
  //
  // ONE mechanism for every painted decoration: suggestion / comment / find
  // highlights and host decorations are layers of core's `DecorationLayers`,
  // carried through every state transition in `update()` (`layers.advance`).
  // Calls made before the first `update()` (no document yet) are queued and
  // replayed against the first state; `pendingHost` lets the `decorations` getter
  // report a queued host set meanwhile.
  let layers = createDecorationLayers();
  // Recent transitions + their mappings, so decorations a host computed against an
  // older State (`setDecorations(d, basedOn)`) can be mapped onto the current one.
  const mappingLog = createMappingLog();
  let pendingLayerOps: ((s: State) => void)[] = [];
  let pendingHost: readonly Decoration[] | null = null;
  if (options.decorations !== undefined) {
    const initial = options.decorations;
    pendingHost = initial;
    pendingLayerOps.push((s) => layers.setHost(s, initial));
  }
  /** A layer setter: a no-op while halted (deriving reads the doc), queued before the first document. */
  function withLayers(op: (s: State) => void): void {
    if (halted) return;
    if (state === null) pendingLayerOps.push(op);
    else op(state.state);
  }
  // Per-paint-target decoration geometry, resolved LAZILY (only for a page being
  // painted / hit) and cached by (layout tree, merged set, page box, document[,
  // band]) — blink repaints and unaffected pages never re-resolve. Key: page index
  // (paginated) or -1 (single canvas). Cleared on every `update()` (so it never
  // pins an old tree / State) and when a page's canvas is released.
  const decoRectCache = new Map<
    number,
    {
      tree: LayoutBox | VirtualLayoutTree;
      set: DecorationSet;
      root: LayoutBox;
      doc: State;
      band: { top: number; bottom: number } | null;
      rects: readonly DecorationRect[];
    }
  >();
  const NO_DECORATION_RECTS: readonly DecorationRect[] = Object.freeze([]);

  // ── Page model (paginated mode) ──────────────────────────────────────────
  //
  // Per-page SLOT geometry, derived without positioning any page:
  //   - virtual tree → `vtree.plan.entries` (per-entry `pageConfig` +
  //     running-sum `blockOffset`);
  //   - positioned tree → the positioned `PageBox` children's geometry.
  // `pageSlots`'s length is the page count; an empty array means non-paginated
  // (single-canvas mode).
  //
  // Pages are NOT uniform-height: a `section` can override its page
  // geometry, so every consumer (slot sizing, caret/textarea Y, scroll, mouse
  // hit-test) reads PER-SLOT geometry from this array — there is no
  // `pageIndex * (pageHeight + pageGap)` arithmetic and no virtual-vs-positioned
  // branching at the call sites. `top` is the page's document-y (the plan's
  // running-sum `blockOffset`); `gap` is the visual gap AFTER this page. For a
  // doc whose every page resolves to the doc-wide config this reduces to the old
  // uniform behavior (`top === i*(H+gap)`, `gap === pageGap`, `width === H-wide`).
  interface PageSlotGeom {
    readonly width: number;
    readonly height: number;
    /** Visual gap AFTER this page (per-section in virtual mode). */
    readonly gap: number;
    /** Document-y of this page's top edge (the plan's running-sum offset). */
    readonly top: number;
  }
  let pageSlotGeoms: PageSlotGeom[] = [];
  // Positioned-mode only: the materialized `PageBox` children (the legacy
  // path). Empty in virtual mode — pages are fetched on demand via `getPageBox`.
  let positionedPages: LayoutBox[] = [];
  // The current paginated layout tree (the virtual tree, or null when the
  // positioned path / non-paginated). Set in `syncDom`.
  let virtualTree: VirtualLayoutTree | null = null;

  /** Number of paginated page slots; 0 ⇒ non-paginated (single-canvas mode). */
  function pageCount(): number {
    return pageSlotGeoms.length;
  }

  /**
   * The positioned `PageBox` for slot `idx`. In virtual mode this calls
   * `vtree.getPage(idx)` — positioning ONLY that page (memoized). In positioned
   * mode it returns the pre-materialized child. Returns null out of range.
   */
  function getPageBox(idx: number): LayoutBox | null {
    if (virtualTree !== null) {
      if (idx < 0 || idx >= virtualTree.plan.entries.length) return null;
      // Pages are built from the already-rendered styled tree (no document read), so a
      // halted controller pages its last good render.
      return virtualTree.getPage(idx);
    }
    return positionedPages[idx] ?? null;
  }

  // ── DOM elements ───────────────────────────────────────────────────────

  // Set container styles
  container.style.position = "relative";
  container.style.outline = "none";
  container.style.fontFamily = FONT_CONFIG.fontFamily;
  container.style.fontSize = `${FONT_CONFIG.fontSize}px`;
  container.style.lineHeight = `${FONT_CONFIG.lineHeight * FONT_CONFIG.fontSize}px`; // 1.2 * 16 = 19.2px
  container.style.cursor = "text";
  container.style.userSelect = "none";

  // Create textarea
  const textarea = document.createElement("textarea");
  textarea.style.position = "absolute";
  textarea.style.width = "1px";
  textarea.style.opacity = "0";
  textarea.style.border = "none";
  textarea.style.padding = "0";
  textarea.style.margin = "0";
  textarea.style.outline = "none";
  textarea.style.resize = "none";
  textarea.style.overflow = "hidden";
  textarea.style.caretColor = "transparent";
  textarea.style.fontSize = `${FONT_CONFIG.fontSize}px`;
  textarea.style.fontFamily = FONT_CONFIG.fontFamily;
  // On the mirror path the DomMirrorHost is the SOLE focus/tab host; take the
  // textarea out of the tab order (tabIndex -1) so a Tab key can never land on it
  // and route input to a non-AT element — making the "textarea never receives
  // focus" invariant the mirror integration relies on actually hold.
  textarea.tabIndex = mirrorEnabled ? -1 : 0;
  container.appendChild(textarea);
  // Widget decorations render as DOM overlays above the canvases.
  const widgetOverlay = createWidgetOverlay(container);
  // The textarea owns focus only on the flag-off path. On the mirror path the
  // DomMirrorHost is the focus owner (it calls `.focus()` after construction).
  if (!mirrorEnabled) {
    textarea.focus();
  }

  // Spacer div (non-paginated only, created lazily)
  let spacerDiv: HTMLDivElement | null = null;

  // Single canvas (non-paginated)
  let singleCanvas: HTMLCanvasElement | null = null;
  let singleCtx: CanvasRenderingContext2D | null = null;

  // Paginated: slot divs + canvas pool
  let pageSlots: HTMLDivElement[] = [];
  const activeCanvases = new Map<number, HTMLCanvasElement>();
  const canvasPool: HTMLCanvasElement[] = [];
  let intersectionObserver: IntersectionObserver | null = null;

  // ── Scroll parent ──────────────────────────────────────────────────────

  let scrollParent: HTMLElement | Window = window;

  function detectScrollParent() {
    let el: HTMLElement | null = container.parentElement;
    while (el) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        scrollParent = el;
        return;
      }
      el = el.parentElement;
    }
    scrollParent = window;
  }

  // ── Paint ──────────────────────────────────────────────────────────────

  // ── Decoration geometry ──────────────────────────────────────────────────
  //
  // Resolve the merged decoration set into paint fragments for ONE paint target
  // (a page box, or the single-canvas tree). A page visits only the blocks with
  // boxes/lines on it; the single canvas only decorated blocks inside the visible
  // band (`computeDecorationRects`). So typing in a long document with many
  // decorations costs O(decorations on the visible pages), never O(document).

  // Decoration colours are host CSS strings (`var(--x)`, named colours, …). A
  // canvas silently IGNORES an invalid `fillStyle` (keeping the previous one), so
  // every colour is resolved first (`resolveColor`) and an invalid one is
  // skipped. Memoized per string; the memo is cleared on every decoration /
  // highlight change (not per keystroke), so a theme switch applies on the next.
  const colorProbe = document.createElement("span");
  colorProbe.style.display = "none";
  colorProbe.setAttribute("aria-hidden", "true");
  container.appendChild(colorProbe);
  const colorCache = new Map<string, string | null>();
  /** Custom property `name` as the probe sees it (walks ancestors for engines
   *  that do not inherit custom properties into computed style, e.g. jsdom). */
  function customProperty(name: string): string {
    for (let el: Element | null = colorProbe; el !== null; el = el.parentElement) {
      const v = getComputedStyle(el).getPropertyValue(name).trim();
      if (v !== "") return v;
    }
    return "";
  }
  /** Manual `var()` substitution (innermost first, balanced parentheses, nested
   *  fallbacks) — only for engines whose computed style leaves `var()` unresolved. */
  function substituteVars(css: string): string {
    let value = css;
    for (let i = 0; i < 16; i++) {
      const at = value.lastIndexOf("var(");
      if (at === -1) break;
      let depth = 0;
      let end = -1;
      let comma = -1;
      for (let j = at + 3; j < value.length; j++) {
        const ch = value[j];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        } else if (ch === "," && depth === 1 && comma === -1) comma = j;
      }
      if (end === -1) return ""; // unbalanced → invalid
      const name = value.slice(at + 4, comma === -1 ? end : comma).trim();
      const fallback = comma === -1 ? "" : value.slice(comma + 1, end).trim();
      const v = customProperty(name);
      value = value.slice(0, at) + (v !== "" ? v : fallback) + value.slice(end + 1);
    }
    return value;
  }
  /**
   * A host colour → what to hand the canvas: the string itself when it is a
   * valid colour; for `var()` the cascade-resolved colour (native computed style,
   * nested fallbacks included; manual substitution where the engine leaves it
   * unresolved); `CURRENT_COLOR` for `currentColor` (the painter substitutes the
   * decorated run's / box's text colour); `null` for anything invalid, including
   * the CSS-wide keywords (`inherit` / `initial` / `unset` / `revert[-layer]`),
   * which have no meaning for a decoration.
   */
  function resolveColor(css: string, property: "background-color" | "text-decoration-color"): string | null {
    const key = `${property}\u0000${css}`;
    const hit = colorCache.get(key);
    if (hit !== undefined) return hit;
    const resolve = (value: string): string | null => {
      const v = value.trim();
      const lower = v.toLowerCase();
      if (["inherit", "initial", "unset", "revert", "revert-layer"].includes(lower)) return null;
      if (lower === "currentcolor") return CURRENT_COLOR;
      colorProbe.style.removeProperty(property);
      colorProbe.style.setProperty(property, v);
      if (colorProbe.style.getPropertyValue(property) === "") return null; // unparseable
      if (!v.includes("var(")) return v; // canvases parse CSS colours as written
      // Resolve through the SAME property digital applies, so an unset variable falls back
      // the same way: a background to transparent (→ nothing drawn), an underline colour to
      // currentcolor (→ the run's text colour). A sentinel `color` tells currentcolor apart.
      colorProbe.style.setProperty("color", PROBE_SENTINEL);
      const computed = getComputedStyle(colorProbe).getPropertyValue(property);
      colorProbe.style.removeProperty("color");
      if (computed !== "" && !computed.includes("var(")) {
        if (computed === PROBE_SENTINEL) return CURRENT_COLOR;
        if (computed === "transparent" || computed === "rgba(0, 0, 0, 0)") return null;
        return computed;
      }
      const substituted = substituteVars(v); // engines that leave var() unresolved (jsdom)
      return substituted === "" || substituted.includes("var(") ? null : resolve(substituted);
    };
    const out = resolve(css);
    colorCache.set(key, out);
    return out;
  }
  function withResolvedColors(r: DecorationRect): DecorationRect | null {
    let bg: string | undefined;
    if (r.backgroundColor !== undefined) {
      bg = resolveColor(r.backgroundColor, "background-color") ?? undefined;
    }
    let underline = r.underline;
    if (underline?.color !== undefined) {
      const c = resolveColor(underline.color, "text-decoration-color");
      if (c === null) underline = undefined;
      else if (c === CURRENT_COLOR) {
        const { color: _c, ...rest } = underline;
        underline = rest; // colourless ⇒ the run's text colour
      } else underline = { ...underline, color: c };
    }
    if (bg === undefined && underline === undefined) return null;
    const { backgroundColor: _bg, underline: _u, ...geom } = r;
    return { ...geom, ...(bg !== undefined ? { backgroundColor: bg } : {}), ...(underline !== undefined ? { underline } : {}) };
  }

  /** The single canvas's resolve band: the viewport plus one viewport each side. */
  function singleBand(): { top: number; bottom: number } {
    const { top, bottom } = singleViewport();
    const h = bottom - top;
    return { top: top - h, bottom: bottom + h };
  }

  function decorationRectsFor(root: LayoutBox, pageIndex: number | null, cache = true): readonly DecorationRect[] {
    const st = state;
    const tree = layoutTree;
    const set = layers.merged;
    if (st === null || tree === null || set === EMPTY_DECORATION_SET) return NO_DECORATION_RECTS;
    const key = pageIndex ?? -1;
    const hit = decoRectCache.get(key);
    if (hit !== undefined && hit.tree === tree && hit.set === set && hit.root === root && hit.doc === st.state) {
      if (hit.band === null) return hit.rects;
      const v = singleViewport();
      if (v.top >= hit.band.top && v.bottom <= hit.band.bottom) return hit.rects;
    }
    const band = pageIndex === null ? singleBand() : null;
    const tDeco = markStart("ctrl.decorationRects");
    const raw = computeDecorationRects({
      state: st.state,
      decorations: set,
      root,
      pageIndex,
      measurer,
      ...(band !== null ? { band } : {}),
      pageSpanOf: (id) => (tree.type === "virtual-root" ? tree.plan.pageSpanOfBlock(id) : null),
      // The page index doubles as the caret page hint, so a decoration inside a
      // header/footer body resolves on THIS page's slot instance.
      resolve: (pos) => resolvePixelPosition(st.state, pos, tree, measurer, pageIndex ?? undefined),
    });
    const rects: DecorationRect[] = [];
    for (const r of raw) {
      const c = withResolvedColors(r);
      if (c !== null) rects.push(c);
    }
    markEnd("ctrl.decorationRects", tDeco);
    if (cache) decoRectCache.set(key, { tree, set, root, doc: st.state, band, rects });
    return rects;
  }

  /** Viewport (CSS `position: fixed`) rect of a fragment on `pageIndex`. */
  function toViewportRect(r: { x: number; y: number; width: number; height: number }, pageIndex: number | null): DOMRect {
    const c = container.getBoundingClientRect();
    const slot = pageIndex === null ? undefined : pageSlotGeoms[pageIndex];
    return new DOMRect(c.left + r.x, c.top + (slot !== undefined ? slot.top : 0) + r.y, r.width, r.height);
  }

  /** The paint target for page `idx` (`null` = the single-canvas tree). */
  function paintRootFor(idx: number | null): LayoutBox | null {
    return idx === null ? nonPaginatedTree() : getPageBox(idx);
  }

  /** Visible page indices (pages with a live canvas), ascending. */
  function visiblePages(): number[] {
    return [...activeCanvases.keys()].sort((x, y) => x - y);
  }

  /** The page indices a decoration can paint on (`[null]` in single-canvas mode). */
  function pagesOfDecoration(d: Decoration): (number | null)[] {
    const st = state;
    const tree = layoutTree;
    if (st === null || tree === null) return [];
    if (pageCount() === 0) return [null];
    const blockId = d.kind === "block" ? d.blockId : d.kind === "inline" ? d.from.blockId : d.at.blockId;
    if (tree.type !== "virtual-root") return visiblePages();
    // A block outside the main page plan (header/footer/footnote body) paints on
    // every page that shows it: report the instances currently on screen.
    const span = tree.plan.pageSpanOfBlock(blockId);
    if (span === null) return visiblePages();
    let first = span.first;
    let last = span.last;
    if (d.kind === "inline" && d.to.blockId !== d.from.blockId) {
      const end = tree.plan.pageSpanOfBlock(d.to.blockId);
      if (end !== null) last = Math.max(last, end.last);
      first = Math.min(first, end?.first ?? first);
    }
    const out: number[] = [];
    for (let p = first; p <= last && p < pageCount(); p++) out.push(p);
    return out;
  }

  /** Viewport rects of every painted fragment of `d` (on-screen pages / band). */
  function decorationViewportRects(d: Decoration): DOMRect[] {
    if (d.kind === "widget") return widgetOverlay.elements(d.id).map((el) => el.getBoundingClientRect());
    const out: DOMRect[] = [];
    for (const p of pagesOfDecoration(d)) {
      const root = paintRootFor(p);
      if (root === null) continue;
      // Off-screen pages are resolved for this query only, never cached.
      const cacheIt = p === null || activeCanvases.has(p);
      for (const r of decorationRectsFor(root, p, cacheIt)) if (r.decoration.id === d.id) out.push(toViewportRect(r, p));
    }
    return out;
  }

  /** Decorations painted under the pointer: id → the decoration + fragment hit. */
  function decorationsUnderPointer(probe: PointerProbe): Map<string, DecorationHit> {
    const out = new Map<string, DecorationHit>();
    if (destroyed || state === null || layoutTree === null) return out;
    const target = probe.target;
    if (target instanceof Node && !target.isConnected) return out;
    const widget = widgetOverlay.widgetAt(target);
    if (widget !== null) {
      out.set(widget.widget.id, { decoration: widget.widget, rect: widget.el.getBoundingClientRect() });
      return out;
    }
    // Only a pointer over a painted surface (a page canvas / slot, or the single
    // canvas) can be over a decoration — never the gaps between pages.
    const onSurface =
      target instanceof HTMLElement &&
      (target === singleCanvas || (target.dataset.pageIndex !== undefined && container.contains(target)));
    if (!onSurface) return out;
    const coords = resolveMouseToLayout(probe);
    if (coords === null) return out;
    const pageIndex = pageCount() > 0 ? coords.pageIndex : null;
    const root = paintRootFor(pageIndex);
    if (root === null) return out;
    // Topmost first: later fragments paint over earlier ones.
    const rects = decorationRectsFor(root, pageIndex);
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (r === undefined || out.has(r.decoration.id)) continue;
      if (coords.x >= r.x && coords.x < r.x + r.width && coords.y >= r.y && coords.y < r.y + r.height) {
        out.set(r.decoration.id, { decoration: r.decoration, rect: toViewportRect(r, pageIndex) });
      }
    }
    return out;
  }

  /**
   * Position every widget overlay at its anchor's caret rect (container-local).
   * Only widgets of blocks with lines on a VISIBLE page are visited (found through
   * that page's line index, never the whole set), so typing never touches
   * off-screen widgets; a header/footer widget gets one instance per visible page
   * showing it. Single canvas: the blocks with a box inside the visible band.
   */
  let widgetSyncKey: { tree: LayoutBox | VirtualLayoutTree | null; set: DecorationSet; pages: string; doc: State | null; band: string } | null = null;
  function syncWidgets(): void {
    const st = state;
    const tree = layoutTree;
    const set = layers.merged;
    const pages = visiblePages();
    const band = pageCount() > 0 ? "" : (() => { const b = singleViewport(); return `${b.top}:${b.bottom}`; })();
    const doc = st?.state ?? null;
    const k = widgetSyncKey;
    if (k !== null && k.tree === tree && k.set === set && k.pages === pages.join(",") && k.doc === doc && k.band === band) return;
    widgetSyncKey = { tree, set, pages: pages.join(","), doc, band };
    const placed: PlacedWidget[] = [];
    if (st !== null && tree !== null && set !== EMPTY_DECORATION_SET) {
      const tWidgets = markStart("ctrl.syncWidgets");
      const place = (w: WidgetDecoration, page: number | null): void => {
        recordSample("ctrl.widgetResolve", 0); // deterministic perf counter (no-op unless tracing)
        const pos = resolvePixelPosition(st.state, w.at, tree, measurer, page ?? st.caretPageHint);
        if (pos === null) return;
        if (page !== null && pos.pageIndex !== page) return; // another page's instance
        const slot = page !== null ? pageSlotGeoms[page] : undefined;
        if (page !== null && slot === undefined) return;
        placed.push({
          key: page === null ? w.id : `${w.id}\u0000${page}`,
          widget: w,
          placement: { left: pos.x, top: (slot !== undefined ? slot.top : 0) + pos.y, height: pos.height },
        });
      };
      if (pageCount() > 0) {
        for (const p of pages) {
          const root = getPageBox(p);
          if (root === null) continue;
          for (const blockId of getLineIndex(root).byBlock.keys()) {
            for (const w of set.forBlock(blockId).widgets) place(w, p);
          }
        }
      } else {
        const root = nonPaginatedTree();
        // Only blocks with a box inside the visible band (a culled walk).
        if (root !== null) {
          for (const id of blockIdsInBand(root, singleBand())) {
            for (const w of set.forBlock(id).widgets) place(w, null);
          }
        }
      }
      markEnd("ctrl.syncWidgets", tWidgets);
    }
    widgetOverlay.sync(placed);
  }

  /** The single canvas's visible band (container-local y). */
  function singleViewport(): { top: number; bottom: number } {
    const sp = scrollParent;
    let top: number;
    let bottom: number;
    if (sp instanceof HTMLElement) {
      top = sp.scrollTop;
      bottom = top + sp.clientHeight;
    } else {
      const rect = (singleCanvas ?? container).getBoundingClientRect();
      top = Math.max(0, -rect.top);
      bottom = top + window.innerHeight;
    }
    // An unmeasurable viewport (detached / no layout) resolves everything.
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return { top: -Infinity, bottom: Infinity };
    return { top, bottom };
  }

  function getCursorState(): CursorState {
    // Hide the caret over a non-collapsed selection. Use the flag, not
    // `selectionRects.length`: in paginated mode the rects are computed
    // per-page in `paintPages` and `selectionRects` stays empty.
    if (hasSelectionHighlight) return "hidden";
    if (!focused) return "inactive";
    if (cursorVisible) return "active";
    return "hidden";
  }

  function paintSingle() {
    if (!state) return;
    if (!singleCanvas) return;
    // Non-paginated mode: `layoutTree` is a positioned `LayoutBox` (never a
    // virtual tree — virtualization only happens in paginated mode).
    const tree = nonPaginatedTree();
    if (!tree) return;
    if (!singleCtx) singleCtx = singleCanvas.getContext("2d");
    const ctx = singleCtx;
    if (!ctx) return;

    const logicalWidth = tree.width;
    const logicalHeight = tree.height;

    const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    const physicalWidth = logicalWidth * dpr;
    const physicalHeight = logicalHeight * dpr;
    if (singleCanvas.width !== physicalWidth || singleCanvas.height !== physicalHeight) {
      singleCanvas.width = physicalWidth;
      singleCanvas.height = physicalHeight;
      singleCanvas.style.width = `${logicalWidth}px`;
      singleCanvas.style.height = `${logicalHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Compute visible range using scroll parent
    const sp = scrollParent;
    let visibleTop: number;
    let viewportHeight: number;
    if (sp instanceof Window) {
      const rect = singleCanvas.getBoundingClientRect();
      visibleTop = Math.max(0, -rect.top);
      viewportHeight = sp.innerHeight;
    } else {
      visibleTop = sp.scrollTop;
      viewportHeight = sp.clientHeight;
    }
    const visibleBottom = visibleTop + viewportHeight;

    paintCanvas(
      ctx,
      tree,
      selectionRects,
      decorationRectsFor(tree, null),
      cursorPos,
      getCursorState(),
      logicalWidth,
      logicalHeight,
      visibleTop,
      visibleBottom,
      imageCache,
      canvasCache,
    );
  }

  function paintPages() {
    const st = state;
    if (!st) return;
    const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    const cs = getCursorState();
    // Per-page selection rects for a non-collapsed selection in paginated mode,
    // computed from the boundary positions resolved once in `update()` (cached
    // in `selStart`/`selEnd`) — NO `resolvePixelPosition` per blink/scroll
    // repaint. The non-paginated path and the spanning-block fallback use the
    // `selectionRects` array (filtered per page) instead. `pgStart`/`pgEnd` are
    // const captures so the per-page branch can narrow them to non-null without
    // `!` at the use site (a narrowing that does NOT flow through the
    // `perPageSel` boolean, so the null check lives at the use site below).
    const pgStart = selStart;
    const pgEnd = selEnd;
    const perPageSel =
      hasSelectionHighlight && !selSpanningFallback &&
      layoutTree?.type === "virtual-root";

    for (const [idx, canvas] of activeCanvases) {
      // Position ONLY this visible page (virtual mode: `getPage(idx)`; memoized
      // so repeat paints are free). Non-visible pages are never materialized.
      const page = getPageBox(idx);
      if (!page) continue;

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const physicalWidth = page.width * dpr;
      const physicalHeight = page.height * dpr;
      if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
        canvas.width = physicalWidth;
        canvas.height = physicalHeight;
        canvas.style.width = `${page.width}px`;
        canvas.style.height = `${page.height}px`;
        // A dimension change means this page's geometry changed (a
        // section's page size was overridden, re-materializing the PageBox at a
        // new width/height). A pure geometry change moves no content boxes, so
        // walkAndDetectChanges would see "no diff" and short-circuit, leaving
        // the resized canvas blank/stale. Drop the per-page PaintCache so the
        // whole page is treated dirty and actually repaints (mirrors
        // acquireCanvas's delete-on-recycle).
        pageCaches.delete(idx);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Selection rects for this page: per-page (virtual) or filter the
      // precomputed array (non-paginated / spanning fallback / collapsed=empty).
      const pageSelRects = (perPageSel && pgStart !== null && pgEnd !== null)
        ? computeSelectionRectsForPage(
            st.state, st.selection, page, idx, pgStart, pgEnd, measurer,
            st.anchorAffinity, st.caretAffinity,
          )
        : selectionRects.filter((r) => r.pageIndex === idx);

      // Decorations painted on this page (lazily resolved + cached per page).
      const pageDecorations = decorationRectsFor(page, idx);

      // Cursor on this page? (null if not)
      const pageCursor = cursorPos.pageIndex === idx
        ? { x: cursorPos.x, y: cursorPos.y, height: cursorPos.height }
        : null;

      paintPage(ctx, page, pageSelRects, pageDecorations, pageCursor, cs, imageCache, getOrCreatePageCache(idx));
    }
  }

  function paint() {
    if (destroyed) return;
    if (pageCount() > 0) {
      paintPages();
    } else {
      paintSingle();
    }
    syncWidgets();
  }

  // ── Cursor blink ───────────────────────────────────────────────────────

  function startBlink() {
    stopBlink();
    cursorVisible = true;
    if (!focused) return;
    blinkIntervalId = setInterval(() => {
      cursorVisible = !cursorVisible;
      paint();
    }, 500);
  }

  function stopBlink() {
    if (blinkIntervalId !== null) {
      clearInterval(blinkIntervalId);
      blinkIntervalId = null;
    }
  }

  // ── Smooth scroll ──────────────────────────────────────────────────────

  function smoothScrollTo(el: HTMLElement | Window, target: number, duration: number) {
    cancelAnimationFrame(scrollAnimId);
    const start = el instanceof Window ? el.scrollY : el.scrollTop;
    const delta = target - start;
    if (Math.abs(delta) < 1) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min((now - t0) / duration, 1);
      const ease = 1 - (1 - elapsed) ** 3; // easeOutCubic
      const value = start + delta * ease;
      if (el instanceof Window) {
        el.scrollTo(0, value);
      } else {
        el.scrollTop = value;
      }
      if (elapsed < 1) {
        scrollAnimId = requestAnimationFrame(step);
      }
    };
    scrollAnimId = requestAnimationFrame(step);
  }

  function scrollCursorIntoView() {
    if (!focused || !state) return;
    scrollVisualIntoView(cursorPos);
  }

  /**
   * Scroll a visual position into view (smooth). Takes a `{pageIndex, y,
   * height}` — the cursor path passes `cursorPos`; the find-session path passes
   * an active match's start `PixelPosition`. Unlike `scrollCursorIntoView`, this
   * has NO `!focused`/`!state` guard: it reads only `pos` + the closure-local
   * `pageSlotGeoms`/`container`/`scrollParent`, all valid after ≥1 `update()`.
   * Find callers (the find bar holds focus, not the canvas) scroll regardless of
   * the editor's focus, by calling this directly with the match position.
   */
  function scrollVisualIntoView(pos: { pageIndex: number; y: number; height: number }) {
    const sp = scrollParent;

    // Compute visual Y from the target's page slot. Per-page geometry:
    // the page's document-y is its slot `top` (running-sum offset), NOT a
    // uniform `pageIndex * (pageHeight + pageGap)`. Paginated-vs-not is keyed on
    // slot presence (an empty `pageSlotGeoms` ⇒ non-paginated single canvas).
    const targetSlot = pageSlotGeoms[pos.pageIndex];
    const targetVisualY =
      pageCount() > 0 && targetSlot ? targetSlot.top + pos.y : pos.y;
    const targetH = pos.height;
    const scrollPadding = 64;

    const containerRect = container.getBoundingClientRect();

    if (sp instanceof Window) {
      const targetScreenTop = containerRect.top + targetVisualY;
      const targetScreenBottom = targetScreenTop + targetH + scrollPadding;
      if (targetScreenBottom > sp.innerHeight) {
        smoothScrollTo(sp, sp.scrollY + targetScreenBottom - sp.innerHeight, SCROLL_DURATION);
      } else if (targetScreenTop < 0) {
        smoothScrollTo(sp, sp.scrollY + targetScreenTop - scrollPadding, SCROLL_DURATION);
      }
    } else if (typeof sp.getBoundingClientRect === "function") {
      const spRect = sp.getBoundingClientRect();
      const targetInSp = containerRect.top - spRect.top + sp.scrollTop + targetVisualY;
      const visTop = sp.scrollTop;
      const visBottom = sp.scrollTop + sp.clientHeight;
      if (targetInSp + targetH + scrollPadding > visBottom) {
        smoothScrollTo(sp, targetInSp + targetH + scrollPadding - sp.clientHeight, SCROLL_DURATION);
      } else if (targetInSp < visTop + scrollPadding) {
        smoothScrollTo(sp, Math.max(0, targetInSp - scrollPadding), SCROLL_DURATION);
      }
    }
  }

  // ── DOM sync ───────────────────────────────────────────────────────────

  function syncDom() {
    if (!state || !layoutTree) return;
    // The page slots / canvases depend on the layout tree only. A selection-only
    // update keeps the tree (the driver returns the prior one), so the O(pages)
    // slot pass is skipped and only the textarea follows the caret.
    if (layoutTree !== syncedTree) syncPageDom(layoutTree);
    positionTextarea();
  }

  function syncPageDom(tree: LayoutBox | VirtualLayoutTree) {
    syncedTree = tree;

    // Derive the page-SLOT geometry WITHOUT positioning any page. Virtual mode:
    // read `plan.entries` (count + per-slot blockSize) — never the whole tree.
    // Positioned mode (unsupported-feature fallback): extract the already-
    // positioned `PageBox` children. Non-paginated: zero slots → single canvas.
    const newSlotGeoms: PageSlotGeom[] = [];
    const newPositionedPages: LayoutBox[] = [];
    let newVirtualTree: VirtualLayoutTree | null = null;

    if (pageHeight) {
      if (tree.type === "virtual-root") {
        newVirtualTree = tree;
        // Per-entry geometry: width + gap are PER-ENTRY (a section may
        // override its page size/gap), height is the entry's `blockSize`, and
        // `top` is the running-sum `blockOffset`. The slot tops in DOM flow
        // (height + marginBottom, summed) MUST agree with `top` — caret/mouse
        // use `top` while the DOM stacks slots by height + gap.
        for (const entry of tree.plan.entries) {
          newSlotGeoms.push({
            width: entry.pageConfig.pageInlineSize,
            height: entry.blockSize,
            gap: entry.pageConfig.pageGap,
            top: entry.blockOffset,
          });
        }
      } else if (tree.type === "block") {
        for (const c of tree.children) {
          // "page"-type children indicate the paginated positioned tree.
          // `LayoutBox` is a discriminated union including `PageBox`, so the
          // `type` check narrows `c` to `PageBox` — no cast needed. The legacy
          // floats/`clear` fallback uses the doc-wide `pageGap` (it does not yet
          // model per-section geometry); `top` is the box's own document-y.
          if (c.type === "page") {
            newPositionedPages.push(c);
            newSlotGeoms.push({ width: c.width, height: c.height, gap: pageGap, top: c.blockOffset });
          }
        }
      }
    }
    const isPaginated = newSlotGeoms.length > 0;
    pageSlotGeoms = newSlotGeoms;
    positionedPages = newPositionedPages;
    virtualTree = newVirtualTree;

    if (isPaginated) {
      // Remove single-canvas DOM
      if (singleCanvas) {
        singleCanvas.remove();
        singleCanvas = null;
        singleCtx = null;
      }
      if (spacerDiv) {
        spacerDiv.remove();
        spacerDiv = null;
      }
      container.style.minHeight = "";

      // Sync page canvases
      syncPageCanvases();
    } else {
      // Remove paginated DOM
      cleanupPageCanvases();

      // Ensure single canvas + spacer. Height comes from the positioned
      // (non-paginated) tree directly — never a virtual tree here.
      const positioned = nonPaginatedTree();
      if (!spacerDiv) {
        spacerDiv = document.createElement("div");
        spacerDiv.style.pointerEvents = "none";
        container.insertBefore(spacerDiv, textarea);
      }
      spacerDiv.style.height = `${positioned ? positioned.height : 0}px`;

      if (!singleCanvas) {
        singleCanvas = document.createElement("canvas");
        singleCanvas.style.position = "absolute";
        singleCanvas.style.left = "0";
        singleCanvas.style.top = "0";
        // On the mirror path the canvas is the visual surface only; the AT reads
        // the DOM mirror, so hide the canvas from the accessibility tree.
        if (mirrorEnabled) singleCanvas.setAttribute("aria-hidden", "true");
        container.insertBefore(singleCanvas, textarea);
      }

      container.style.minHeight = "100%";
    }
  }

  function positionTextarea() {
    const isPaginated = pageSlotGeoms.length > 0;
    // Position textarea on the correct page. Per-page geometry: the
    // page's document-y is its slot `top` (the plan's running-sum offset), NOT
    // `pageIndex * (pageHeight + pageGap)`.
    const cursorSlot = pageSlotGeoms[cursorPos.pageIndex];
    const textareaTop =
      isPaginated && cursorSlot ? cursorSlot.top + cursorPos.y : cursorPos.y;
    textarea.style.left = `${cursorPos.x}px`;
    textarea.style.top = `${textareaTop}px`;
    textarea.style.height = `${cursorPos.height}px`;
  }

  function syncPageCanvases() {
    const tTotal = markStart("ctrl.syncPageCanvases");
    const currentCount = pageSlots.length;
    const targetCount = pageSlotGeoms.length;

    // Remove excess slots
    for (let i = targetCount; i < currentCount; i++) {
      // Return canvas to pool if active
      const canvas = activeCanvases.get(i);
      if (canvas) {
        canvas.remove();
        canvasPool.push(canvas);
        activeCanvases.delete(i);
      }
      const excessSlot = pageSlots[i];
      if (excessSlot === undefined) {
        throw new Error(`editor-controller: page slot at ${i} unexpectedly undefined`);
      }
      excessSlot.remove();
      // Prune this index's PaintCache. Without this, `pageCaches` retains one
      // entry per peak page index for the lifetime of the controller (open a
      // 200-page doc, shrink to 2 → 198 stale caches held). Correctness on
      // grow-back is already guaranteed by acquireCanvas deleting the cache on
      // re-acquire; this just frees the memory promptly when a page is removed.
      pageCaches.delete(i);
      decoRectCache.delete(i);
    }
    pageSlots.length = targetCount;

    // Add new slots
    for (let i = currentCount; i < targetCount; i++) {
      const slot = document.createElement("div");
      slot.dataset.pageIndex = String(i);
      slot.style.position = "relative";
      slot.style.boxShadow =
        "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)";
      container.insertBefore(slot, textarea);
      pageSlots[i] = slot;
    }

    // Update existing slot attributes, dimensions + margins — from the SLOT
    // geometry (no page positioned).
    for (let i = 0; i < targetCount; i++) {
      const slot = pageSlots[i];
      const geom = pageSlotGeoms[i];
      if (slot === undefined || geom === undefined) {
        throw new Error(`editor-controller: page slot/geom at ${i} unexpectedly undefined`);
      }
      slot.dataset.pageIndex = String(i);
      slot.style.width = `${geom.width}px`;
      slot.style.height = `${geom.height}px`;
      // Per-entry gap: keeps the DOM-flow slot tops (height +
      // marginBottom, summed) consistent with each slot's `top` (running-sum
      // offset) that caret/mouse use — they MUST agree.
      slot.style.marginBottom = i < targetCount - 1 ? `${geom.gap}px` : "0";
    }

    // Setup IntersectionObserver
    setupIntersectionObserver();
    markEnd("ctrl.syncPageCanvases", tTotal);
  }

  function acquireCanvas(idx: number, slot: HTMLDivElement) {
    if (activeCanvases.has(idx)) return;
    const canvas = canvasPool.pop() ?? document.createElement("canvas");
    canvas.dataset.pageIndex = String(idx);
    canvas.style.display = "block";
    // On the mirror path each page canvas is a visual surface only; the AT reads
    // the DOM mirror. Set on every acquire (a pooled canvas may carry no attr).
    if (mirrorEnabled) canvas.setAttribute("aria-hidden", "true");
    // The canvas may be brand-new (zero pixels) or recycled from the pool
    // (carrying stale pixels from a previously-rendered page). Either way the
    // pixels don't match `idx`'s current content, so the next paint must do a
    // full repaint. Resetting the dimensions clears stale pixels (spec
    // behavior of setting canvas.width); deleting the per-page PaintCache
    // makes walkAndDetectChanges treat the entire pageBox as dirty so
    // paintPage actually draws instead of short-circuiting on "no diff".
    canvas.width = 0;
    canvas.height = 0;
    pageCaches.delete(idx);
    slot.appendChild(canvas);
    activeCanvases.set(idx, canvas);
  }

  function releaseCanvas(idx: number) {
    const canvas = activeCanvases.get(idx);
    if (!canvas) return;
    decoRectCache.delete(idx);
    canvas.remove();
    canvasPool.push(canvas);
    activeCanvases.delete(idx);
  }

  function setupIntersectionObserver() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const el = entry.target as HTMLDivElement;
          const idx = Number(el.dataset.pageIndex);
          if (isNaN(idx)) continue;
          if (entry.isIntersecting) {
            if (!activeCanvases.has(idx)) {
              acquireCanvas(idx, el);
              changed = true;
            }
          } else {
            if (activeCanvases.has(idx)) {
              releaseCanvas(idx);
              changed = true;
            }
          }
        }
        if (changed) paint();
      },
      {
        // IntersectionObserver wants Element | Document | null, never Window.
        // A non-window scroll parent (editor embedded in a scrollable <div>)
        // becomes the observer root; the window fallback maps to null (the
        // viewport).
        root: scrollParent instanceof HTMLElement ? scrollParent : null,
        rootMargin: "200px",
      },
    );

    for (const slot of pageSlots) {
      intersectionObserver.observe(slot);
    }
  }

  function cleanupPageCanvases() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    for (const [, canvas] of activeCanvases) {
      canvas.remove();
    }
    activeCanvases.clear();
    for (const slot of pageSlots) {
      slot.remove();
    }
    pageSlots = [];
    canvasPool.length = 0;
  }

  // ── Mouse handling ─────────────────────────────────────────────────────

  function resolveMouseToLayout(e: { readonly clientX: number; readonly clientY: number; readonly target: EventTarget | null }): { x: number; y: number; pageIndex: number } | null {
    const total = pageCount();
    if (total > 0 && pageHeight) {
      const target = e.target as HTMLElement;
      const inRange = (idx: number) => idx >= 0 && idx < total;

      // Check if clicked on a canvas inside a slot
      if (target instanceof HTMLCanvasElement && target.dataset.pageIndex != null) {
        const idx = Number(target.dataset.pageIndex);
        if (inRange(idx)) {
          const rect = target.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: idx };
        }
      }

      // Check if clicked on a slot div directly
      if (target instanceof HTMLDivElement && target.dataset.pageIndex != null) {
        const idx = Number(target.dataset.pageIndex);
        if (inRange(idx)) {
          const rect = target.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: idx };
        }
      }

      // Click outside any slot — find the page by visual Y. Pages are NOT
      // uniform-height (a section may override its geometry), so the
      // slot top is the running-sum `top` in `pageSlotGeoms`, NOT
      // `idx*(pageHeight+pageGap)`. With a virtual tree the plan maps document-y
      // → page authoritatively (`pageIndexAtBlockOffset`, a binary search over
      // the running-sum offsets); the positioned fallback finds the last slot
      // whose `top <= visualY`. The page-local Y subtracts that slot's `top` and
      // clamps to THAT page's own height (so a click low on a tall section page
      // is not clamped to the short default).
      const rect = container.getBoundingClientRect();
      const visualY = e.clientY - rect.top;
      let idx: number;
      if (virtualTree !== null) {
        idx = Math.max(0, Math.min(total - 1, virtualTree.plan.pageIndexAtBlockOffset(visualY)));
      } else {
        // Positioned fallback: the last slot whose top edge is at/above visualY.
        idx = 0;
        for (let i = 0; i < total; i++) {
          const g = pageSlotGeoms[i];
          if (g === undefined) {
            throw new Error(`editor-controller: page slot geom at ${i} unexpectedly undefined`);
          }
          if (g.top <= visualY) idx = i;
          else break;
        }
      }
      const slot = pageSlotGeoms[idx];
      if (slot === undefined) {
        throw new Error(`editor-controller: page slot geom at ${idx} unexpectedly undefined`);
      }
      const pageLocalY = visualY - slot.top;
      return {
        x: e.clientX - rect.left,
        y: Math.max(0, Math.min(slot.height, pageLocalY)),
        pageIndex: idx,
      };
    }
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pageIndex: 0 };
  }

  /**
   * Hit-test the SYNTHESIZED TOC entry lines on the clicked page. The entry
   * boxes are not state-backed (the `table-of-contents` render branch
   * synthesizes them), so `resolvePositionFromPixel` cannot see them — this walks
   * the materialized page-box tree directly, accumulating PHYSICAL parent offsets
   * exactly as the painter does (page-local origin starts at `-pageBox.x/.y` so
   * the page itself sits at (0,0); descendants add their own physical `x`/`y` plus
   * any `relativeOffset`). The DEEPEST containing box may be an inner leaf (a glyph
   * run / the page-number atom), so the walk tracks the nearest ANCESTOR tagged
   * `metadata.tocEntry === true` and returns ITS `navTarget` — the whole entry
   * line is the click target (Google Docs). Returns the heading `BlockId`, or null
   * when the point is not inside any TOC entry line.
   */
  function pickTocEntryAt(coords: { x: number; y: number; pageIndex: number }): BlockId | null {
    const pageBox = getPageBox(coords.pageIndex);
    if (pageBox === null) return null;
    const { x, y } = coords;
    // The most recent enclosing tagged entry's navTarget, threaded down the walk.
    function walk(
      box: LayoutBox,
      parentX: number,
      parentY: number,
      enclosingNavTarget: BlockId | null,
    ): BlockId | null {
      const rel = box.relativeOffset;
      const absX = parentX + box.x + (rel !== undefined ? rel.dx : 0);
      const absY = parentY + box.y + (rel !== undefined ? rel.dy : 0);
      // Outside this box's rect → it (and its descendants) cannot contain the point.
      if (x < absX || x >= absX + box.width || y < absY || y >= absY + box.height) {
        return null;
      }
      const meta = "metadata" in box ? box.metadata : undefined;
      const nav: BlockId | null =
        meta?.tocEntry === true && typeof meta.navTarget === "string"
          ? meta.navTarget
          : enclosingNavTarget;
      // Descend into children / column tracks (the painter's two child carriers).
      if ("children" in box) {
        for (const child of box.children) {
          const found = walk(child, absX, absY, nav);
          if (found !== null) return found;
        }
      }
      if ("columns" in box) {
        for (const col of box.columns) {
          const found = walk(col, absX, absY, nav);
          if (found !== null) return found;
        }
      }
      // No deeper tagged hit; this box contains the point, so the nearest
      // enclosing entry (if any) is the answer.
      return nav;
    }
    return walk(pageBox, -pageBox.x, -pageBox.y, null);
  }

  function handleMouseDown(e: MouseEvent) {
    if (halted) return;
    if (destroyed || !state || !layoutTree) return;
    e.preventDefault();
    // Re-focus the active host. On the mirror path the mirror is the focus/IME
    // owner; otherwise the hidden textarea (flag-off, byte-identical to today).
    if (mirrorHost !== null) mirrorHost.focus();
    else textarea.focus();

    // Clear any TOC nav left pending by a prior mousedown that never reached a
    // mouseup (e.g. a second press without releasing) — BEFORE the coords
    // early-return below, so even a press that doesn't resolve to layout coords
    // still clears stale nav. Every fresh mousedown starts with no pending nav;
    // the TOC-defer branch below re-sets it only when the press lands on a TOC
    // entry. Without this reset, a stale `pendingTocNav` would fire a spurious
    // navigation on the next mouseup.
    pendingTocNav = null;

    const coords = resolveMouseToLayout(e);
    if (!coords) return;

    // TOC click-to-navigate: a PLAIN single click (no modifiers, not a
    // multi-click) on a synthesized TOC entry line defers a caret jump to its
    // heading until mouseup — a drag past the epsilon abandons it and text-selects
    // instead. Seed `dragAnchor` from the entry's resolved hit position FIRST so a
    // drag-from-an-entry still builds a valid selection span when nav is abandoned.
    if (e.detail === 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const navTarget = pickTocEntryAt(coords);
      if (navTarget !== null) {
        pendingTocNav = navTarget;
        tocNavDownX = e.clientX;
        tocNavDownY = e.clientY;
        isDragging = true;
        const tocHitTree = treeForPageHitTest(coords.pageIndex);
        const tocHit = tocHitTree
          ? resolvePositionFromPixel(state.state, tocHitTree, measurer, coords.x, coords.y, coords.pageIndex)
          : null;
        dragAnchor = tocHit ? tocHit.position : null;
        return; // suppress the immediate caret dispatch
      }
    }

    // Hit-test against ONLY the clicked page (virtual tree) — never
    // materialize the whole document.
    const hitTree = treeForPageHitTest(coords.pageIndex);
    if (!hitTree) return;
    // TODO: when the hit resolves to an object selection (e.g. an image), suppress the
    // text caret and paint the object bounding box instead.
    const hit = resolvePositionFromPixel(
      state.state,
      hitTree,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
      state.config.componentRegistry,
    );
    if (!hit) {
      dispatch({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" });
      return;
    }
    // Carry the hit-side caret-affinity seed through to the click's
    // SET_SELECTION so a collapsed caret at a bidi direction boundary renders on
    // the clicked side. Multi-click / shift-extend selections are non-collapsed
    // (affinity is inert there) — they pass no seed, which clears any stale value.
    const pos = hit.position;
    const caretAffinity = hit.caretAffinity;

    // HL.3: Cmd/Ctrl+Click on a hyperlink opens the URL in a new
    // tab instead of placing the cursor. Plain click still positions
    // the cursor — needed so users can edit link text.
    if (e.metaKey || e.ctrlKey) {
      const url = linkUrlAtPosition(state.state, pos);
      if (url !== null) {
        // Allowlist safe schemes (per hyperlinks spec risk table: reject
        // javascript: / data: / vbscript: and scheme-less URLs). Shared with the
        // taleweaver-html export guard.
        if (isOpenableLinkUrl(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
    }

    // Triple-click: select the paragraph WITH its ¶ (Word; core `selectParagraph`):
    // (P, 0)–(N, 0), or (P, 0)–(P, len) on a flow's last one.
    if (e.detail >= 3) {
      dispatch({ type: "SET_SELECTION", selection: selectParagraph(state.state, pos), caretPageHint: coords.pageIndex });
      return;
    }

    // Double-click: select word
    if (e.detail === 2) {
      const wordSel = selectWord(state.state, pos);
      dispatch({ type: "SET_SELECTION", selection: wordSel, caretPageHint: coords.pageIndex });
      return;
    }

    // Shift-click: extend selection from current anchor.
    // A pointer selection is CONFINED to the selection context it began in
    // (Google Docs): you cannot shift-extend from the body into a footnote
    // slot (a different selection context), or vice versa. Extending across
    // contexts would build a cross-context Span, which crashes the next render
    // (getActiveFormatting → iterateSpan throws "different selection
    // contexts"). When `pos` is cross-context, keep the prior in-context
    // selection — skip the extension.
    if (e.shiftKey) {
      // A null context means the block isn't in any tree (should not happen for
      // a hit-test position, but never extend into an unknown context). Treat
      // null as a definitive skip so two unknown contexts can't compare equal.
      const anchorCtx = selectionContextOf(state.state, state.selection.anchor.blockId);
      const posCtx = selectionContextOf(state.state, pos.blockId);
      if (anchorCtx === null || posCtx === null || anchorCtx !== posCtx) return;
      dispatch({
        type: "SET_SELECTION",
        selection: createSpan(state.selection.anchor, pos),
        caretPageHint: coords.pageIndex,
      });
      return;
    }

    // Single click: position cursor + start drag. Seed the caret affinity from
    // the hit side so a collapsed caret at a bidi direction boundary renders
    // there.
    isDragging = true;
    dragAnchor = pos;
    dispatch({
      type: "SET_SELECTION",
      selection: createSpan(pos, pos),
      caretPageHint: coords.pageIndex,
      caretAffinity,
    });
  }

  function handleMouseMove(e: MouseEvent) {
    if (halted) return;
    if (!isDragging || !state || !layoutTree) return;

    // TOC click-to-navigate: a pending nav survives tiny pointer jitter but is
    // ABANDONED by a real drag (past the epsilon) — which then falls through to
    // the normal text-selection drag below (dragAnchor was seeded at mousedown).
    if (pendingTocNav !== null) {
      const dx = e.clientX - tocNavDownX;
      const dy = e.clientY - tocNavDownY;
      const EPS = 4; // px jitter tolerance
      if (dx * dx + dy * dy < EPS * EPS) return; // tiny jitter: keep deferring nav
      pendingTocNav = null; // real drag: abandon nav, text-select
    }

    // No drag anchor (e.g. a TOC entry whose hit position didn't resolve) → nothing
    // to extend a selection from.
    if (!dragAnchor) return;

    const coords = resolveMouseToLayout(e);
    if (!coords) return;

    // Drag hit-test against ONLY the page under the pointer (see
    // handleMouseDown) — never materialize the whole document.
    const hitTree = treeForPageHitTest(coords.pageIndex);
    if (!hitTree) return;
    const hit = resolvePositionFromPixel(
      state.state,
      hitTree,
      measurer,
      coords.x,
      coords.y,
      coords.pageIndex,
      state.config.componentRegistry,
    );
    if (hit) {
      // A drag builds a (usually non-collapsed) span — caret
      // affinity is inert across a range, so the drag's SET_SELECTION carries the
      // hit-side seed only so a drag that collapses back onto a boundary still
      // renders on the pointer side.
      const pos = hit.position;
      const caretAffinity = hit.caretAffinity;
      // A drag selection is CONFINED to the selection context it began in
      // (Google Docs): once the pointer crosses from the body into a footnote
      // slot (a different selection context), the drag does NOT extend into it.
      // Building `createSpan(dragAnchor, pos)` across contexts would store a
      // cross-context Span, which crashes the next render (getActiveFormatting
      // → iterateSpan throws "different selection contexts"). Skip the
      // extension when `pos` left the anchor's context — the prior in-context
      // selection stands.
      // A null context means the block isn't in any tree (should not happen for
      // a hit-test position, but never extend into an unknown context). Treat
      // null as a definitive skip so two unknown contexts can't compare equal.
      const anchorCtx = selectionContextOf(state.state, dragAnchor.blockId);
      const posCtx = selectionContextOf(state.state, pos.blockId);
      if (anchorCtx === null || posCtx === null || anchorCtx !== posCtx) return;
      // The drag hint tracks the FOCUS page (the current drag point) so the
      // caret resolves on the page under the pointer.
      dispatch({
        type: "SET_SELECTION",
        selection: createSpan(dragAnchor, pos),
        caretPageHint: coords.pageIndex,
        caretAffinity,
      });
    }
  }

  function handleMouseUp() {
    // TOC click-to-navigate: a pending nav that survived to mouseup (no drag past
    // the epsilon) is a CLICK → jump the caret to the heading's start. A drag would
    // have cleared `pendingTocNav` in handleMouseMove. The heading is scrolled into
    // view by the post-dispatch `update()` cycle (which recomputes `cursorPos` then
    // calls `scrollCursorIntoView`) — calling it here would scroll to the STALE
    // pre-dispatch caret, so it is intentionally NOT called (matching the other
    // selection-changing gestures, none of which scroll inline).
    if (pendingTocNav !== null) {
      const target = pendingTocNav;
      pendingTocNav = null;
      isDragging = false;
      dragAnchor = null;
      const caret = createPosition(target, 0);
      dispatch({ type: "SET_SELECTION", selection: createSpan(caret, caret) });
      return;
    }
    isDragging = false;
  }

  // ── Keyboard / input handling ──────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    // Halted: no default is prevented — browser shortcuts (Tab, reload, …) keep working.
    if (halted) return;
    if (isComposing || e.isComposing) return;
    // Host keymap BEFORE the defaults: a command that runs claims the key; an
    // unbound (`null`) key is swallowed so the default cannot run.
    if (state !== null) {
      const outcome = runKeyBinding(state.config.extensions, e, modConvention, state, dispatch);
      if (outcome !== "default") {
        e.preventDefault();
        return;
      }
    }
    // Paste-without-formatting (Ctrl/Cmd+Shift+V): async path — must be
    // intercepted before mapKeyEvent (which returns null for this chord and
    // would silently swallow the preventDefault). Reads text/plain ONLY from
    // the Clipboard API and dispatches PASTE { text } with no html/clip.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      if (navigator.clipboard !== undefined) {
        navigator.clipboard.readText().then((text) => {
          if (text) dispatch({ type: "PASTE", text });
        }).catch(() => {
          // Permission denied or unavailable — graceful no-op.
        });
      }
      return;
    }
    // Tab / Shift+Tab routing is context-sensitive: pass whether the caret's
    // focus block is a list-item so the keymap can map Tab → list nesting.
    const focusBlock =
      state !== null
        ? getBlock(state.state, state.selection.focus.blockId)
        : null;
    const result = mapKeyEvent(e, {
      inListItem: focusBlock?.type === "list-item",
    });
    if (result === null) return;
    // Claim Escape only when it dismisses something (an object selection or a host
    // trigger); otherwise it must reach the page (e.g. close a containing dialog).
    if (!isNavIntent(result) && result.type === "ESCAPE" && (state === null || !escapeWouldChange(state, state.config.componentRegistry))) return;
    e.preventDefault();
    if (isNavIntent(result)) {
      // Geometric navigation: core's reducer is geometry-free, so the
      // backend resolves the intent against the driver-built `layoutTree` +
      // measurer → a `SET_SELECTION` / `DELETE_RANGE` it dispatches to core. A
      // null resolution (line-move off the document edge, degenerate line-delete)
      // dispatches nothing — matching the lifted handlers' `return editor;`.
      if (state === null || layoutTree === null) return;
      const navAction = resolveNavIntent(result, state, layoutTree, measurer, state.config.componentRegistry);
      if (navAction !== null) dispatch(navAction);
      return;
    }
    dispatch(result);
  }

  function handleInput() {
    if (halted) {
      textarea.value = "";
      return;
    }
    if (isComposing) return;
    // Ignore input while blurred. An `input` that fires when the editor is not
    // focused (a programmatic textarea value-set, or a stray event arriving after
    // a focus race) would apply text at a STALE caret — the engine's selection
    // points elsewhere. Clear the buffer so the value can't leak into the next
    // focused input. (Provenance of focused non-typing input — autofill /
    // translation bulk-sets — is a separate hardening concern.)
    if (!focused) {
      textarea.value = "";
      return;
    }
    const text = textarea.value;
    if (text) {
      dispatch({ type: "INSERT_TEXT", text, userInput: true });
    }
    textarea.value = "";
  }

  function handleCompositionStart() {
    isComposing = true;
  }

  function handleCompositionEnd(e: CompositionEvent) {
    isComposing = false;
    if (halted) {
      textarea.value = "";
      return;
    }
    const text = e.data;
    if (text) {
      dispatch({ type: "INSERT_TEXT", text, userInput: true });
    }
    textarea.value = "";
  }

  // ── Clipboard handling ─────────────────────────────────────────────────

  function handleCopy(e: ClipboardEvent) {
    if (halted) {
      e.preventDefault(); // empty clipboard: copying reads the (incompatible) document
      return;
    }
    if (!state) return;
    if (isCollapsed(state.selection)) return;
    e.preventDefault();
    const frag = extractFragment(state.state, state.selection); // strips copy:"drop" marks
    e.clipboardData?.setData("text/plain", extractText(state.state, state.selection, builtinEmbedSerializer));
    e.clipboardData?.setData("text/html", encodeHtml(frag));
    e.clipboardData?.setData(TALEWEAVER_CLIP_MIME, encodeFragmentClip(frag));
  }

  function handleCut(e: ClipboardEvent) {
    if (halted) {
      e.preventDefault();
      return;
    }
    if (!state) return;
    if (isCollapsed(state.selection)) return;
    e.preventDefault();
    const frag = extractFragment(state.state, state.selection); // strips copy:"drop" marks
    e.clipboardData?.setData("text/plain", extractText(state.state, state.selection, builtinEmbedSerializer));
    e.clipboardData?.setData("text/html", encodeHtml(frag));
    e.clipboardData?.setData(TALEWEAVER_CLIP_MIME, encodeFragmentClip(frag));
    dispatch({ type: "DELETE_BACKWARD" });
  }

  function handlePaste(e: ClipboardEvent) {
    // preventDefault UNCONDITIONALLY: if we returned before it on `state === null`,
    // the browser's default paste would land in the hidden textarea and leak back
    // in via `handleInput` as an INSERT_TEXT — defeating the guard. Block the
    // native paste first, THEN no-op when there is no state to paste into.
    e.preventDefault();
    if (!state) return;
    const text = e.clipboardData?.getData("text/plain");
    const html = e.clipboardData?.getData("text/html");
    const clip = e.clipboardData?.getData(TALEWEAVER_CLIP_MIME);
    const payload: { type: "PASTE"; text?: string; html?: string; clip?: string } = {
      type: "PASTE",
    };
    if (text) payload.text = text;
    if (html) payload.html = html;
    if (clip) payload.clip = clip;
    if (payload.text !== undefined || payload.html !== undefined || payload.clip !== undefined) {
      dispatch(payload);
    }
  }

  // ── Focus handling ─────────────────────────────────────────────────────

  function handleFocus() {
    focused = true;
    cursorVisible = true;
    startBlink();
    paint();
  }

  function handleBlur() {
    focused = false;
    // If an IME composition was in flight when focus was lost, ABANDON it. There
    // is no spec guarantee `compositionend` fires before/at blur (Chrome/Safari
    // differ, and an interrupted composition may never fire it), so a stale
    // `isComposing === true` would gate `handleKeyDown`/`handleInput` forever —
    // the editor would silently accept no input after refocus (a dead editor).
    // Clearing the flag + the textarea buffer recovers cleanly (the partial
    // composed text is dropped, which is the acceptable trade for recoverability).
    if (isComposing) {
      isComposing = false;
      textarea.value = "";
    }
    stopBlink();
    paint();
  }

  // ── Scroll handling ────────────────────────────────────────────────────

  function handleScroll() {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => paint());
  }

  // ── Attach event listeners ─────────────────────────────────────────────

  container.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
  textarea.addEventListener("keydown", handleKeyDown);
  textarea.addEventListener("input", handleInput);
  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  textarea.addEventListener("copy", handleCopy);
  textarea.addEventListener("cut", handleCut);
  textarea.addEventListener("paste", handlePaste);
  textarea.addEventListener("focus", handleFocus);
  textarea.addEventListener("blur", handleBlur);

  // Detect scroll parent and listen
  detectScrollParent();
  scrollParent.addEventListener("scroll", handleScroll, { passive: true } as AddEventListenerOptions);

  // Decoration pointer events: hover/click over painted fragments and widget
  // overlays. Only wired when the host asked for them.
  const onDecorationPointer = options.onDecorationPointer;
  const decorationPointer =
    onDecorationPointer !== undefined
      ? createDecorationPointer(
          container,
          { under: decorationsUnderPointer, rectsOf: decorationViewportRects },
          onDecorationPointer,
        )
      : null;

  // ── Accessibility mirror host (gated) ──────────────────────────
  //
  // When `accessibilityMirror` is ON, build the hidden AT-visible DOM mirror and
  // make it the focus/IME/clipboard host. Built AFTER the handler closures +
  // `isComposing`/`state` locals are in scope so they can be forwarded verbatim.
  // The engine still owns every edit: the mirror's events dispatch the SAME
  // actions the textarea path does (INSERT_TEXT, SET_SELECTION, …); the mirror
  // never mutates the document directly. `update()` re-syncs the mirror tree +
  // selection AFTER each paint.
  if (mirrorEnabled) {
    mirrorHost = createDomMirrorHost({
      container,
      doc: container.ownerDocument,
      onKeyDown: handleKeyDown,
      onCopy: handleCopy,
      onCut: handleCut,
      onPaste: handlePaste,
      onFocus: handleFocus,
      onBlur: handleBlur,
      // The mirror's beforeinput already prevented the default and resolved the
      // text, so this just dispatches the SAME INSERT_TEXT the textarea path does.
      onInsertText: (text) => {
        if (text.length > 0) dispatch({ type: "INSERT_TEXT", text, userInput: true });
      },
      // Set the CONTROLLER's composition flag (the one `handleKeyDown`/
      // `handleInput` gate on). NOT `handleCompositionStart`, which also clears
      // the textarea buffer — irrelevant on the mirror path.
      onCompositionStart: () => {
        isComposing = true;
      },
      onCompositionEnd: (text) => {
        isComposing = false;
        if (halted) {
          mirrorHost?.abandonComposition(); // drop the composed DOM text
          return;
        }
        if (text.length > 0) dispatch({ type: "INSERT_TEXT", text, userInput: true });
        else syncMirror(); // apply what was deferred while composing (e.g. a peer change)
      },
      // Idempotency loop-break: a `selectionchange` whose span equals the current
      // engine selection must NOT re-dispatch SET_SELECTION (the mirror selection
      // we just placed in `syncSelection` re-fires selectionchange). Only a span
      // that genuinely differs reaches the engine.
      onSelectionChange: (span) => {
        if (state === null) return;
        const cur = state.selection;
        const same =
          span.anchor.blockId === cur.anchor.blockId &&
          span.anchor.offset === cur.anchor.offset &&
          span.focus.blockId === cur.focus.blockId &&
          span.focus.offset === cur.focus.offset;
        if (!same) dispatch({ type: "SET_SELECTION", selection: span });
      },
    });
    mirrorHost.focus();
  }

  // A view re-created while its editor is halted: watch the halted document (no render).
  if (options.startHaltedOn !== undefined) watchDocument(options.startHaltedOn, true);

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Re-materialize the accessibility mirror from the current state +
   * selection. Gated on the host being present (flag-on); a no-op on the default
   * textarea path. Skipped while an IME composition is active — rewriting the mirror's
   * DOM or selection under the IME would cancel / corrupt the composition (a peer change
   * can land mid-composition); composition end re-syncs.
   */
  function syncMirror(): void {
    if (halted || mirrorHost === null || state === null || isComposing) return;
    // VIEW INVARIANT (design R1-Minor-6): the a11y tree's suggestionView MUST match
    // the view the layout's `globalFieldValues` were resolved at — both are
    // "suggesting" today. A future preview-mode a11y build must thread the
    // matching-view field map, or field text will key against the wrong values.
    const resolvedFields =
      layoutTree !== null && layoutTree.type === "virtual-root"
        ? layoutTree.globalFieldValues
        : new Map<string, string>();
    mirrorHost.syncTree(
      buildAccessibilityTree(state.state, { suggestionView: "suggesting" }),
      resolvedFields,
    );
    mirrorHost.syncSelection(state.selection);
  }

  function update(editorState: EditorState) {
    if (destroyed) return;
    const doc = getYDoc(editorState.state);
    // A document REPLACEMENT (the first State, another Y.Doc, or a State not reduced from
    // the current one) must hold no legacy storage (the load assertion; O(blocks), only
    // here) — checked even when not halted (legacy may land between `createState` and
    // here): refused, the controller halts on it and keeps the last good render. Halted,
    // only such a replacement resumes; the halted State, a refused replacement and any
    // State reduced from either keep the last good render.
    let resumed = false;
    if (halted) {
      const haltedState = state?.state ?? options.startHaltedOn?.state;
      if (descendsFrom(editorState, (s) => s === haltedState || refusedStates.has(s))) return;
    }
    const current = state?.state;
    const replacing = halted || current === undefined || doc !== remoteDoc || !descendsFrom(editorState, (s) => s === current);
    if (replacing) {
      const legacy = inspectDocument(doc).legacyBlocks;
      if (legacy.length > 0) {
        // A refused replacement is forbidden like the halted State: so is anything reduced from it.
        refusedStates.add(editorState.state);
        // Its legacy storage went unseen (not halted yet, another document, or a local
        // write after "compatible"): halt (or report again if the host was told
        // "compatible") and watch this document halted — so its upgrade is reported.
        if (!halted || doc !== remoteDoc || toldCompatible) {
          halt({ reason: "legacy-schema", legacyBlocks: legacy, legacyText: {} });
          watchDocument(editorState, true);
        }
        return;
      }
    }
    if (halted) {
      halted = false;
      toldCompatible = false;
      refusedStates = new WeakSet();
      resumed = true;
    }
    // Collaboration: follow the document's Y.Doc (re-subscribing when the host swaps
    // in another document, or afresh on resume).
    if (doc !== remoteDoc || resumed) watchDocument(editorState, false);
    const tTotal = markStart("ctrl.update");
    // A resume is a document replacement: every layer and the find session are dropped
    // (the host sets them again); the transition is unknown.
    if (resumed) {
      layers = createDecorationLayers();
      find.close();
    }
    const prev = state;
    state = editorState;
    let replaced = false;

    // Decoration layers: carry every layer through the transition (positions
    // mapped; comment / suggestion ranges re-scanned when the edit touched their
    // anchors). The first update replays calls queued before a document existed.
    const tLayers = markStart("ctrl.decorationLayers");
    if (prev !== null) {
      if (prev.state !== editorState.state) {
        // One mapping for the transition, shared by the layers and the session.
        const mapping = transitionMapping(prev, editorState);
        // An unknown transition (document replaced) restarts the log: older States
        // can no longer be mapped. A host that batched several dispatches still maps
        // (transitionMapping walks the change chain).
        if (mapping !== UNKNOWN_MAPPING) mappingLog.record(prev.state, editorState.state, mapping);
        else {
          mappingLog.reset(editorState.state);
          replaced = true;
        }
        layers.advance(prev, editorState, mapping);
        anchors.advance(prev.state, editorState.state, mapping);
        // Find live-recompute: an open session re-finds only in the edited
        // blocks (keeping its active occurrence; advancing past a replacement) and
        // the find layer is patched only where matches changed. Never scrolls — a
        // recompute mid-typing must not yank the viewport.
        if (find.active) {
          const { changedBlocks } = find.refresh(editorState.state, mapping);
          if (changedBlocks === null) layers.setFind(editorState.state, find.matches(), find.activeIndex());
          else layers.patchFind(editorState.state, find.matches(), find.activeIndex(), changedBlocks);
        }
      }
    } else {
      mappingLog.reset(editorState.state);
    }
    if (prev === null && pendingLayerOps.length > 0) {
      const ops = pendingLayerOps;
      pendingLayerOps = [];
      for (const op of ops) op(editorState.state);
    }
    pendingHost = null;
    settleProposals(editorState.lastProposal, replaced);
    // Fragments computed against the previous tree / document are dead.
    decoRectCache.clear();
    markEnd("ctrl.decorationLayers", tLayers);

    // Do NOT materialize all pages here. `layoutTree` is the raw (possibly
    // virtual) tree; paginated paths (paint, caret, hit-test, selection/find/
    // comment rects) read it per-page via `getPage` and union per-page via
    // `selectionRectsAcrossPages` — the whole document is never materialized.
    // Only the non-paginated branches read it as a positioned `LayoutBox` (via
    // `nonPaginatedTree()`).
    // The backend layout-driver owns the render→cascade→layout
    // rebuild. Core's reducer is geometry-free — it records WHAT changed
    // (`state.lastDirtyIds`); the driver consumes that to rebuild incrementally
    // (reusing unchanged page subtrees by reference) and is the SOLE source of
    // the layout tree the controller paints / hit-tests / positions the caret on.
    layoutTree = driver.rebuild(state);

    // Cursor position: resolved directly against the (virtual or positioned)
    // tree. In virtual mode `resolvePixelPosition` positions only the cursor's
    // page (+ a neighbor at the cross-page soft-wrap edge), NEVER all pages —
    // this is what makes the typing/Enter hot path O(1 page). Returns null for
    // unknown blockIds; fall back to default coords for a placeholder cursor.
    const tResolve = markStart("ctrl.resolveCursor");
    const resolved = resolvePixelPosition(
      state.state,
      state.selection.focus,
      layoutTree,
      measurer,
      state.caretPageHint,
      // Feed the stored bidi caret-affinity so a collapsed
      // caret at an LTR↔RTL run boundary renders on the side the user clicked /
      // last arrowed to (the dual-caret). The seed is written by hit-test + bidi
      // move; without threading it here the render always defaulted to "after".
      state.caretAffinity,
    );
    cursorPos = resolved ?? {
      x: 0,
      y: 0,
      height: 16,
      lineY: 0,
      lineHeight: 24,
      lineMarginTop: 0,
      lineMarginBottom: 0,
      pageIndex: 0,
    };
    markEnd("ctrl.resolveCursor", tResolve);

    // Selection rects. Collapsed (typing/Enter hot path) → none. Paginated +
    // non-collapsed → per-page in `paintPages` from the boundary positions
    // resolved ONCE here (no bridge). Non-paginated → the full positioned tree.
    // Spanning-block boundary → fall back to the bridge (rare; per-page can't
    // see a block's fragment on the other page). `selectionRects` carries rects
    // only for the non-paginated + spanning-fallback cases; the per-page path
    // leaves it empty and uses `selStart`/`selEnd`.
    const tSel = markStart("ctrl.selectionRects");
    hasSelectionHighlight = !isCollapsed(state.selection);
    selStart = null;
    selEnd = null;
    selSpanningFallback = false;
    selectionRects = [];
    if (hasSelectionHighlight) {
      const start = spanStart(state.state, state.selection);
      const end = spanEnd(state.state, state.selection);
      if (layoutTree.type === "virtual-root") {
        selSpanningFallback =
          blockSpansPages(layoutTree.plan, start.blockId) ||
          blockSpansPages(layoutTree.plan, end.blockId);
        if (selSpanningFallback) {
          // Rare: a boundary block taller than a page. Per-page concat over the
          // virtual tree (per-page, never the whole tree).
          selectionRects = selectionRectsAcrossPages(
            state.state, state.selection, layoutTree, measurer,
            state.anchorAffinity, state.caretAffinity,
          );
        } else {
          selStart = resolvePixelPosition(state.state, start, layoutTree, measurer, state.caretPageHint);
          selEnd = resolvePixelPosition(state.state, end, layoutTree, measurer, state.caretPageHint);
          // rects computed per-page in paintPages from selStart/selEnd
        }
      } else {
        selectionRects = computeSelectionRects(
          state.state, state.selection, layoutTree, measurer,
          state.anchorAffinity, state.caretAffinity,
        );
      }
    }
    markEnd("ctrl.selectionRects", tSel);

    const tSync = markStart("ctrl.syncDom");
    syncDom();
    markEnd("ctrl.syncDom", tSync);

    const tBlink = markStart("ctrl.startBlink");
    startBlink();
    markEnd("ctrl.startBlink", tBlink);

    const tPaint = markStart("ctrl.paint");
    paint();
    markEnd("ctrl.paint", tPaint);

    // Re-materialize the accessibility mirror from the fresh state +
    // selection, AFTER paint. Gated on the host being present (flag-on); a no-op
    // on the default textarea path. The mirror tree is the semantic projection
    // (`buildAccessibilityTree`, suggesting view); `syncSelection` then re-places
    // the DOM selection to match the engine caret/range.
    syncMirror();

    const tScroll = markStart("ctrl.scrollIntoView");
    scrollCursorIntoView();
    markEnd("ctrl.scrollIntoView", tScroll);

    // A resting pointer: a decoration removed or reflowed out from under it leaves.
    decorationPointer?.sync();

    markEnd("ctrl.update", tTotal);
  }

  // ── Decorations + built-in highlight layers ─────────────────
  //
  // Every setter updates its layer and repaints. A bare `paint()` suffices: the
  // merged set changed identity, so `decorationRectsFor` re-resolves the visible
  // pages, and the renderer's `addDecorationDirty` diffs each page's fragments
  // (geometry + look) against the previous frame — only pages whose painted
  // decorations actually changed repaint, and cleared fragments are erased.

  /** Repaint after a decoration-layer change and re-hit-test a resting pointer. */
  function redrawDecorations(): void {
    colorCache.clear();
    paint();
    decorationPointer?.sync();
  }

  function setDecorations(decorations: readonly Decoration[], basedOn?: State): void {
    if (destroyed) return;
    if (halted) return; // a no-op: `decorations` keeps the last good set
    if (state === null) pendingHost = decorations;
    withLayers((s) => {
      let current = decorations;
      if (basedOn !== undefined && basedOn !== s) {
        const mapping = mappingLog.mappingFrom(basedOn);
        current = mapping === null ? [] : mapDecorations(decorations, mapping, s);
      }
      layers.setHost(s, current);
    });
    redrawDecorations();
  }

  function setFindHighlights(matches: readonly TextMatch[], activeIndex: number): void {
    if (destroyed) return;
    withLayers((s) => layers.setFind(s, matches, activeIndex));
    redrawDecorations();
  }

  function clearFindHighlights(): void {
    if (destroyed) return;
    withLayers((s) => layers.setFind(s, [], -1));
    redrawDecorations();
  }

  function setCommentHighlights(highlights: readonly CommentHighlight[]): void {
    if (destroyed) return;
    withLayers((s) => layers.setComments(s, highlights));
    redrawDecorations();
  }

  function clearCommentHighlights(): void {
    if (destroyed) return;
    withLayers((s) => layers.setComments(s, null));
    redrawDecorations();
  }

  function setSuggestionHighlights(highlights: readonly SuggestionHighlight[]): void {
    if (destroyed) return;
    withLayers((s) => layers.setSuggestions(s, highlights));
    redrawDecorations();
  }

  function clearSuggestionHighlights(): void {
    if (destroyed) return;
    withLayers((s) => layers.setSuggestions(s, null));
    redrawDecorations();
  }

  // ── Find session + navigation ─────────────────────────────────────

  function findStatus(): FindStatus {
    return halted ? EMPTY_FIND : find.status();
  }

  function replaceActive(replacement: string): FindStatus {
    if (halted) return EMPTY_FIND;
    if (destroyed) return find.status();
    // Dispatch the engine action; the host's reducer produces the new state and
    // the following `update()` refreshes the session (activating the first match
    // after the replacement). Returns the CURRENT (pre-refresh) status.
    const action = find.replaceActiveAction(replacement);
    if (action !== null) dispatch(action);
    return find.status();
  }

  function replaceAll(replacement: string): FindStatus {
    if (halted) return EMPTY_FIND;
    if (destroyed) return find.status();
    // One undo step (REPLACE_ALL); the following `update()` refreshes the session.
    const action = find.replaceAllAction(replacement);
    if (action !== null) dispatch(action);
    return find.status();
  }

  /**
   * Scroll the session's active match into view via its START `PixelPosition`
   * (resolved on demand against the current layout). NEVER moves the document
   * cursor. No-op when there is no active match or its position hasn't resolved.
   * Scrolls regardless of editor focus (the find bar holds focus) —
   * `scrollVisualIntoView` has no focus guard.
   */
  function scrollActiveMatchIntoView(): void {
    const st = state;
    if (st === null || layoutTree === null) return;
    const m = find.matches()[find.activeIndex()];
    if (m === undefined) return;
    const startPos = resolvePixelPosition(
      st.state, createPosition(m.blockId, m.start), layoutTree, measurer, st.caretPageHint,
    );
    if (startPos === null) return;
    scrollVisualIntoView(startPos);
  }

  function findStart(query: string, options?: FindMatchesOptions): FindStatus {
    if (halted || destroyed || state === null) return EMPTY_FIND;
    // Finds from the caret (the first match at/after it is active — Google Docs).
    find.start(state.state, state.selection.focus, query, options);
    return showFind(true);
  }

  function findNext(): FindStatus {
    if (halted) return EMPTY_FIND;
    if (destroyed || find.status().total === 0) return find.status();
    find.next();
    return showFind(true);
  }

  function findPrev(): FindStatus {
    if (halted) return EMPTY_FIND;
    if (destroyed || find.status().total === 0) return find.status();
    find.prev();
    return showFind(true);
  }

  function findClose(): void {
    if (halted || destroyed) return;
    find.close();
    // Does NOT move the document selection — the caret stays where it was.
    clearFindHighlights();
  }

  function exportToPdf(emit: PdfEmitter): Uint8Array {
    if (halted) throw new Error("exportToPdf: halted on incompatible document storage");
    const st = state;
    if (st === null) throw new Error("exportToPdf: no document is loaded");
    const tree = virtualTree;
    if (tree === null) {
      throw new Error(
        "exportToPdf: paginated layout required (float/clear documents are not yet exportable)",
      );
    }
    const coreState = st.state;
    const parentOf = makeBlockParentLookup(coreState);
    // The RAW core accessibility projection: the injected emitter maps it
    // to the PDF structure model. `null` (a document whose root is dropped —
    // should not occur for a real document root) ⇒ no /StructTreeRoot.
    const accessibilityTree = buildAccessibilityTree(coreState);
    // Document /Lang ← the first body text-run's content language. Empty ⇒ omit.
    const page0 = tree.getPage(0);
    const lang = firstBodyLanguage(page0) ?? "";
    return emit({
      pageCount: tree.plan.entries.length,
      getPage: (i) => tree.getPage(i),
      resolveInternalDestination: makeInternalDestinationResolver(
        coreState,
        tree,
        measurer,
        parentOf,
      ),
      outline: buildPdfOutline(coreState, tree, measurer, parentOf),
      accessibilityTree,
      ...(lang !== "" ? { lang } : {}),
    });
  }

  function destroy() {
    destroyed = true;
    for (const p of pendingProposals) p.resolve(rejectedProposal("controller destroyed"));
    pendingProposals = [];
    unsubscribeRemote?.();
    unsubscribeRemote = null;
    layoutTree = null;
    virtualTree = null;
    hasSelectionHighlight = false;
    selStart = null;
    selEnd = null;
    selSpanningFallback = false;
    find.close();
    pendingLayerOps = [];
    decoRectCache.clear();
    decorationPointer?.destroy();
    widgetOverlay.destroy();

    // Remove event listeners
    container.removeEventListener("mousedown", handleMouseDown);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    textarea.removeEventListener("keydown", handleKeyDown);
    textarea.removeEventListener("input", handleInput);
    textarea.removeEventListener("compositionstart", handleCompositionStart);
    textarea.removeEventListener("compositionend", handleCompositionEnd);
    textarea.removeEventListener("copy", handleCopy);
    textarea.removeEventListener("cut", handleCut);
    textarea.removeEventListener("paste", handlePaste);
    textarea.removeEventListener("focus", handleFocus);
    textarea.removeEventListener("blur", handleBlur);
    scrollParent.removeEventListener("scroll", handleScroll);

    // Clear timers
    stopBlink();
    cancelAnimationFrame(scrollRafId);
    cancelAnimationFrame(scrollAnimId);

    // Dispose the document History so its Y.UndoManager detaches its
    // afterTransaction observers from the Doc. `history` is the one long-lived
    // instance carried by reference across every EditorState, so disposing it
    // once here releases the observers a torn-down/recreated controller would
    // otherwise leak (collab / multi-view).
    state?.history.destroy();

    // Dispose the accessibility mirror host: detaches its
    // selectionchange + element listeners and removes the mirror element.
    if (mirrorHost !== null) {
      mirrorHost.destroy();
      mirrorHost = null;
    }

    // Cleanup DOM
    cleanupPageCanvases();
    if (singleCanvas) {
      singleCanvas.remove();
      singleCanvas = null;
      singleCtx = null;
    }
    if (spacerDiv) {
      spacerDiv.remove();
      spacerDiv = null;
    }
    textarea.remove();
  }

  function focus() {
    // The mirror is the focus/IME owner on the flag-on path; otherwise the
    // hidden textarea (default, byte-identical to today).
    if (mirrorHost !== null) mirrorHost.focus();
    else textarea.focus();
  }

  // Resolve a document `Position` to its caret's viewport-relative pixel rect
  // (CSS `position: fixed` space). Reuses the live caret-resolution path
  // (`resolvePixelPosition` → page-local x/y/height) and maps it to the viewport
  // via the container's bounding rect + the page's slot offset — the exact
  // mapping the textarea-caret positioning uses, minus the textarea write. A
  // pure read-only query: no mutation, no repaint. Returns null when nothing is
  // loaded / unresolvable.
  function getCaretRect(position: Position): CaretViewportRect | null {
    if (halted || destroyed || state === null || layoutTree === null) return null;
    const pos = resolvePixelPosition(
      state.state, position, layoutTree, measurer, state.caretPageHint,
    );
    if (pos === null) return null;
    const rect = container.getBoundingClientRect();
    // Paginated: the page sits at its slot's running-sum `top`; non-paginated
    // (no slots) the caret y is already container-relative.
    const slot = pageSlotGeoms[pos.pageIndex];
    const localTop = slot ? slot.top + pos.y : pos.y;
    return { left: rect.left + pos.x, top: rect.top + localTop, height: pos.height };
  }

  return {
    get halted() {
      return halted;
    },
    update,
    focus,
    destroy,
    getCaretRect,
    get version() {
      return state?.state ?? null;
    },
    mapPosition(position: Position, version: State, assoc?: Assoc): MappedPosition | null {
      if (halted || state === null) return null;
      return mapPositionFrom(mappingLog, state.state, version, position, assoc);
    },
    createAnchor(from: Position, to?: Position, anchorOptions: AnchorOptions & { readonly basedOn?: State } = {}): Anchor | null {
      if (halted || state === null) return null;
      const { basedOn, ...rest } = anchorOptions;
      return anchors.createAt(mappingLog, state.state, basedOn ?? state.state, from, to, rest);
    },
    propose(proposal: Proposal, proposeOptions: { readonly basedOn?: State } = {}): Promise<ProposeResult> {
      if (destroyed) return Promise.resolve(rejectedProposal("controller destroyed"));
      if (halted) return Promise.resolve(HALTED_RESULT);
      if (state === null) return Promise.resolve(rejectedProposal("no document yet"));
      // The HOST owns the state: the proposal is dispatched with the version its positions
      // refer to (default: the version this controller shows), and the host's reducer maps
      // it through the change chain and validates it — so it can never land on wrong text
      // even if the host has applied edits this controller has not seen yet. The promise
      // resolves with the reducer's verdict when an update carrying it arrives.
      const basedOn = proposeOptions.basedOn ?? state.state;
      return new Promise<ProposeResult>((resolve) => {
        pendingProposals.push({ proposal, resolve });
        dispatch({ type: "PROPOSE", proposal, basedOn });
      });
    },
    setSuggestionStyles(styleOf: SuggestionGroupStyle | null): void {
      if (destroyed) return;
      withLayers((doc) => layers.setSuggestionStyles(doc, styleOf));
      redrawDecorations();
    },
    runCommand(command: string | Command): boolean {
      if (halted || destroyed || state === null) return false;
      const resolved = resolveCommand(command, state.config.extensions);
      return resolved !== null && resolved(state, dispatch);
    },
    exportToPdf,
    get decorations() {
      // Before the first update, the queued host set (not yet validated against a document).
      if (state === null && pendingHost !== null) {
        const queued = pendingHost;
        return { decorations: queued, forBlock: EMPTY_DECORATION_SET.forBlock, blockIds: () => [] };
      }
      return layers.host;
    },
    setDecorations,
    setFindHighlights,
    clearFindHighlights,
    setCommentHighlights,
    clearCommentHighlights,
    setSuggestionHighlights,
    clearSuggestionHighlights,
    findStart,
    findStatus,
    replaceActive,
    replaceAll,
    findNext,
    findPrev,
    findClose,
  };
}

import {
  createInitialEditorState,
  createEditorStateFromState,
  reduceEditor,
  extractText,
  builtinEmbedSerializer,
  extractFragment,
  encodeHtml,
  encodeFragmentClip,
  TALEWEAVER_CLIP_MIME,
  selectionsEqual,
  initialSelectionForState,
  getBlock,
  createDecorationLayers,
  createFindSession,
  createMappingLog,
  mapDecorations,
  transitionMapping,
  findDecorationId,
  type FindMatchesOptions,
  type FindStatus,
  type Decoration,
  type DecorationSet,
  type TextMatch,
  type CommentHighlight,
  type SuggestionHighlight,
  type EditorExtensions,
  type Command,
  runKeyBinding,
  resolveCommand,
  modConventionFor,
  createAnchorSet,
  proposeResultOf,
  type ProposalOutcome,
  type SuggestionGroupStyle,
  type Proposal,
  type ProposeResult,
  mapPositionFrom,
  subscribeRemoteChanges,
  getYDoc,
  inspectDocument,
  resolveSuggestionRange,
  asBlockId,
  isCollapsed,
  caretBeforeMarkers,
  inlineContentLength,
  type SuggestionId,
  type Anchor,
  type AnchorOptions,
  type Assoc,
  type MappedPosition,
  type Position,
  escapeWouldChange,
  type EditorState,
  type EditorConfig,
  type EditorAction,
  type ComponentRegistry,
  type AttrRegistry,
  type PageConfig,
  type State,
  type IncompatibleDocumentReport,
  UNKNOWN_MAPPING,
} from "@taleweaver/core";
import { between, createSelectedParagraphs } from "./selected-paragraphs";
import { createCellClip } from "../dom-view/cell-clip";
import { browserHtmlParser } from "./html-parser";
import { createDigitalReconciler, type DigitalReconciler } from "./digital-reconciler";
import { mapBeforeInput, replacementInsertText } from "./map-before-input";
import { mapDigitalKey } from "./map-digital-key";
import { hopWidgets } from "./widget-caret";
import { END_ANCHOR_ATTR } from "../dom-view/render-to-dom";
import type { DomPoint } from "./digital-selection-bridge";
import { createDecorationPointer, type DecorationPointerEvent } from "./decoration-pointer";

export type { DecorationPointerEvent } from "./decoration-pointer";

export interface DigitalControllerOptions {
  readonly container: HTMLElement;
  readonly componentRegistry: ComponentRegistry;
  readonly attrRegistry: AttrRegistry;
  readonly containerWidth?: number;
  readonly pageConfig?: PageConfig;
  readonly doc?: Document;
  readonly initialState?: State;
  /**
   * Invoked after every `editorState` transition (programmatic `dispatch`, input,
   * selection, clipboard — all funnel through the one internal `dispatch`). Lets a
   * host (e.g. a React toolbar) mirror the controller's state. Fires only when the
   * state actually changed (guarded no-ops do not notify).
   *
   * Do NOT call `controller.dispatch(...)` synchronously from inside `onChange`:
   * `dispatch` is not re-entrant, so a dispatch that triggers another state change
   * recurses (`dispatch → onChange → dispatch → …`) with no cycle guard. Use it to
   * OBSERVE state (e.g. `setState(next)`), not to drive further edits.
   */
  readonly onChange?: (state: EditorState) => void;
  /** Initial host decorations (view-only; see {@link DigitalController.setDecorations}). */
  readonly decorations?: readonly Decoration[];
  /**
   * Pointer events on decorated content: `enter`/`leave` as the pointer moves over a
   * decoration's DOM, `click` on it. Reports the live (edit-mapped) decoration and its
   * on-screen rects. Fires for built-in highlights too (ids prefixed `tw-`).
   */
  readonly onDecorationPointer?: (event: DecorationPointerEvent) => void;
  /**
   * Host extensions: commands, keymap (consulted before the defaults; `Mod` = Cmd
   * on Mac / Ctrl elsewhere), input rules and triggers.
   */
  readonly extensions?: EditorExtensions;
  /**
   * Collaboration: `"observe"` (default) — apply every peer update that lands in this
   * document's Y.Doc (`APPLY_FOREIGN_CHANGE`); `"ignore"` — don't. Exactly ONE controller
   * per document should observe; any other controller over the same document passes
   * `"ignore"` (else each would apply the same peer change).
   */
  readonly remoteChanges?: "observe" | "ignore";
  /**
   * The document is incompatible (`report.reason`: a legacy client wrote into the frozen
   * legacy root — its blocks and current legacy text are surfaced, not merged; a peer
   * raised the schema past this engine's; a second Yjs instance; or a replacement's
   * document is not upgraded yet): the controller HALTS — `contenteditable` off, every
   * action and further remote change ignored, the last good render kept, every member a
   * defined no-op that never touches the Y.Doc. Called once per halt — and again, while
   * still halted, when a legacy write lands after `onDocumentCompatible` was reported.
   * Do not keep reading the halted State with core read functions. While halted, setters
   * and clears of decorations / highlights / styles are no-ops (`decorations` keeps the
   * last good set). Exit: the host calls {@link DigitalController.replaceDocument} with a
   * State holding no legacy storage (same Y.Doc or another).
   */
  readonly onIncompatibleDocument?: (report: IncompatibleDocumentReport) => void;
  /**
   * While HALTED on a NOT-YET-UPGRADED document ("legacy-schema"), it was upgraded (by
   * this host or an upgraded peer — any transaction is re-checked): the host can now
   * resume with {@link DigitalController.replaceDocument} and a fresh State over the same
   * Y.Doc (`createState({ rootId, doc })`). Called once per halt; never for a sticky halt.
   */
  readonly onDocumentCompatible?: () => void;
}

export interface DigitalController {
  readonly editorState: EditorState;
  /** The host decoration layer, mapped through every edit since it was set. */
  readonly decorations: DecorationSet;
  /** True while halted on incompatible (legacy) document storage — see `onIncompatibleDocument`. */
  readonly halted: boolean;
  dispatch(action: EditorAction): void;
  /**
   * Replace the document: the editor shows `state` (a fresh history, the caret at its
   * start, the mapping log restarted — older versions no longer map, anchors die). Every
   * decoration layer and the find session are dropped (the host sets them again). This
   * is also how a halted controller resumes (after `upgradeDocument`), on the same
   * Y.Doc or another.
   */
  replaceDocument(state: State): void;
  /**
   * Replace the host decorations. They stay attached through later edits (position-mapped)
   * until replaced; a decoration whose range is deleted disappears. Only blocks whose drawn
   * decorations change are re-rendered.
   *
   * `basedOn` is the document `State` the decorations were computed against (default: the
   * current one). A host that computes asynchronously passes it so its result is mapped
   * through the edits made meanwhile; if that State is too old to map (outside the
   * controller's mapping log) the decorations are dropped rather than drawn on the wrong text.
   */
  setDecorations(decorations: readonly Decoration[], basedOn?: State): void;
  /**
   * Highlight find matches (`activeIndex` emphasized); mapped through edits until cleared.
   * Find highlights are ONE layer: this writes it directly, `findStart` takes it over and the
   * session owns it while open, and `findClose` clears it.
   */
  setFindHighlights(matches: readonly TextMatch[], activeIndex: number): void;
  clearFindHighlights(): void;
  /** Highlight comment ranges; re-resolved from live state on every edit. */
  setCommentHighlights(highlights: readonly CommentHighlight[]): void;
  clearCommentHighlights(): void;
  /** Highlight pending suggestion ranges; re-resolved from live state on every edit. */
  setSuggestionHighlights(highlights: readonly SuggestionHighlight[]): void;
  clearSuggestionHighlights(): void;
  /**
   * The on-screen rects of a pending suggestion (the counterpart of print
   * `getSuggestionRangeRects`): its text's client rects + every boundary ¶ glyph naming
   * it (a paragraph / section-break suggestion covers no character). `[]` when the
   * suggestion has no live range.
   */
  suggestionRects(suggestionId: SuggestionId): DOMRect[];
  /**
   * Find / replace (same contract as the print controller): `findStart` highlights every
   * match, activates the first at/after the caret and scrolls it into view; matches are
   * re-found after every edit while the session is open. Never moves the caret.
   */
  findStart(query: string, options?: FindMatchesOptions): FindStatus;
  findNext(): FindStatus;
  findPrev(): FindStatus;
  findClose(): void;
  findStatus(): FindStatus;
  /** Replace the active match (one undo step); the session re-finds afterwards. */
  replaceActive(replacement: string): FindStatus;
  /** Replace every match (one undo step). */
  replaceAll(replacement: string): FindStatus;
  /** The current document version (an opaque token for `mapPosition` / `createAnchor`). */
  readonly version: State;
  /**
   * Map `position` from an earlier `version` to the current document: `{ position, deleted }`,
   * or null once that version has aged out of the controller's mapping log.
   */
  mapPosition(position: Position, version: State, assoc?: Assoc): MappedPosition | null;
  /**
   * Anchor a point (`to` omitted) or range that follows every later edit (local, undo /
   * redo, collaborative). `basedOn`: the version the positions refer to (default: the
   * current one); null when that version can no longer be mapped or the content is gone.
   */
  createAnchor(from: Position, to?: Position, options?: AnchorOptions & { readonly basedOn?: State }): Anchor | null;
  /**
   * Offer `proposal` as ONE suggestion group (works in any editing mode; the caret is
   * only rebased). `basedOn`: the version its positions refer to — mapped through the
   * edits made since; `{ ok: false, reason: "stale" }` when its ranges changed meanwhile,
   * `"rejected"` when it overlaps pending suggestions / itself or is invalid ("controller
   * destroyed" after `destroy`). Resolves at once with the reducer's verdict (same
   * promise shape as the print controller, whose host owns the state).
   */
  propose(proposal: Proposal, options?: { readonly basedOn?: State }): Promise<ProposeResult>;
  /**
   * Host per-group styling of suggestions (e.g. per `metadata.source`), kept live through
   * proposals, accept / reject and undo. `null` clears it.
   */
  setSuggestionStyles(styleOf: SuggestionGroupStyle | null): void;
  /**
   * Run a host command — by name (`extensions.commands`) or directly — against the
   * current state with this controller's `dispatch`. Returns whether it ran.
   */
  runCommand(command: string | Command): boolean;
  focus(): void;
  destroy(): void;
}

export function createDigitalController(options: DigitalControllerOptions): DigitalController {
  const doc = options.doc ?? document;
  const win = doc.defaultView ?? window;
  const container = options.container;
  const config: EditorConfig = {
    componentRegistry: options.componentRegistry,
    attrRegistry: options.attrRegistry,
    containerWidth: options.containerWidth ?? 800,
    pageConfig: options.pageConfig,
    htmlParser: browserHtmlParser,
    ...(options.extensions !== undefined ? { extensions: options.extensions } : {}),
  };

  let editorState: EditorState =
    options.initialState !== undefined
      ? createEditorStateFromState(options.initialState, initialSelectionForState(options.initialState), config)
      : createInitialEditorState(config);

  let isComposing = false;
  let destroyed = false;
  const modConvention = modConventionFor(win.navigator.userAgent);
  const mac = modConvention === "meta";

  // The reconciler owns the single selection bridge (created on its `mount`, wired to its
  // authoritative `blockElMap`). The controller reuses it via `reconciler.getBridge()` — there is
  // no second bridge. It is null only before `mount`; every event handler runs post-mount.
  const reconciler: DigitalReconciler = createDigitalReconciler(
    options.componentRegistry,
    options.attrRegistry,
    doc,
    (id, el) => {
      selected.mounted(id, el);
      cellClip.watch(el);
    },
  );
  const isMounted = (el: HTMLElement): boolean => {
    const id = el.getAttribute("data-block-id");
    return id !== null && reconciler.blockElement(asBlockId(id)) === el;
  };
  const cellClip = createCellClip(doc, isMounted);
  const selected = createSelectedParagraphs((id) => reconciler.blockElement(id), (el) => cellClip.watch(el));

  let layers = createDecorationLayers();
  if (options.decorations !== undefined) layers.setHost(editorState.state, options.decorations);
  const find = createFindSession();
  const log = createMappingLog();
  log.reset(editorState.state);
  const anchors = createAnchorSet();

  // HALTED (a peer update carried legacy inline storage): controller-local runtime state
  // — the reducer knows nothing of it. Layer setters are no-ops meanwhile (deriving reads
  // the doc); `decorations` keeps the last good set.
  let halted = false;
  const EMPTY_FIND: FindStatus = { total: 0, activeIndex: -1 };

  /** `onDocumentCompatible` was reported since the last `onIncompatibleDocument`. */
  let toldCompatible = false;

  /** Halt (once per halt — again while still halted only if the host was told "compatible" since). */
  function halt(report: IncompatibleDocumentReport): void {
    if (destroyed) return;
    if (halted) {
      if (!toldCompatible) return;
      toldCompatible = false;
      options.onIncompatibleDocument?.(report);
      return;
    }
    halted = true;
    container.contentEditable = "false";
    // An in-flight IME composition is abandoned: its composed DOM text is dropped and the
    // DOM shows the last good projection again (no document read).
    if (isComposing) {
      isComposing = false;
      reconciler.restore();
    }
    options.onIncompatibleDocument?.(report);
  }

  /** Run a decoration-layer setter now (and redraw); a no-op while halted. */
  function layerOp(op: (s: State) => void): void {
    if (halted) return;
    op(editorState.state);
    redraw();
  }

  function dispatch(action: EditorAction): void {
    if (halted) return;
    const prev = editorState;
    editorState = reduceEditor(editorState, action);
    if (prev.state !== editorState.state) {
      const mapping = transitionMapping(prev, editorState);
      log.record(prev.state, editorState.state, mapping);
      layers.advance(prev, editorState, mapping);
      anchors.advance(prev.state, editorState.state, mapping);
      if (find.active) {
        // Re-find only in the edited blocks; redraw only the blocks whose matches changed.
        const { changedBlocks } = find.refresh(editorState.state, mapping);
        if (changedBlocks === null) layers.setFind(editorState.state, find.matches(), find.activeIndex());
        else layers.patchFind(editorState.state, find.matches(), find.activeIndex(), changedBlocks);
      }
    }
    if (prev.state !== editorState.state) followRemoteDoc();
    reconciler.reconcile(prev, editorState, isComposing, layers.merged);
    selected.sync(editorState);
    pointer?.sync();
    if (editorState !== prev) options.onChange?.(editorState);
  }

  /** Re-draw after a decoration-only change (no state transition). */
  function redraw(): void {
    reconciler.reconcile(editorState, editorState, isComposing, layers.merged);
    selected.sync(editorState);
    pointer?.sync();
  }

  function onBeforeInput(e: InputEvent): void {
    if (halted) {
      e.preventDefault();
      return;
    }
    if (isComposing && e.inputType !== "insertCompositionText") return;
    // C1: the `paste` ClipboardEvent handler is the single paste source. Suppress the browser's
    // native mutation from this beforeinput but do NOT dispatch — `onPaste` already did.
    if (e.inputType === "insertFromPaste") {
      e.preventDefault();
      return;
    }
    const bridge = reconciler.getBridge();
    if (bridge === null) return;
    const action = mapBeforeInput(e, { selection: editorState.selection, domToPosition: bridge.domToPosition });
    // C2: only cancel the browser default for gestures we actually handle. Unrecognized inputTypes
    // (mapped to null) fall through to native handling instead of becoming silent no-ops.
    if (action !== null) {
      e.preventDefault();
      dispatch(action);
      const replacement = replacementInsertText(e);
      if (replacement !== null && replacement !== "") dispatch({ type: "INSERT_TEXT", text: replacement, userInput: true });
    }
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (halted) return;
    // Host keymap BEFORE the defaults (and never mid-composition: the IME owns
    // keys like Enter until it commits). A command that runs claims the key; an
    // unbound (`null`) key is swallowed so neither our default nor the browser's runs.
    if (!isComposing && !e.isComposing) {
      const outcome = runKeyBinding(options.extensions, e, modConvention, editorState, dispatch);
      if (outcome !== "default") {
        e.preventDefault();
        return;
      }
    }
    // Paste-without-formatting (Ctrl/Cmd+Shift+V): async path — must be
    // intercepted before mapDigitalKey (which returns null for this chord and
    // would silently drop the event). Reads text/plain ONLY from the Clipboard
    // API and dispatches PASTE { text } with no html/clip.
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
    if (e.key.startsWith("Arrow") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const sel = win.getSelection();
      const focusEl = sel?.focusNode instanceof Element ? sel.focusNode : (sel?.focusNode?.parentElement ?? null);
      const forward = sel === null || focusEl === null ? null : inlineArrowForward(e.key, win.getComputedStyle(focusEl));
      if (sel !== null && forward !== null) {
        if (e.shiftKey || isCollapsed(editorState.selection)) hopMarkers(sel, forward, e.shiftKey);
        hopWidgets(sel, forward ? "forward" : "backward", e.shiftKey);
      }
    }
    // Tab routing is context-sensitive: tell the mapper whether the caret's focus block is a
    // list-item so Tab nests the list (LIST_INDENT) rather than inserting a tab.
    const focusBlock = getBlock(editorState.state, editorState.selection.focus.blockId);
    const action = mapDigitalKey(e, { mac, inListItem: focusBlock?.type === "list-item" });
    if (action === null) return;
    // Claim Escape only when it dismisses something (an object selection or a host
    // trigger); otherwise it must reach the page (e.g. close a containing dialog).
    if (action.type === "ESCAPE" && !escapeWouldChange(editorState, options.componentRegistry)) return;
    e.preventDefault();
    dispatch(action);
  }
  /**
   * Structural markers and generated END anchors carry no caret stop in the model, but the
   * browser gives each one: the DOM caret can sit before a marker the model stands after
   * (re-reading it changes nothing, so it is not re-placed), and a caret past an END anchor
   * is pulled back before it. Before the browser's default arrow move, put the DOM caret
   * past them in the direction of travel, so the move advances one real character (or
   * leaves the ¶).
   */
  function hopMarkers(sel: Selection, forward: boolean, extend: boolean): void {
    const bridge = reconciler.getBridge();
    const focus = editorState.selection.focus;
    const el = reconciler.blockElement(focus.blockId);
    const content = getBlock(editorState.state, focus.blockId)?.inlineContent ?? null;
    if (bridge === null || el === null || content === null) return;
    const before = caretBeforeMarkers(editorState.state, focus);
    let point: DomPoint | null = null;
    if (!forward) {
      if (before.offset < focus.offset) point = bridge.pointAt(before);
    } else {
      const anchors = el.querySelectorAll(`:scope > [${END_ANCHOR_ATTR}]`);
      const last = anchors.item(anchors.length - 1);
      if (last !== null && focus.offset === inlineContentLength(content)) {
        point = { node: el, offset: Array.prototype.indexOf.call(el.childNodes, last) + 1 };
      } else if (before.offset < focus.offset) {
        point = bridge.pointAt(focus);
      }
    }
    if (point === null) return;
    if (extend) sel.extend(point.node, point.offset);
    else sel.collapse(point.node, point.offset);
  }
  function onSelectionChange(): void {
    if (halted || isComposing) return;
    const bridge = reconciler.getBridge();
    if (bridge === null) return;
    const span = bridge.readDomSelection();
    if (span === null) return;
    // A caret in / after a generated ¶: keep it before the mark.
    if (isCollapsed(span)) bridge.normalizeCaret(span.focus);
    if (selectionsEqual(span, editorState.selection)) return;
    dispatch({ type: "SET_SELECTION", selection: span });
  }
  function onCompositionStart(): void {
    isComposing = true;
  }
  function onCompositionEnd(e: CompositionEvent): void {
    isComposing = false;
    if (halted) {
      reconciler.restore(); // drop what the IME committed into the DOM meanwhile
      return;
    }
    // `CompositionEvent.data` can be `null` at runtime (e.g. a cancelled composition).
    // `e.data !== ""` is `true` for `null`, so guard against null too — dispatching INSERT_TEXT
    // with a null `text` crashes the reducer (Y.Text.insert rejects null).
    if (e.data !== null && e.data !== "") dispatch({ type: "INSERT_TEXT", text: e.data, userInput: true });
    // Work deferred while composing (a decoration change for the composed block, a peer
    // change's rebased selection — the DOM selection is never touched mid-composition)
    // is applied now that the composition is over.
    else redraw();
  }
  function onCopy(e: ClipboardEvent): void {
    e.preventDefault();
    if (halted) return; // empty clipboard: copying reads the (incompatible) document
    // copy:"drop" marks are stripped from what leaves the editor.
    const frag = extractFragment(editorState.state, editorState.selection);
    e.clipboardData?.setData(
      "text/plain",
      extractText(editorState.state, editorState.selection, builtinEmbedSerializer, "suggesting"),
    );
    e.clipboardData?.setData("text/html", encodeHtml(frag));
    e.clipboardData?.setData(TALEWEAVER_CLIP_MIME, encodeFragmentClip(frag));
  }
  function onCut(e: ClipboardEvent): void {
    onCopy(e);
    if (halted) return;
    dispatch({ type: "DELETE_RANGE", span: editorState.selection });
  }
  function onPaste(e: ClipboardEvent): void {
    e.preventDefault();
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

  // Collaboration: a peer's change applied to this document's Y.Doc (Y.applyUpdate from
  // a provider) is reconciled at once — selection rebased, decorations / anchors /
  // triggers / mapping log advanced, DOM patched — through the ordinary dispatch.
  // Dispatched synchronously from Yjs `afterTransaction` — i.e. inside the provider's
  // `Y.applyUpdate` call. Re-subscribed whenever the document's Y.Doc changes.
  let remoteDoc: unknown = null;
  let unsubscribeRemote: (() => void) | null = null;
  // Every controller shape-checks peer updates (legacy storage halts it), whether or
  // not it applies them (`remoteChanges: "ignore"`).
  function followRemoteDoc(force = false, watched: State = editorState.state, startHalted = false): void {
    const doc = getYDoc(watched);
    if (doc === remoteDoc && !force) return;
    unsubscribeRemote?.();
    remoteDoc = doc;
    unsubscribeRemote = subscribeRemoteChanges(
      watched,
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
  followRemoteDoc();

  container.contentEditable = "true";
  reconciler.mount(container, editorState, layers.merged);
  selected.sync(editorState);
  const pointer =
    options.onDecorationPointer !== undefined
      ? createDecorationPointer(container, () => layers.merged, options.onDecorationPointer, (id) => reconciler.blockElement(id))
      : null;

  container.addEventListener("beforeinput", onBeforeInput);
  container.addEventListener("keydown", onKeyDown);
  doc.addEventListener("selectionchange", onSelectionChange);
  container.addEventListener("compositionstart", onCompositionStart);
  container.addEventListener("compositionend", onCompositionEnd);
  container.addEventListener("copy", onCopy);
  container.addEventListener("cut", onCut);
  container.addEventListener("paste", onPaste);

  /** Show the session's matches and scroll the active one into view (never moves the caret). */
  function showFind(scroll: boolean): FindStatus {
    layers.setFind(editorState.state, find.matches(), find.activeIndex());
    redraw();
    if (scroll) {
      const match = find.matches()[find.activeIndex()];
      const id = match === undefined ? null : findDecorationId(match);
      const block = match === undefined ? null : reconciler.blockElement(match.blockId);
      const el = Array.from(block?.querySelectorAll("[data-tw-deco]") ?? []).find((e) => e.getAttribute("data-tw-deco") === id);
      // Optional call: non-browser DOMs (jsdom) do not implement scrollIntoView.
      if (el instanceof HTMLElement) el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
    return find.status();
  }

  function focus(): void {
    container.focus();
  }

  function replaceDocument(state: State): void {
    if (destroyed) return;
    // The replacement must hold no legacy storage (the load assertion; O(blocks), only
    // here) — checked even when not halted (legacy may land between `createState` and
    // here). Refused, its legacy storage went unseen (not halted yet, another document,
    // or a local write after "compatible"): halt (or report again if the host was told
    // "compatible") and watch this document halted — so its upgrade is reported. The
    // current editor stays as it is.
    const legacy = inspectDocument(getYDoc(state)).legacyBlocks;
    if (legacy.length > 0) {
      if (!halted || getYDoc(state) !== remoteDoc || toldCompatible) {
        halt({ reason: "legacy-schema", legacyBlocks: legacy, legacyText: {} });
        followRemoteDoc(true, state, true);
      }
      return;
    }
    const prev = editorState;
    // Built before the old History is destroyed: a throwing build leaves the editor intact.
    const next = createEditorStateFromState(state, initialSelectionForState(state), config);
    prev.history.destroy(); // the old document's undo manager detaches from its Y.Doc
    editorState = next;
    halted = false;
    toldCompatible = false;
    container.contentEditable = "true";
    // Older versions can no longer be mapped: the log restarts and anchors see an unknown
    // transition; every layer and the find session are dropped (the host sets them again).
    log.reset(editorState.state);
    anchors.advance(prev.state, editorState.state, UNKNOWN_MAPPING);
    layers = createDecorationLayers();
    find.close();
    followRemoteDoc(true); // afresh, even on the same Y.Doc
    reconciler.reconcile(prev, editorState, isComposing, layers.merged);
    selected.sync(editorState);
    pointer?.sync();
    options.onChange?.(editorState);
  }

  function destroy(): void {
    destroyed = true;
    unsubscribeRemote?.();
    unsubscribeRemote = null;
    container.removeEventListener("beforeinput", onBeforeInput);
    container.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("selectionchange", onSelectionChange);
    container.removeEventListener("compositionstart", onCompositionStart);
    container.removeEventListener("compositionend", onCompositionEnd);
    container.removeEventListener("copy", onCopy);
    container.removeEventListener("cut", onCut);
    container.removeEventListener("paste", onPaste);
    pointer?.destroy();
    cellClip.disconnect();
    reconciler.destroy();
    container.contentEditable = "false";
  }

  return {
    get editorState() {
      return editorState;
    },
    get decorations() {
      return layers.host;
    },
    get halted() {
      return halted;
    },
    dispatch,
    replaceDocument,
    setDecorations(decorations, basedOn) {
      if (halted) return; // a no-op: `decorations` keeps the last good set
      let current: readonly Decoration[] = decorations;
      if (basedOn !== undefined && basedOn !== editorState.state) {
        const mapping = log.mappingFrom(basedOn);
        current = mapping === null ? [] : mapDecorations(decorations, mapping, editorState.state);
      }
      layerOp((s) => layers.setHost(s, current));
    },
    setFindHighlights(matches, activeIndex) {
      layerOp((s) => layers.setFind(s, matches, activeIndex));
    },
    clearFindHighlights() {
      layerOp((s) => layers.setFind(s, [], -1));
    },
    setCommentHighlights(highlights) {
      layerOp((s) => layers.setComments(s, highlights));
    },
    clearCommentHighlights() {
      layerOp((s) => layers.setComments(s, null));
    },
    setSuggestionHighlights(highlights) {
      layerOp((s) => layers.setSuggestions(s, highlights));
    },
    clearSuggestionHighlights() {
      layerOp((s) => layers.setSuggestions(s, null));
    },
    suggestionRects(suggestionId) {
      if (halted) return [];
      const range = resolveSuggestionRange(editorState.state, suggestionId);
      const bridge = reconciler.getBridge();
      if (range === null || bridge === null) return [];
      // The tracked ¶ glyphs naming the suggestion (a ¶'s range covers no character), in
      // the range's blocks: O(its blocks).
      const generated: DOMRect[] = [];
      const blocks = [...(between(editorState.state, range.start.blockId, range.end.blockId, { steps: Infinity }) ?? []), range.end.blockId];
      for (const id of blocks) {
        const glyph = reconciler.blockElement(id)?.querySelector(":scope > .tw-break-mark")?.firstElementChild ?? null;
        if (glyph === null || !(glyph.parentElement?.getAttribute("data-tw-suggestion-id") ?? "").split(" ").includes(suggestionId)) continue;
        addRect(generated, glyph.getBoundingClientRect());
      }
      const within = (r: DOMRect, g: DOMRect): boolean =>
        r.left >= g.left && r.top >= g.top && r.right <= g.right && r.bottom <= g.bottom;
      const out: DOMRect[] = [];
      const a = bridge.pointAt(range.start);
      const b = bridge.pointAt(range.end);
      if (a !== null && b !== null) {
        const r = container.ownerDocument.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        // jsdom has no layout (no Range rects); browsers always do. Zero-width rects (a
        // caret-like edge, a generated anchor, the empty slice at a block start) and rects
        // inside a ¶ glyph / section-break label (added once below) are not highlight area.
        if (typeof r.getClientRects === "function") {
          for (const rect of Array.from(r.getClientRects())) {
            if (rect.width > 0 && rect.height > 0 && !generated.some((g) => within(rect, g))) addRect(out, rect);
          }
        }
      }
      for (const g of generated) addRect(out, g);
      return out;
    },
    findStart(query, findOptions) {
      if (halted) return EMPTY_FIND;
      find.start(editorState.state, editorState.selection.focus, query, findOptions);
      return showFind(true);
    },
    findNext() {
      if (halted) return EMPTY_FIND;
      find.next();
      return showFind(true);
    },
    findPrev() {
      if (halted) return EMPTY_FIND;
      find.prev();
      return showFind(true);
    },
    findClose() {
      if (halted) return;
      find.close();
      layers.setFind(editorState.state, [], -1);
      redraw();
    },
    findStatus: () => (halted ? EMPTY_FIND : find.status()),
    replaceActive(replacement) {
      if (halted) return EMPTY_FIND;
      const action = find.replaceActiveAction(replacement);
      if (action !== null) dispatch(action);
      return find.status();
    },
    replaceAll(replacement) {
      if (halted) return EMPTY_FIND;
      const action = find.replaceAllAction(replacement);
      if (action !== null) dispatch(action);
      return find.status();
    },
    get version() {
      return editorState.state;
    },
    mapPosition(position, version, assoc) {
      if (halted) return null;
      return mapPositionFrom(log, editorState.state, version, position, assoc);
    },
    createAnchor(from, to, anchorOptions = {}) {
      if (halted) return null;
      const { basedOn, ...rest } = anchorOptions;
      return anchors.createAt(log, editorState.state, basedOn ?? editorState.state, from, to, rest);
    },
    propose(proposal, proposeOptions = {}) {
      if (destroyed) return Promise.resolve({ ok: false, reason: "rejected", problem: { kind: "invalid", message: "controller destroyed" } });
      if (halted) return Promise.resolve({ ok: false, reason: "halted" });
      // The reducer maps (from `basedOn`) and validates authoritatively; this controller
      // owns the state, so its verdict is already known — resolve with it. Another PROPOSE
      // may land before we read (e.g. from onChange), so find OUR verdict in the chain: the
      // oldest one for this object dispatched after `before`.
      const before = editorState.lastProposal?.seq ?? 0;
      dispatch({
        type: "PROPOSE",
        proposal,
        ...(proposeOptions.basedOn !== undefined ? { basedOn: proposeOptions.basedOn } : {}),
      });
      let ours: ProposalOutcome | undefined;
      for (let o = editorState.lastProposal; o !== undefined && o.seq > before; o = o.prior) {
        if (o.proposal === proposal) ours = o;
      }
      return Promise.resolve(proposeResultOf(ours));
    },
    setSuggestionStyles(styleOf) {
      layerOp((s) => layers.setSuggestionStyles(s, styleOf));
    },
    runCommand(command) {
      if (halted) return false;
      const resolved = resolveCommand(command, options.extensions);
      return resolved !== null && resolved(editorState, dispatch);
    },
    focus,
    destroy,
  };
}

/** Push `r` unless an identical rect is already in `rects`. */
function addRect(rects: DOMRect[], r: DOMRect): void {
  if (!rects.some((x) => x.left === r.left && x.top === r.top && x.width === r.width && x.height === r.height)) rects.push(r);
}

/**
 * Whether arrow `key` moves FORWARD along the inline axis of text styled `style`, or null
 * for a block-axis key (the browser's mapping: horizontal → Left / Right, vertical →
 * Up / Down; ArrowRight / ArrowDown run with the inline direction; `direction: rtl`
 * reverses it).
 */
function inlineArrowForward(key: string, style: CSSStyleDeclaration): boolean | null {
  const mode = style.getPropertyValue("writing-mode");
  const vertical = mode.startsWith("vertical");
  const ahead = vertical ? "ArrowDown" : "ArrowRight";
  const back = vertical ? "ArrowUp" : "ArrowLeft";
  if (key !== ahead && key !== back) return null;
  return (key === ahead) !== (style.direction === "rtl");
}

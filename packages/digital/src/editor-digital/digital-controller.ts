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
  type EditorState,
  type EditorConfig,
  type EditorAction,
  type ComponentRegistry,
  type AttrRegistry,
  type PageConfig,
  type State,
} from "@taleweaver/core";
import { browserHtmlParser } from "./html-parser";
import { createDigitalReconciler, type DigitalReconciler } from "./digital-reconciler";
import { mapBeforeInput, replacementInsertText } from "./map-before-input";
import { mapDigitalKey } from "./map-digital-key";
import { hopWidgets } from "./widget-caret";
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
}

export interface DigitalController {
  readonly editorState: EditorState;
  /** The host decoration layer, mapped through every edit since it was set. */
  readonly decorations: DecorationSet;
  dispatch(action: EditorAction): void;
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
  };

  let editorState: EditorState =
    options.initialState !== undefined
      ? createEditorStateFromState(options.initialState, initialSelectionForState(options.initialState), config)
      : createInitialEditorState(config);

  let isComposing = false;
  const mac = /Mac|iPhone|iPad/i.test(win.navigator.userAgent);

  // The reconciler owns the single selection bridge (created on its `mount`, wired to its
  // authoritative `blockElMap`). The controller reuses it via `reconciler.getBridge()` — there is
  // no second bridge. It is null only before `mount`; every event handler runs post-mount.
  const reconciler: DigitalReconciler = createDigitalReconciler(
    options.componentRegistry,
    options.attrRegistry,
    doc,
  );

  const layers = createDecorationLayers();
  if (options.decorations !== undefined) layers.setHost(editorState.state, options.decorations);
  const find = createFindSession();
  const log = createMappingLog();
  log.reset(editorState.state);

  function dispatch(action: EditorAction): void {
    const prev = editorState;
    editorState = reduceEditor(editorState, action, config);
    if (prev.state !== editorState.state) {
      const mapping = transitionMapping(prev, editorState);
      log.record(prev.state, editorState.state, mapping);
      layers.advance(prev, editorState, mapping);
      if (find.active) {
        // Re-find only in the edited blocks; redraw only the blocks whose matches changed.
        const { changedBlocks } = find.refresh(editorState.state, mapping);
        if (changedBlocks === null) layers.setFind(editorState.state, find.matches(), find.activeIndex());
        else layers.patchFind(editorState.state, find.matches(), find.activeIndex(), changedBlocks);
      }
    }
    reconciler.reconcile(prev, editorState, isComposing, layers.merged);
    pointer?.sync();
    if (editorState !== prev) options.onChange?.(editorState);
  }

  /** Re-draw after a decoration-only change (no state transition). */
  function redraw(): void {
    reconciler.reconcile(editorState, editorState, isComposing, layers.merged);
    pointer?.sync();
  }

  function onBeforeInput(e: InputEvent): void {
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
      if (replacement !== null && replacement !== "") dispatch({ type: "INSERT_TEXT", text: replacement });
    }
  }
  function onKeyDown(e: KeyboardEvent): void {
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
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const sel = win.getSelection();
      // Logical direction: in an RTL block ArrowRight moves backward.
      const focusEl = sel?.focusNode instanceof Element ? sel.focusNode : (sel?.focusNode?.parentElement ?? null);
      const rtl = focusEl !== null && win.getComputedStyle(focusEl).direction === "rtl";
      const forward = (e.key === "ArrowRight") !== rtl;
      if (sel !== null) hopWidgets(sel, forward ? "forward" : "backward", e.shiftKey);
    }
    // Tab routing is context-sensitive: tell the mapper whether the caret's focus block is a
    // list-item so Tab nests the list (LIST_INDENT) rather than inserting a tab.
    const focusBlock = getBlock(editorState.state, editorState.selection.focus.blockId);
    const action = mapDigitalKey(e, { mac, inListItem: focusBlock?.type === "list-item" });
    if (action === null) return;
    e.preventDefault();
    dispatch(action);
  }
  function onSelectionChange(): void {
    if (isComposing) return;
    const bridge = reconciler.getBridge();
    if (bridge === null) return;
    const span = bridge.readDomSelection();
    if (span === null || selectionsEqual(span, editorState.selection)) return;
    dispatch({ type: "SET_SELECTION", selection: span });
  }
  function onCompositionStart(): void {
    isComposing = true;
  }
  function onCompositionEnd(e: CompositionEvent): void {
    isComposing = false;
    // D1: `CompositionEvent.data` can be `null` at runtime (e.g. a cancelled composition).
    // `e.data !== ""` is `true` for `null`, so guard against null too — dispatching INSERT_TEXT
    // with a null `text` crashes the reducer (Y.Text.insert rejects null).
    if (e.data !== null && e.data !== "") dispatch({ type: "INSERT_TEXT", text: e.data });
    // A decoration change that landed mid-composition was deferred for the composed block;
    // draw it now that the composition is over.
    else if (reconciler.hasPending()) redraw();
  }
  function onCopy(e: ClipboardEvent): void {
    e.preventDefault();
    // copy:"drop" marks are stripped from what leaves the editor.
    const frag = extractFragment(editorState.state, editorState.selection, options.attrRegistry);
    e.clipboardData?.setData(
      "text/plain",
      extractText(editorState.state, editorState.selection, builtinEmbedSerializer, "suggesting"),
    );
    e.clipboardData?.setData("text/html", encodeHtml(frag));
    e.clipboardData?.setData(TALEWEAVER_CLIP_MIME, encodeFragmentClip(frag));
  }
  function onCut(e: ClipboardEvent): void {
    onCopy(e);
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

  container.contentEditable = "true";
  reconciler.mount(container, editorState, layers.merged);
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

  function destroy(): void {
    container.removeEventListener("beforeinput", onBeforeInput);
    container.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("selectionchange", onSelectionChange);
    container.removeEventListener("compositionstart", onCompositionStart);
    container.removeEventListener("compositionend", onCompositionEnd);
    container.removeEventListener("copy", onCopy);
    container.removeEventListener("cut", onCut);
    container.removeEventListener("paste", onPaste);
    pointer?.destroy();
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
    dispatch,
    setDecorations(decorations, basedOn) {
      let current: readonly Decoration[] = decorations;
      if (basedOn !== undefined && basedOn !== editorState.state) {
        const mapping = log.mappingFrom(basedOn);
        current = mapping === null ? [] : mapDecorations(decorations, mapping, editorState.state);
      }
      layers.setHost(editorState.state, current);
      redraw();
    },
    setFindHighlights(matches, activeIndex) {
      layers.setFind(editorState.state, matches, activeIndex);
      redraw();
    },
    clearFindHighlights() {
      layers.setFind(editorState.state, [], -1);
      redraw();
    },
    setCommentHighlights(highlights) {
      layers.setComments(editorState.state, highlights);
      redraw();
    },
    clearCommentHighlights() {
      layers.setComments(editorState.state, null);
      redraw();
    },
    setSuggestionHighlights(highlights) {
      layers.setSuggestions(editorState.state, highlights);
      redraw();
    },
    clearSuggestionHighlights() {
      layers.setSuggestions(editorState.state, null);
      redraw();
    },
    findStart(query, findOptions) {
      find.start(editorState.state, editorState.selection.focus, query, findOptions);
      return showFind(true);
    },
    findNext() {
      find.next();
      return showFind(true);
    },
    findPrev() {
      find.prev();
      return showFind(true);
    },
    findClose() {
      find.close();
      layers.setFind(editorState.state, [], -1);
      redraw();
    },
    findStatus: () => find.status(),
    replaceActive(replacement) {
      const action = find.replaceActiveAction(replacement);
      if (action !== null) dispatch(action);
      return find.status();
    },
    replaceAll(replacement) {
      const action = find.replaceAllAction(replacement);
      if (action !== null) dispatch(action);
      return find.status();
    },
    focus,
    destroy,
  };
}

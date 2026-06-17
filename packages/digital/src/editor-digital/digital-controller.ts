import {
  createInitialEditorState,
  createEditorStateFromState,
  reduceEditor,
  extractText,
  builtinEmbedSerializer,
  selectionsEqual,
  initialSelectionForState,
  getBlock,
  type EditorState,
  type EditorConfig,
  type EditorAction,
  type ComponentRegistry,
  type AttrRegistry,
  type PageConfig,
  type State,
} from "@taleweaver/core";
import { createDigitalReconciler, type DigitalReconciler } from "./digital-reconciler";
import { mapBeforeInput, replacementInsertText } from "./map-before-input";
import { mapDigitalKey } from "./map-digital-key";

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
}

export interface DigitalController {
  readonly editorState: EditorState;
  dispatch(action: EditorAction): void;
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

  function dispatch(action: EditorAction): void {
    const prev = editorState;
    editorState = reduceEditor(editorState, action, config);
    reconciler.reconcile(prev, editorState, isComposing);
    if (editorState !== prev) options.onChange?.(editorState);
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
  }
  function onCopy(e: ClipboardEvent): void {
    e.preventDefault();
    const text = extractText(editorState.state, editorState.selection, builtinEmbedSerializer, "suggesting");
    e.clipboardData?.setData("text/plain", text);
  }
  function onCut(e: ClipboardEvent): void {
    onCopy(e);
    dispatch({ type: "DELETE_RANGE", span: editorState.selection });
  }
  function onPaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (text !== "") dispatch({ type: "PASTE", text });
  }

  container.contentEditable = "true";
  reconciler.mount(container, editorState);

  container.addEventListener("beforeinput", onBeforeInput);
  container.addEventListener("keydown", onKeyDown);
  doc.addEventListener("selectionchange", onSelectionChange);
  container.addEventListener("compositionstart", onCompositionStart);
  container.addEventListener("compositionend", onCompositionEnd);
  container.addEventListener("copy", onCopy);
  container.addEventListener("cut", onCut);
  container.addEventListener("paste", onPaste);

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
    reconciler.destroy();
    container.contentEditable = "false";
  }

  return {
    get editorState() {
      return editorState;
    },
    dispatch,
    focus,
    destroy,
  };
}

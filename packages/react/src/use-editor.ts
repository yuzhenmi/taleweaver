import { useReducer, useRef, useEffect, useCallback, useState } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createInitialEditorState,
  createEditorStateFromState,
  initialSelectionForState,
  reduceEditor,
  createState,
  getYDoc,
  type EditorAction,
  type EditorState,
  type EditorConfig,
  type AttrRegistry,
  type EditorExtensions,
  type IncompatibleDocumentReport,
  type State,
} from "@taleweaver/core";
import { createCanvasShaper, browserHtmlParser } from "@taleweaver/print";

const DEFAULT_WIDTH = 600;

export interface UseEditorOptions {
  /**
   * The attribute registry (built-in formatting + any host marks registered with
   * `registerMark`). Default: `createDefaultAttrRegistry()`. It lives on the
   * returned `config`, which spreading the hook result into `EditorView` hands to
   * the print controller — one config for reducer and controller.
   */
  readonly attrRegistry?: AttrRegistry;
  /** Host extensions (commands, keymap, input rules, triggers) — on the returned `config`. */
  readonly extensions?: EditorExtensions;
  /**
   * The editor HALTED: a peer update carried legacy inline storage (an old client). The
   * returned `halted` becomes true and `dispatch` ignores actions; the last good render
   * stays. Exit: once the document is upgraded (`upgradeDocument`, single authority)
   * the hook resumes BY ITSELF when an upgraded peer's update makes the shared document
   * compatible again (it replaces the document with a fresh State over the same Y.Doc);
   * a host that upgrades a copy passes it to the returned `replaceDocument`. The halt
   * reaches the hook from the `EditorView` it drives automatically — linked through the
   * hook's OWN `dispatch`, so pass the returned `dispatch` to the view unwrapped (a
   * wrapper breaks the link; dev builds warn). Called once per halt; the hook mirrors the
   * controller, so it halts (and calls this) again when legacy storage returns before a
   * resume reaches the controller, or the controller refuses a replacement.
   */
  readonly onIncompatibleDocument?: (report: IncompatibleDocumentReport) => void;
}

/**
 * @internal The link between a `useEditor` hook and the `EditorView` it drives, keyed by
 * the hook's stable `dispatch` (which every view receives): the view reports a halt and
 * a document that became compatible again to the hook, and reads whether the hook is
 * halted (a halted hook's state is never handed to a controller).
 */
export interface HaltLink {
  readonly halted: () => boolean;
  readonly onIncompatibleDocument: (report: IncompatibleDocumentReport) => void;
  readonly onDocumentCompatible: () => void;
}
const haltLinks = new WeakMap<object, HaltLink>();

/** @internal The halt link of the hook that owns `dispatch`, if any. */
export function haltLinkOf(dispatch: object): HaltLink | undefined {
  return haltLinks.get(dispatch);
}

/** Every EditorState a hook handed out → that hook's `dispatch` (dev-time link check). */
const stateOwners = new WeakMap<EditorState, object>();

/**
 * @internal The `dispatch` of the `useEditor` hook that produced `editorState`, if any —
 * a view given a hook's state with ANOTHER dispatch (e.g. a wrapper) is not linked.
 */
export function hookDispatchOf(editorState: EditorState): object | undefined {
  return stateOwners.get(editorState);
}

/** A reducer message: an editor action, or a whole-document replacement. */
type EditorMessage = EditorAction | { readonly type: "react.replaceDocument"; readonly editorState: EditorState };

function createConfig(options?: UseEditorOptions): EditorConfig {
  // L-B / closes #164: pass createCanvasShaper directly. The legacy
  // createCanvasMeasurer is a thin adapter that adaptShaperToMeasurer-wraps
  // the shaper into a TextMeasurer interface (per-string total width,
  // not per-character glyph info). That adapter then synthesizes per-
  // character widths by dividing the total — which produces equal per-
  // character advances regardless of glyph metrics. For any proportional
  // font this is visibly wrong: cursor position drift, hit-test
  // misalignment, line-wrap at the wrong characters. Using the shaper
  // directly delivers true per-glyph advances and cluster boundaries.
  return {
    // Phase 0b: `measurer` left core's `EditorConfig` (geometry-only) for the
    // print backend's controller. The shaper is created + returned separately
    // (see `useEditor`'s `shaperRef`).
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: options?.attrRegistry ?? createDefaultAttrRegistry(),
    ...(options?.extensions !== undefined ? { extensions: options.extensions } : {}),
    containerWidth: DEFAULT_WIDTH,
    htmlParser: browserHtmlParser,
  };
}

export function useEditor(options?: UseEditorOptions) {
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = createConfig(options);
  }
  const config = configRef.current;

  // The print text-shaper (geometry-only, Phase 0b). Built once and passed to
  // the controller / returned to consumers; no longer part of `EditorConfig`.
  const shaperRef = useRef<ReturnType<typeof createCanvasShaper> | null>(null);
  if (shaperRef.current === null) {
    shaperRef.current = createCanvasShaper(document.createElement("canvas"));
  }
  const shaper = shaperRef.current;

  const [editorState, send] = useReducer(
    (state: EditorState, message: EditorMessage) =>
      message.type === "react.replaceDocument" ? message.editorState : reduceEditor(state, message, config),
    config,
    createInitialEditorState,
  );
  const stateRef = useRef(editorState);
  stateRef.current = editorState;
  // The LIVE history, updated synchronously by `replaceDocument` (the render-time
  // `stateRef` lags until React re-renders, so two replacements in one batch would
  // destroy the same history twice and leak the first replacement's).
  const historyRef = useRef(editorState.history);

  // HALTED mirrors the print controller's (spread `onIncompatibleDocument` into
  // `EditorView`): while halted no action reaches the reducer (it would read the
  // incompatible document).
  const [halted, setHalted] = useState(false);
  const haltedRef = useRef(false);
  const hostHook = useRef(options?.onIncompatibleDocument);
  hostHook.current = options?.onIncompatibleDocument;
  const dispatch = useCallback((action: EditorAction) => {
    if (!haltedRef.current) send(action);
  }, []);
  const onIncompatibleDocument = useCallback((report: IncompatibleDocumentReport) => {
    if (haltedRef.current) return;
    haltedRef.current = true;
    setHalted(true);
    hostHook.current?.(report);
  }, []);
  /** Show another document (fresh history, caret at its start) — also how a halted editor resumes. */
  const replaceDocument = useCallback(
    (state: State) => {
      const next = createEditorStateFromState(state, initialSelectionForState(state), config);
      historyRef.current.destroy(); // detach the old document's undo manager
      historyRef.current = next.history;
      haltedRef.current = false;
      setHalted(false);
      send({ type: "react.replaceDocument", editorState: next });
    },
    [config],
  );
  // Halted, and the shared document is compatible again (an upgraded peer upgraded it):
  // the hook owns the state, so it resumes by replacing it with a fresh State over it.
  const onDocumentCompatible = useCallback(() => {
    if (!haltedRef.current) return;
    const halted = stateRef.current.state;
    replaceDocument(createState({ rootId: halted.rootId, doc: getYDoc(halted) }));
  }, [replaceDocument]);
  if (!haltLinks.has(dispatch)) {
    haltLinks.set(dispatch, { halted: () => haltedRef.current, onIncompatibleDocument, onDocumentCompatible });
  }
  stateOwners.set(editorState, dispatch);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          dispatch({ type: "SET_CONTAINER_WIDTH", width });
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const focus = useCallback(() => {
    const textarea = containerRef.current?.querySelector("textarea");
    if (textarea) textarea.focus();
  }, []);

  return {
    editorState,
    dispatch,
    containerRef,
    shaper,
    focus,
    config,
    halted,
    replaceDocument,
  };
}

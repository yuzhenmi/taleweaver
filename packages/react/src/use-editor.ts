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
  type PageConfig,
  type IncompatibleDocumentReport,
  type State,
} from "@taleweaver/core";
import { createCanvasShaper, browserHtmlParser } from "@taleweaver/print";

const DEFAULT_WIDTH = 600;

export interface UseEditorOptions {
  /**
   * The attribute registry (built-in formatting + any host marks registered with
   * `registerMark`). Default: `createDefaultAttrRegistry()`. Like every option here it
   * lands on `editorState.config`, which the reducer and the print controller both read.
   */
  readonly attrRegistry?: AttrRegistry;
  /** Host extensions (commands, keymap, input rules, triggers). */
  readonly extensions?: EditorExtensions;
  /** Page setup (size, margins, gap). `undefined` ⇒ unpaginated. */
  readonly pageConfig?: PageConfig;
  /**
   * The editor HALTED on an incompatible document (`report.reason`): a legacy client
   * wrote into the frozen legacy root, a peer raised the schema past this engine's, a
   * second Yjs instance decoded updates, or a replacement's document is not upgraded yet.
   * The returned `halted` becomes true and `dispatch` ignores actions; the last good
   * render stays. Exit: the host passes a fresh State to the returned `replaceDocument`
   * (a legacy write is surfaced in the report, not merged). A not-yet-upgraded document
   * ("legacy-schema") also resumes BY ITSELF once it is upgraded (`upgradeDocument`,
   * single authority): the hook replaces it with a fresh State over the same Y.Doc. The halt
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
  // Pass createCanvasShaper directly. The legacy
  // createCanvasMeasurer is a thin adapter that adaptShaperToMeasurer-wraps
  // the shaper into a TextMeasurer interface (per-string total width,
  // not per-character glyph info). That adapter then synthesizes per-
  // character widths by dividing the total — which produces equal per-
  // character advances regardless of glyph metrics. For any proportional
  // font this is visibly wrong: cursor position drift, hit-test
  // misalignment, line-wrap at the wrong characters. Using the shaper
  // directly delivers true per-glyph advances and cluster boundaries.
  return {
    // `measurer` is not part of core's geometry-free `EditorConfig`; it belongs to the
    // print backend's controller. The shaper is created + returned separately
    // (see `useEditor`'s `shaperRef`).
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: options?.attrRegistry ?? createDefaultAttrRegistry(),
    ...(options?.extensions !== undefined ? { extensions: options.extensions } : {}),
    ...(options?.pageConfig !== undefined ? { pageConfig: options.pageConfig } : {}),
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

  // The print text-shaper (geometry-only). Built once and passed to
  // the controller / returned to consumers; no longer part of `EditorConfig`.
  const shaperRef = useRef<ReturnType<typeof createCanvasShaper> | null>(null);
  if (shaperRef.current === null) {
    shaperRef.current = createCanvasShaper(document.createElement("canvas"));
  }
  const shaper = shaperRef.current;

  const [editorState, send] = useReducer(
    (state: EditorState, message: EditorMessage) =>
      message.type === "react.replaceDocument" ? message.editorState : reduceEditor(state, message),
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
  /** Why the hook halted: only a not-yet-upgraded document ("legacy-schema") resumes on its own. */
  const haltReasonRef = useRef<IncompatibleDocumentReport["reason"] | null>(null);
  const onIncompatibleDocument = useCallback((report: IncompatibleDocumentReport) => {
    if (haltedRef.current) return;
    haltedRef.current = true;
    haltReasonRef.current = report.reason;
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
  // Halted on a NOT-YET-UPGRADED document that is now upgraded: the hook owns the state,
  // so it resumes by replacing it with a fresh State over it. A sticky halt (a legacy
  // write, a newer schema, a second Yjs instance) never resumes on its own — even when a
  // view re-created while halted reports its (already current) document compatible.
  const onDocumentCompatible = useCallback(() => {
    if (!haltedRef.current || haltReasonRef.current !== "legacy-schema") return;
    const halted = stateRef.current.state;
    replaceDocument(createState({ rootId: halted.rootId, doc: getYDoc(halted), resolver: config.componentRegistry }));
  }, [replaceDocument, config]);
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
    halted,
    replaceDocument,
  };
}

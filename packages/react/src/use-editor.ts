import { useRef, useEffect, useCallback, useState, useSyncExternalStore } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createEditor,
  createDocument,
  getYDoc,
  type EditorAction,
  type Editor,
  type EditorConfig,
  type AttrRegistry,
  type EditorExtensions,
  type PageConfig,
  type IncompatibleDocumentReport,
  type Document,
} from "@taleweaver/core";
import { createCanvasShaper, browserHtmlParser } from "@taleweaver/print";

const DEFAULT_WIDTH = 600;

export interface UseEditorOptions {
  /**
   * The attribute registry (built-in formatting + any host marks registered with
   * `registerMark`). Default: `createDefaultAttrRegistry()`. Like every option here it
   * lands on `editor.config`, which the reducer and the print controller both read.
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
   * render stays. Exit: the host passes a fresh Document to the returned `replaceDocument`
   * (a legacy write is surfaced in the report, not merged). A not-yet-upgraded document
   * ("legacy-schema") also resumes BY ITSELF once it is upgraded (`upgradeDocument`,
   * single authority): the hook replaces it with a fresh Document over the same Y.Doc. The halt
   * reaches the hook from the `EditorView` it drives automatically — linked through the
   * hook's `editor`, which the view receives. Called once per halt; the hook mirrors the
   * controller, so it halts (and calls this) again when legacy storage returns before a
   * resume reaches the controller, or the controller refuses a replacement.
   */
  readonly onIncompatibleDocument?: (report: IncompatibleDocumentReport) => void;
}

/**
 * @internal The link between a `useEditor` hook and the `EditorView` it drives, keyed by
 * every `Editor` the hook created (the view receives one): the view reports a halt and a
 * document that became compatible again to the hook, and reads whether the hook is
 * halted (a halted hook's editor is never handed to a controller).
 */
export interface HaltLink {
  readonly halted: () => boolean;
  readonly onIncompatibleDocument: (report: IncompatibleDocumentReport) => void;
  readonly onDocumentCompatible: () => void;
}
const haltLinks = new WeakMap<Editor, HaltLink>();

/** @internal The halt link of the hook that created `editor`, if any. */
export function haltLinkOf(editor: Editor): HaltLink | undefined {
  return haltLinks.get(editor);
}

/** An editor and a counter its subscription bumps: the snapshot `useSyncExternalStore` reads. */
interface Tracked {
  readonly editor: Editor;
  version: number;
}

function track(editor: Editor): Tracked {
  const tracked: Tracked = { editor, version: 0 };
  editor.subscribe(() => {
    tracked.version++;
  });
  return tracked;
}

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

  // The ONE editor (replaced only by `replaceDocument`). It changes in place; the hook
  // re-renders from its subscription.
  const [tracked, setTracked] = useState(() => track(createEditor(config)));
  const editor = tracked.editor;
  const subscribe = useCallback((onChange: () => void) => tracked.editor.subscribe(onChange), [tracked]);
  useSyncExternalStore(subscribe, () => tracked.version);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  // The LIVE history, updated synchronously by `replaceDocument` (the render-time
  // `editorRef` lags until React re-renders, so two replacements in one batch would
  // destroy the same history twice and leak the first replacement's).
  const historyRef = useRef(editor.history);

  // HALTED mirrors the print controller's (spread `onIncompatibleDocument` into
  // `EditorView`): while halted no action reaches the editor (it would read the
  // incompatible document).
  const [halted, setHalted] = useState(false);
  const haltedRef = useRef(false);
  const hostHook = useRef(options?.onIncompatibleDocument);
  hostHook.current = options?.onIncompatibleDocument;
  const dispatch = useCallback((action: EditorAction) => {
    if (!haltedRef.current) editorRef.current.dispatch(action);
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
  /** Show another document (a new editor: fresh history, caret at its start) — also how a halted editor resumes. */
  const replaceDocument = useCallback(
    (document: Document) => {
      const next = createEditor(config, { document });
      historyRef.current.destroy(); // detach the old document's undo manager
      historyRef.current = next.history;
      haltLinks.set(next, linkRef.current);
      editorRef.current = next;
      haltedRef.current = false;
      setHalted(false);
      setTracked(track(next));
    },
    [config],
  );
  // Halted on a NOT-YET-UPGRADED document that is now upgraded: the hook owns the editor,
  // so it resumes by replacing it with a fresh Document over it. A sticky halt (a legacy
  // write, a newer schema, a second Yjs instance) never resumes on its own — even when a
  // view re-created while halted reports its (already current) document compatible.
  const onDocumentCompatible = useCallback(() => {
    if (!haltedRef.current || haltReasonRef.current !== "legacy-schema") return;
    const halted = editorRef.current.document;
    replaceDocument(createDocument({ rootId: halted.rootId, doc: getYDoc(halted), resolver: config.componentRegistry }));
  }, [replaceDocument, config]);
  const linkRef = useRef<HaltLink>({ halted: () => haltedRef.current, onIncompatibleDocument, onDocumentCompatible });
  if (!haltLinks.has(editor)) haltLinks.set(editor, linkRef.current);

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
    editor,
    dispatch,
    containerRef,
    shaper,
    focus,
    halted,
    replaceDocument,
  };
}

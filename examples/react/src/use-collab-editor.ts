/**
 * A collaboration-aware editor hook for the example app's "Collaboration" tab.
 *
 * Each pane is a separate peer: its own `State` over its own `Y.Doc`, kept in sync
 * with the other pane by exchanging Yjs updates (`Y.applyUpdate`) — exactly what a
 * network provider does. The engine handles the rest: the print controller sees a
 * peer's update land in its Y.Doc (a non-local transaction) and dispatches
 * `APPLY_FOREIGN_CHANGE`, whose reducer arm reconciles the state and REBASES this
 * pane's selection; decorations / anchors / the mapping log advance on the next
 * `update`. Undo stays per peer (each History only sees its own doc's local edits).
 *
 * Example-app only — must not be promoted to packages/react (it duplicates
 * config/geometry creation deliberately, like use-perf-editor).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  reduceEditor,
  createEditorStateFromState,
  initialSelectionForState,
  type EditorAction,
  type EditorState,
  type EditorConfig,
  type PageConfig,
  type State,
  type TextShaper,
  type Hyphenator,
} from "@taleweaver/core";
import { createCanvasShaper, createLiangHyphenator, browserHtmlParser } from "@taleweaver/print";
import { EN_US_PATTERN_SET } from "@taleweaver/hyphenation-en-us";

const DEFAULT_WIDTH = 600;

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 816,
  pageBlockSize: 1056,
  pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
  pageGap: 24,
};

function createConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: DEFAULT_WIDTH,
    // Inject the DOM HTML parser so handlePaste can decode text/html (rich paste).
    // Without it, core silently falls back to the plain-text path.
    htmlParser: browserHtmlParser,
  };
}

function createGeometry(): { measurer: TextShaper; hyphenator: Hyphenator } {
  const canvas = document.createElement("canvas");
  return {
    measurer: createCanvasShaper(canvas),
    hyphenator: createLiangHyphenator({ en: EN_US_PATTERN_SET }),
  };
}

export interface UseCollabEditorResult {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextShaper;
  hyphenator: Hyphenator;
  pageConfig: PageConfig;
  focus: () => void;
  /** The reducer's config — spread into `EditorView` so the controller uses the same registries. */
  config: EditorConfig;
}

/**
 * Bind one editing pane to the `sharedDoc` (a seed `State` over the shared
 * Y.Doc). `selfOrigin` is this pane's stable peer identity (e.g. "peer-a").
 */
export function useCollabEditor(peerDoc: State): UseCollabEditorResult {
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = createConfig();
  }
  const config = configRef.current;

  const geometryRef = useRef<{ measurer: TextShaper; hyphenator: Hyphenator } | null>(null);
  if (geometryRef.current === null) {
    geometryRef.current = createGeometry();
  }
  const geometry = geometryRef.current;

  const [editorState, setEditorState] = useState<EditorState>(() =>
    // Build with this peer's origin so its History's UndoManager tracks ONLY its
    // own edits (undo isolation) — no default-History-then-replace dance.
    createEditorStateFromState(peerDoc, initialSelectionForState(peerDoc), config),
  );

  // Always-current state ref so the dispatch closure reads the latest without
  // re-creating itself, and so the foreign-change observer (installed once)
  // reconciles against the live state.
  const latestState = useRef(editorState);
  latestState.current = editorState;

  // Origin-tagged dispatch: stamp every edit's Y.Doc transaction with this
  // pane's origin. Computed OUTSIDE a setState updater (in the event handler)
  // so the synchronous foreign-change observer it triggers on the other pane
  // runs as a normal event-time setState, not nested inside a React updater.
  // Reduce synchronously against the LATEST state (not the last rendered one): the
  // print controller dispatches a peer's change (APPLY_FOREIGN_CHANGE) the moment it
  // lands, and a local keystroke may follow before React re-renders.
  const dispatch = useCallback<React.Dispatch<EditorAction>>(
    (action) => {
      const next = reduceEditor(latestState.current, action, config);
      latestState.current = next;
      setEditorState(next);
    },
    [config],
  );

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
  }, [dispatch]);

  const focus = useCallback(() => {
    const textarea = containerRef.current?.querySelector("textarea");
    if (textarea) textarea.focus();
  }, []);

  return {
    editorState,
    dispatch,
    containerRef,
    measurer: geometry.measurer,
    hyphenator: geometry.hyphenator,
    pageConfig: PAGE_CONFIG,
    focus,
    config,
  };
}

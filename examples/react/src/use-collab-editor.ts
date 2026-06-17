/**
 * A collaboration-aware editor hook for the example app's "Collaboration" tab.
 *
 * Two `useCollabEditor` instances bind to ONE shared `Y.Doc` (each receives the
 * SAME seed `State` — a `State` wraps a doc, so both panes edit the same CRDT)
 * and stay in sync WITHOUT any network transport — purely through the engine's
 * in-process collab seams:
 *
 *  - **Origin-tagged dispatch.** Every edit this pane makes runs inside
 *    `runWithTransactionOrigin(selfOrigin, …)`, so the underlying Y.Doc
 *    transaction is stamped with this pane's origin. That lets the OTHER pane's
 *    observer recognize the edit as foreign, and lets THIS pane's observer
 *    filter its own edits out.
 *  - **Foreign-change observe → reconcile.** `subscribeForeignChanges` fires
 *    with the peer's dirty block ids; `reconcileForeignChange` mints the next
 *    local `EditorState` (cache-invalidated for those blocks, unchanged blocks
 *    reference-equal) which flows into the pane's controller via the normal
 *    `update(editorState)` path.
 *  - **Undo isolation.** Each pane's `History` tracks only its own origin, so
 *    Ctrl+Z in pane A never rolls back pane B's edits.
 *
 * Example-app only — must not be promoted to packages/react (it duplicates
 * config/geometry creation deliberately, like use-perf-editor). The deferred
 * rough edge (documented, not a bug): a peer editing the SAME block your caret
 * sits in can drift the caret — selection rebasing (Yjs RelativePosition) is a
 * separate future feature.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  reduceEditor,
  createEditorStateFromState,
  initialSelectionForState,
  runWithTransactionOrigin,
  subscribeForeignChanges,
  reconcileForeignChange,
  type EditorAction,
  type EditorState,
  type EditorConfig,
  type PageConfig,
  type State,
  type TextShaper,
  type Hyphenator,
} from "@taleweaver/core";
import { createCanvasShaper, createLiangHyphenator } from "@taleweaver/print";
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
}

/**
 * Bind one editing pane to the `sharedDoc` (a seed `State` over the shared
 * Y.Doc). `selfOrigin` is this pane's stable peer identity (e.g. "peer-a").
 */
export function useCollabEditor(sharedDoc: State, selfOrigin: string): UseCollabEditorResult {
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
    // own edits (undo isolation, E4b) — no default-History-then-replace dance.
    createEditorStateFromState(sharedDoc, initialSelectionForState(sharedDoc), config, selfOrigin),
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
  const dispatch = useCallback<React.Dispatch<EditorAction>>(
    (action) => {
      const next = runWithTransactionOrigin(selfOrigin, () =>
        reduceEditor(latestState.current, action, config),
      );
      setEditorState(next);
    },
    [config, selfOrigin],
  );

  // Observe the shared doc for the OTHER pane's edits and reconcile them in.
  // The observer attaches to the doc (stable across freshState swaps), so a
  // single subscription for the pane's lifetime is correct.
  useEffect(() => {
    const unsub = subscribeForeignChanges(sharedDoc, selfOrigin, (dirtyIds) => {
      setEditorState((prev) => reconcileForeignChange(prev, dirtyIds));
    });
    return unsub;
  }, [sharedDoc, selfOrigin]);

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
  };
}

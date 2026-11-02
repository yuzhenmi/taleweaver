/**
 * A collaboration-aware editor hook for the example app's "Collaboration" tab.
 *
 * Each pane is a separate peer: its own `Document` over its own `Y.Doc`, kept in sync
 * with the other pane by exchanging Yjs updates (`Y.applyUpdate`) — exactly what a
 * network provider does. The engine handles the rest: the print controller sees a
 * peer's update land in its Y.Doc (a non-local transaction) and dispatches
 * `APPLY_FOREIGN_CHANGE` to this pane's editor, whose reducer arm reconciles it and
 * REBASES this pane's selection; decorations / anchors / the mapping log advance in the
 * controller's render that follows. Undo stays per peer (each History only sees its own
 * doc's local edits).
 *
 * Example-app only — must not be promoted to packages/react (it duplicates
 * config/geometry creation deliberately, like use-perf-editor).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  type EditorAction,
  type Editor,
  type EditorConfig,
  type PageConfig,
  type Document,
  type TextShaper,
  type Hyphenator, createEditor } from "@taleweaver/core";
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
    pageConfig: PAGE_CONFIG,
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
  editor: Editor;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextShaper;
  hyphenator: Hyphenator;
  focus: () => void;
}

/**
 * Bind one editing pane to the `sharedDoc` (a seed `Document` over the shared
 * Y.Doc). `selfOrigin` is this pane's stable peer identity (e.g. "peer-a").
 */
export function useCollabEditor(peerDoc: Document): UseCollabEditorResult {
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

  // This pane's ONE editor over its peer document. It changes in place — local edits
  // and the peer changes the print controller dispatches the moment they land alike.
  const [editor] = useState<Editor>(() =>
    createEditor(config, { document: peerDoc }),
  );
  // Re-render after every dispatch (the controller subscribes on its own).
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => editor.subscribe(rerender), [editor]);
  const dispatch = useCallback<React.Dispatch<EditorAction>>((action) => editor.dispatch(action), [editor]);

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
    editor,
    dispatch,
    containerRef,
    measurer: geometry.measurer,
    hyphenator: geometry.hyphenator,
    focus,
  };
}

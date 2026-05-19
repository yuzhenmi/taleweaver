import { useReducer, useRef, useEffect, useCallback } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createInitialEditorState,
  reduceEditor,
  type EditorAction,
  type EditorState,
  type EditorConfig,
} from "@taleweaver/core";
import { createCanvasMeasurer } from "@taleweaver/dom";

const DEFAULT_WIDTH = 600;

export interface UseEditorOptions {
  // Plan 2: pageHeight and pageMargins will be added here
}

function createConfig(_options?: UseEditorOptions): EditorConfig {
  const canvas = document.createElement("canvas");
  const measurer = createCanvasMeasurer(canvas);
  return {
    measurer,
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: DEFAULT_WIDTH,
  };
}

export function useEditor(options?: UseEditorOptions) {
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = createConfig(options);
  }
  const config = configRef.current;

  const [editorState, dispatch] = useReducer(
    (state: EditorState, action: EditorAction) =>
      reduceEditor(state, action, config),
    config,
    createInitialEditorState,
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
  }, []);

  const focus = useCallback(() => {
    const textarea = containerRef.current?.querySelector("textarea");
    if (textarea) textarea.focus();
  }, []);

  return {
    editorState,
    dispatch,
    containerRef,
    measurer: config.measurer,
    focus,
  };
}

import { useReducer, useRef, useEffect, useCallback } from "react";
import { createRegistry, defaultComponents } from "@taleweaver/core";
import {
  createInitialEditorState,
  reduceEditor,
  createCanvasMeasurer,
  FONT_CONFIG,
  type EditorAction,
  type EditorState,
  type EditorConfig,
} from "@taleweaver/dom";

const DEFAULT_WIDTH = 600;

function createConfig(): EditorConfig {
  const canvas = document.createElement("canvas");
  const measurer = createCanvasMeasurer(canvas);
  const registry = createRegistry([...defaultComponents]);
  return { measurer, registry, containerWidth: DEFAULT_WIDTH };
}

export function useEditor() {
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = createConfig();
  }
  const config = configRef.current;

  const [editorState, dispatch] = useReducer(
    (state: EditorState, action: EditorAction) =>
      reduceEditor(state, action, config),
    config,
    createInitialEditorState,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  return { editorState, dispatch, containerRef, textareaRef, measurer: config.measurer };
}

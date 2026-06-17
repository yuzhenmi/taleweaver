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
import { createCanvasShaper } from "@taleweaver/print";

const DEFAULT_WIDTH = 600;

export interface UseEditorOptions {
  // Plan 2: pageHeight and pageMargins will be added here
}

function createConfig(_options?: UseEditorOptions): EditorConfig {
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

  // The print text-shaper (geometry-only, Phase 0b). Built once and passed to
  // the controller / returned to consumers; no longer part of `EditorConfig`.
  const shaperRef = useRef<ReturnType<typeof createCanvasShaper> | null>(null);
  if (shaperRef.current === null) {
    shaperRef.current = createCanvasShaper(document.createElement("canvas"));
  }
  const shaper = shaperRef.current;

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
    shaper,
    focus,
  };
}

import { useEffect, useRef } from "react";
import {
  type TextMeasurer,
  type EditorAction,
  type EditorState,
} from "@taleweaver/core";
import {
  createEditorController,
  type EditorController,
} from "@taleweaver/dom";

export interface EditorViewProps {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextMeasurer;
  pageHeight?: number;
  pageGap?: number;
}

export function EditorView({
  editorState,
  dispatch,
  containerRef,
  measurer,
  pageHeight,
  pageGap,
}: EditorViewProps) {
  const controllerRef = useRef<EditorController | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ctrl = createEditorController(el, {
      measurer,
      dispatch,
      pageHeight,
      pageGap,
    });
    controllerRef.current = ctrl;
    ctrl.update(editorState);
    return () => ctrl.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only

  useEffect(() => {
    controllerRef.current?.update(editorState);
  }, [editorState]);

  return <div ref={containerRef} />;
}

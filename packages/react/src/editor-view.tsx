import { Profiler, useEffect, useRef, type ProfilerOnRenderCallback } from "react";
import {
  type TextShaper,
  type TextMeasurer,
  type EditorAction,
  type EditorState,
  markStart,
  markEnd,
  recordSample,
  isPerfTraceEnabled,
} from "@taleweaver/core";
import {
  createEditorController,
  type EditorController,
} from "@taleweaver/dom";

export interface EditorViewProps {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextShaper | TextMeasurer;
  pageHeight?: number;
  pageGap?: number;
}

const handleProfile: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  if (!isPerfTraceEnabled()) return;
  recordSample(`react.render.${id}`, actualDuration);
};

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
    const t = markStart("react.subscribe.notify");
    try {
      controllerRef.current?.update(editorState);
    } finally {
      markEnd("react.subscribe.notify", t);
    }
  }, [editorState]);

  return (
    <Profiler id="EditorView" onRender={handleProfile}>
      <div ref={containerRef} />
    </Profiler>
  );
}

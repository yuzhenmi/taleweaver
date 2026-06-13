import {
  Profiler,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ProfilerOnRenderCallback,
} from "react";
import {
  type TextShaper,
  type TextMeasurer,
  type EditorAction,
  type EditorState,
  type FindMatchesOptions,
  markStart,
  markEnd,
  recordSample,
  isPerfTraceEnabled,
} from "@taleweaver/core";
import {
  createEditorController,
  type EditorController,
  type FindStatus,
} from "@taleweaver/dom";

export interface EditorViewProps {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextShaper | TextMeasurer;
  pageHeight?: number;
  pageGap?: number;
}

/**
 * The imperative API a parent gets via `ref` (#433). Delegates the controller's
 * find-session + replace methods so a find-bar (held in the parent) can drive
 * find/replace without reaching into the encapsulated controller. Each method
 * reads `controllerRef.current` lazily; before mount (controller still null) the
 * status-returning ones return the empty `{ total: 0, activeIndex: -1 }` and
 * `findClose` is a no-op.
 */
export interface EditorViewHandle {
  findStart(query: string, options?: FindMatchesOptions): FindStatus;
  findNext(): FindStatus;
  findPrev(): FindStatus;
  findClose(): void;
  replaceActive(replacement: string): FindStatus;
  replaceAll(replacement: string): FindStatus;
  findStatus(): FindStatus;
}

const EMPTY_FIND_STATUS: FindStatus = { total: 0, activeIndex: -1 };

const handleProfile: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  if (!isPerfTraceEnabled()) return;
  recordSample(`react.render.${id}`, actualDuration);
};

export const EditorView = forwardRef<EditorViewHandle, EditorViewProps>(
  function EditorView(
    { editorState, dispatch, containerRef, measurer, pageHeight, pageGap },
    ref,
  ) {
  const controllerRef = useRef<EditorController | null>(null);

  // Imperative handle (#433): delegate the controller's find/replace methods.
  // Each closure reads `controllerRef.current` lazily (at call time, not capture
  // time), so the stable `[]` deps are correct — the ref is mutated in the
  // mount effect after the controller is created. Null-guard returns the empty
  // status (pre-mount) / no-ops `findClose`.
  useImperativeHandle(
    ref,
    () => ({
      findStart: (query, options) =>
        controllerRef.current?.findStart(query, options) ?? EMPTY_FIND_STATUS,
      findNext: () => controllerRef.current?.findNext() ?? EMPTY_FIND_STATUS,
      findPrev: () => controllerRef.current?.findPrev() ?? EMPTY_FIND_STATUS,
      findClose: () => {
        controllerRef.current?.findClose();
      },
      replaceActive: (replacement) =>
        controllerRef.current?.replaceActive(replacement) ?? EMPTY_FIND_STATUS,
      replaceAll: (replacement) =>
        controllerRef.current?.replaceAll(replacement) ?? EMPTY_FIND_STATUS,
      findStatus: () => controllerRef.current?.findStatus() ?? EMPTY_FIND_STATUS,
    }),
    [],
  );

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
  },
);

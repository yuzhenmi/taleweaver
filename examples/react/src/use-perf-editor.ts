/**
 * A local variant of `useEditor` (from @taleweaver/react) that accepts an
 * overriding initial EditorState. Used by the perf-fixture path so the 10K-
 * paragraph document is built in a single layout pass instead of N INSERT_NODE
 * dispatches.
 *
 * This hook is intentionally limited to the example app and must not be
 * promoted to packages/react — it duplicates config creation from use-editor.ts
 * deliberately so that packages/react remains unchanged.
 */
import { useReducer, useRef, useEffect, useCallback } from "react";
import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createInitialEditorState,
  reduceEditor,
  type EditorAction,
  type EditorState,
  type EditorConfig,
  type PageConfig,
} from "@taleweaver/core";
import { createCanvasMeasurer } from "@taleweaver/dom";
import { tryLoadPerfFixtureFromUrl } from "./perf-fixture";

const DEFAULT_WIDTH = 600;

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 816,                // US Letter at 96 DPI: 8.5 × 96 = 816
  pageBlockSize:  1056,               // 11 × 96 = 1056
  pageMargins:    { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
  pageGap:        24,
};

function createConfig(): EditorConfig {
  const canvas = document.createElement("canvas");
  const measurer = createCanvasMeasurer(canvas);
  return {
    measurer,
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: DEFAULT_WIDTH,
    pageConfig: PAGE_CONFIG,
  };
}

export interface UsePerfEditorResult {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: EditorConfig["measurer"];
  focus: () => void;
  isPerfFixture: boolean;
  config: EditorConfig;
}

/**
 * Identical to `useEditor` from @taleweaver/react except that it checks for
 * `?perfFixture=N` in the URL on mount and, if present, replaces the empty
 * initial state with the N-paragraph synthetic fixture.
 */
export function usePerfEditor(): UsePerfEditorResult {
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = createConfig();
  }
  const config = configRef.current;

  // Check URL once (outside render — it's synchronous and stable).
  const fixtureRef = useRef<EditorState | null | undefined>(undefined);
  if (fixtureRef.current === undefined) {
    fixtureRef.current = tryLoadPerfFixtureFromUrl(config);
  }
  const fixtureState = fixtureRef.current;

  // Use the lazy-initializer form of useReducer so the initial state is only
  // computed once. When a perf fixture is available we return it directly;
  // otherwise we call the standard createInitialEditorState.
  const initialArg: { config: EditorConfig; fixture: EditorState | null } =
    useRef({ config, fixture: fixtureState }).current;

  const [editorState, dispatch] = useReducer(
    (state: EditorState, action: EditorAction) =>
      reduceEditor(state, action, config),
    initialArg,
    ({ config: cfg, fixture }) =>
      fixture !== null ? fixture : createInitialEditorState(cfg),
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
    isPerfFixture: fixtureState !== null,
    config,
  };
}

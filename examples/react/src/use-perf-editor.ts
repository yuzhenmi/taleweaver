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

// Dev-only window-level instrumentation hook for perf measurement
// from Playwright / the browser console. Exposed only when running in
// the example app; production builds of @taleweaver/react do not touch
// this. Keep the surface minimal and one-way (read-only state, dispatch
// proxy) so it doesn't drift into application code.
//
// Usage from the browser:
//   __twPerf.timeKeystrokes(N, "x")
//     → dispatches N INSERT_TEXT actions, returns
//       { totalMs, avgMs, medianMs, maxMs, samples }.
//   __twPerf.state            → the current EditorState.
//   __twPerf.dispatch(action) → fire any EditorAction.
interface PerfHandle {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  timeKeystrokes(
    count: number,
    char?: string,
  ): { totalMs: number; avgMs: number; medianMs: number; maxMs: number; samples: number[] };
}
declare global {
  // eslint-disable-next-line no-var
  var __twPerf: PerfHandle | undefined;
}
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
import { createCanvasShaper } from "@taleweaver/dom";
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
  // Pass the shaper directly (NOT createCanvasMeasurer). The measurer adapter
  // chain (adaptShaperToMeasurer → measurerToShaper) distributes a string's
  // total width uniformly across its characters — every cluster gets
  // `total / length` — losing the per-character widths the canvas shaper
  // actually produced. Symptom: words rendered too close together (the
  // sum-of-per-char advance for a wide word like "Welcome" exceeds the
  // uniform-distribution estimate, but the renderer paints at the layout
  // position that assumed the uniform estimate — so "Welcome " ends where
  // "Welco" would have ended visually, and the next word starts there).
  return {
    measurer: createCanvasShaper(canvas),
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

  // Latest state/dispatch refs so the window-level perf hook always
  // sees up-to-date values without us re-installing it every render.
  const latestState = useRef(editorState);
  latestState.current = editorState;
  const latestDispatch = useRef(dispatch);
  latestDispatch.current = dispatch;
  useEffect(() => {
    (globalThis as { __twPerf?: PerfHandle }).__twPerf = {
      get state() {
        return latestState.current;
      },
      get dispatch() {
        return latestDispatch.current;
      },
      timeKeystrokes(count: number, char = "x") {
        // Measure the SYNCHRONOUS reduceEditor cost in isolation.
        // React's dispatch is async (queues a re-render); measuring it
        // would capture only the enqueue time, not the actual model +
        // render + cascade + layout work. We run reduceEditor in a
        // tight loop over a local editor reference and DO NOT push
        // the result back through dispatch — this hook is a perf
        // probe, not an editing surface. The doc visible in the
        // browser is unchanged; type a real character afterward to
        // confirm the doc is still healthy.
        let editor = latestState.current;
        const samples: number[] = [];
        for (let i = 0; i < count; i++) {
          const t0 = performance.now();
          editor = reduceEditor(
            editor,
            { type: "INSERT_TEXT", text: char },
            config,
          );
          samples.push(performance.now() - t0);
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const total = samples.reduce((s, v) => s + v, 0);
        return {
          totalMs: total,
          avgMs: total / count,
          medianMs: sorted[Math.floor(count / 2)],
          maxMs: sorted[count - 1],
          samples: sorted,
        };
      },
    };
    return () => {
      delete (globalThis as { __twPerf?: PerfHandle }).__twPerf;
    };
  }, [config]);

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

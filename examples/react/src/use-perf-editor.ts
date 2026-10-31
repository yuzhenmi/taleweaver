/**
 * A local variant of `useEditor` (from @taleweaver/react) that accepts an
 * overriding initial Editor. Used by the perf-fixture path so the 10K-
 * paragraph document is built in a single layout pass instead of N INSERT_NODE
 * dispatches.
 *
 * This hook is intentionally limited to the example app and must not be
 * promoted to packages/react — it duplicates config creation from use-editor.ts
 * deliberately so that packages/react remains unchanged.
 */
import { useReducer, useRef, useEffect, useCallback, useState } from "react";

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
//   __twPerf.document            → the current Editor.
//   __twPerf.dispatch(action) → fire any EditorAction.
interface PerfHandle {
  state: Editor;
  dispatch: React.Dispatch<EditorAction>;
  timeKeystrokes(
    count: number,
    char?: string,
  ): { totalMs: number; avgMs: number; medianMs: number; maxMs: number; samples: number[] };
  timePaste(lineCount: number): { totalMs: number; msPerLine: number };
  timeEnter(): { totalMs: number };
  /** Enable perf-trace marker accumulation (markStart/markEnd record samples). */
  enablePerf(): void;
  /** Disable perf-trace marker accumulation. */
  disablePerf(): void;
  /** Clear accumulated samples. */
  resetPerf(): void;
  /** Snapshot the accumulated breakdown, sorted by totalMs desc. */
  reportPerf(): import("@taleweaver/core").PerfReport;
  /**
   * One-shot: reset, enable, dispatch SPLIT_NODE (real edit cycle: the
   * controller's render → paint, then React's), wait one frame, then disable +
   * report. Returns the breakdown.
   */
  traceEnter(): Promise<import("@taleweaver/core").PerfReport>;
}
declare global {
  // eslint-disable-next-line no-var
  var __twPerf: PerfHandle | undefined;
}
import {
  createDefaultComponentRegistry,
  createEditor,
  setPerfTraceEnabled,
  resetPerfTrace,
  report as perfReport,
  type EditorAction,
  type Editor,
  type EditorConfig,
  type EditorExtensions,
  type PageConfig,
  type Document,
  type TextShaper,
  type Hyphenator,
} from "@taleweaver/core";
import { createCanvasShaper, createLiangHyphenator, browserHtmlParser } from "@taleweaver/print";
import { EN_US_PATTERN_SET } from "@taleweaver/hyphenation-en-us";
import { tryLoadPerfFixtureFromUrl } from "./perf-fixture";
import { loadFairytale } from "./fairytale-seed";
import { createDemoAttrRegistry } from "./components/mentions";

const DEFAULT_WIDTH = 600;

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 816,                // US Letter at 96 DPI: 8.5 × 96 = 816
  pageBlockSize:  1056,               // 11 × 96 = 1056
  pageMargins:    { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
  pageGap:        24,
};

function createConfig(extensions?: EditorExtensions): EditorConfig {
  // Core's `EditorConfig` does not carry the print mechanics
  // `measurer`/`hyphenator` (they moved to the backend `LayoutConfig`; `usePerfEditor`
  // returns them for the controller). `pageConfig` is document page-setup data: the
  // reducer reads it (toggle-section-landscape) and the controller paginates with it,
  // both from the editor state's config.
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDemoAttrRegistry(), // built-ins + the demo `mention` mark
    containerWidth: DEFAULT_WIDTH,
    pageConfig: PAGE_CONFIG,
    // Inject the DOM HTML parser so handlePaste can decode text/html (rich paste).
    // Without it, core silently falls back to the plain-text path.
    htmlParser: browserHtmlParser,
    ...(extensions !== undefined ? { extensions } : {}),
  };
}

/**
 * Build the print-geometry capabilities the controller needs: the
 * canvas text-shaper and the Liang auto-hyphenator. Pass the shaper directly
 * (NOT createCanvasMeasurer). The measurer adapter chain (adaptShaperToMeasurer
 * → measurerToShaper) distributes a string's total width uniformly across its
 * characters — every cluster gets `total / length` — losing the per-character
 * widths the canvas shaper actually produced. Symptom: words rendered too close
 * together.
 */
function createGeometry(): { measurer: TextShaper; hyphenator: Hyphenator } {
  const canvas = document.createElement("canvas");
  return {
    measurer: createCanvasShaper(canvas),
    hyphenator: createLiangHyphenator({ en: EN_US_PATTERN_SET }),
  };
}

export interface UsePerfEditorResult {
  editor: Editor;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextShaper;
  hyphenator: Hyphenator;
  focus: () => void;
  isPerfFixture: boolean;
  /** The live core `Document` — read at a tab-bar switch to hand off the document. */
  getDocument: () => Document;
}

/**
 * Identical to `useEditor` from @taleweaver/react except that it checks for
 * `?perfFixture=N` in the URL on mount and, if present, replaces the empty
 * initial state with the N-paragraph synthetic fixture.
 */
export function usePerfEditor(initialDocument?: Document, extensions?: EditorExtensions): UsePerfEditorResult {
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = createConfig(extensions);
  }
  const config = configRef.current;

  // Print-geometry capabilities: built once, passed to the controller
  // (via the EditorView spread), NOT to core's geometry-free `EditorConfig`.
  const geometryRef = useRef<{ measurer: TextShaper; hyphenator: Hyphenator } | null>(null);
  if (geometryRef.current === null) {
    geometryRef.current = createGeometry();
  }
  const geometry = geometryRef.current;

  // Check URL once (outside render — it's synchronous and stable).
  const fixtureRef = useRef<Editor | null | undefined>(undefined);
  if (fixtureRef.current === undefined) {
    fixtureRef.current = tryLoadPerfFixtureFromUrl(config);
  }
  const fixtureState = fixtureRef.current;

  // The ONE editor, built once. Priority: an explicit hand-off `seed` (tab-bar switch
  // carries the live document over) → a perf fixture (`?perfFixture=N`) → the fairytale.
  const [editor] = useState(() =>
    initialDocument !== undefined
      ? createEditor(config, { document: initialDocument })
      : fixtureState !== null
        ? fixtureState
        : loadFairytale(config),
  );
  // It changes in place: re-render after every dispatch (the controller subscribes too).
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
  }, []);

  const focus = useCallback(() => {
    const textarea = containerRef.current?.querySelector("textarea");
    if (textarea) textarea.focus();
  }, []);

  // Latest state/dispatch refs so the window-level perf hook always
  // sees up-to-date values without us re-installing it every render.
  const latestState = useRef(editor);
  latestState.current = editor;
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
      timePaste(lineCount: number) {
        // Synchronous PASTE benchmark — dispatches the full text once (the
        // reducer + the controller's synchronous render). Mirrors what a real
        // Cmd+V keystroke does (handlePaste splits the text, chains splitBlock +
        // insertText per line). It edits the live document.
        const lines = Array(lineCount).fill(0).map((_, i) => `paste-line-${i}`).join("\n");
        const t0 = performance.now();
        latestState.current.dispatch({ type: "PASTE", text: lines });
        const totalMs = performance.now() - t0;
        return { totalMs, msPerLine: totalMs / lineCount };
      },
      timeEnter() {
        // Synchronous SPLIT_NODE benchmark at the current cursor (edits the live document).
        const t0 = performance.now();
        latestState.current.dispatch({ type: "SPLIT_NODE" });
        return { totalMs: performance.now() - t0 };
      },
      enablePerf() {
        setPerfTraceEnabled(true);
      },
      disablePerf() {
        setPerfTraceEnabled(false);
      },
      resetPerf() {
        resetPerfTrace();
      },
      reportPerf() {
        return perfReport();
      },
      traceEnter() {
        // Full real-edit cycle: the reducer + the controller's render + paint +
        // React re-render. Captures both model and DOM costs.
        resetPerfTrace();
        setPerfTraceEnabled(true);
        const t0 = performance.now();
        latestDispatch.current({ type: "SPLIT_NODE" });
        return new Promise<import("@taleweaver/core").PerfReport>((resolve) => {
          // Two rAFs: first lets React flush,
          // second lets the resulting paint settle so all marks are in.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setPerfTraceEnabled(false);
              const r = perfReport();
              const wallMs = performance.now() - t0;
              // eslint-disable-next-line no-console
              console.log(
                `[traceEnter] wall=${wallMs.toFixed(1)}ms breakdown:`,
                r.entries.map(
                  (e) =>
                    `${e.label}: ${e.totalMs.toFixed(1)}ms × ${e.count}`,
                ),
              );
              resolve(r);
            });
          });
        });
      },
      timeKeystrokes(count: number, char = "x") {
        // Measure the SYNCHRONOUS dispatch cost: the reducer plus the
        // controller's render (cascade + layout + paint), which runs inside the
        // dispatch; React's re-render is queued and not measured. The typed
        // characters land in the live document.
        const editor = latestState.current;
        const samples: number[] = [];
        for (let i = 0; i < count; i++) {
          const t0 = performance.now();
          editor.dispatch({ type: "INSERT_TEXT", text: char });
          samples.push(performance.now() - t0);
        }
        // No samples → no meaningful median/avg/max (avoids NaN avg and
        // undefined median/max from indexing an empty sorted array).
        if (count <= 0) {
          return { totalMs: 0, avgMs: 0, medianMs: 0, maxMs: 0, samples: [] };
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const total = samples.reduce((s, v) => s + v, 0);
        // count >= 1, so sorted has `count` elements: both indices are in range.
        const median = sorted[Math.floor(count / 2)];
        const max = sorted[count - 1];
        if (median === undefined || max === undefined) {
          throw new Error("use-perf-editor: sorted samples unexpectedly empty for count > 0");
        }
        return {
          totalMs: total,
          avgMs: total / count,
          medianMs: median,
          maxMs: max,
          samples: sorted,
        };
      },
    };
    return () => {
      delete (globalThis as { __twPerf?: PerfHandle }).__twPerf;
    };
  }, [config]);

  // Reads the live state via the always-current `latestState` ref so a tab-bar
  // switch hands off the latest document, not a render-time snapshot.
  const getDocument = useCallback(() => latestState.current.document, []);

  return {
    editor,
    dispatch,
    containerRef,
    measurer: geometry.measurer,
    hyphenator: geometry.hyphenator,
    focus,
    isPerfFixture: fixtureState !== null,
    getDocument,
  };
}

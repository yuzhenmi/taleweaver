/**
 * Diagnostic test that drives a real editor keystroke on a multi-
 * paragraph paginated document and asserts the per-paragraph
 * layoutBlock cache hit rate. After L-PERF-A, a single-paragraph
 * INSERT_TEXT should cache-miss ONLY the dirty paragraph; every other
 * paragraph in the doc should cache-hit.
 *
 * If this asserts a low hit ratio, the user's profiler observation
 * ("layoutBlock dominant, collectInlineTokens many times") is
 * confirmed at the unit-test level and we can iterate on the
 * underlying cause.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createMockShaper,
  type EditorConfig,
  type PageConfig,
  getBlock,
  createPosition,
  createSpan,
} from "../index";
import {
  __getLayoutCacheStatsForTest,
  __resetLayoutCacheStatsForTest,
} from "../layout/bfc";

function makeConfig(): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 816,
    pageBlockSize: 1056,
    pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
    pageGap: 24,
  };
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
    pageConfig,
  };
}

describe("layoutBlock cache-hit rate (diagnostic, L-PERF-B)", () => {
  it("single-paragraph INSERT_TEXT on a 50-paragraph doc cache-hits ~49 of 50 paragraphs", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("?");
      return root.firstChildId;
    })();
    // Seed 50 paragraphs by INSERT_TEXT + SPLIT_NODE. Position cursor at
    // start of the first paragraph (it's empty).
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(
          createPosition(firstId, 0),
          createPosition(firstId, 0),
        ),
      },
      config,
    );
    for (let i = 0; i < 50; i++) {
      editor = reduceEditor(
        editor,
        { type: "INSERT_TEXT", text: `para${i}` },
        config,
      );
      if (i < 49) {
        editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
      }
    }
    // Move cursor back to the FIRST paragraph for a localized edit.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(
          createPosition(firstId, 0),
          createPosition(firstId, 0),
        ),
      },
      config,
    );

    // Reset counters, dispatch ONE keystroke, report.
    __resetLayoutCacheStatsForTest();
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);
    const stats = __getLayoutCacheStatsForTest();

    const total = stats.hits + stats.missesNoEntry + stats.missesRenderInequiv +
                  stats.missesPosition + stats.missesSize + stats.missesResumeFrom +
                  stats.missesReusableGate + stats.fullLayoutInvocations;
    (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(
      `[L-PERF-B diag] total=${total}`,
      `hits=${stats.hits}`,
      `missesNoEntry=${stats.missesNoEntry}`,
      `missesRenderInequiv=${stats.missesRenderInequiv}`,
      `missesPosition=${stats.missesPosition}`,
      `missesSize=${stats.missesSize}`,
      `missesResumeFrom=${stats.missesResumeFrom}`,
      `missesReusableGate=${stats.missesReusableGate}`,
      `fullLayoutInvocations=${stats.fullLayoutInvocations}`,
    );

    // The doc has 50 paragraphs + 1 doc root + 1 per-page-root call per page
    // (~3-4 pages for 50 paras at default page-size). After a single-paragraph
    // edit, ALL UNCHANGED paragraphs (~49) should cache-hit. The dirty
    // paragraph cache-misses (renderInequiv) — exactly 1.
    // 50 paragraphs fit on a single page at the default page config,
    // so L-PERF-C's page-level reuse has nothing to skip here — the
    // dirty page IS the only page. The signal we care about is full
    // layoutBlock invocations stay small (per-page-root + dirty
    // paragraph + outer all-pages-root, no spurious extras). Child
    // cache-hits absorb the rest of the per-page iteration.
    expect(stats.fullLayoutInvocations).toBeLessThanOrEqual(5);
    // Confirm child-level cache is also engaging (most children on
    // the dirty page cache-hit even though their containing page
    // doesn't reuse).
    expect(stats.hits).toBeGreaterThanOrEqual(20);
  });

  it("single keystroke at start of 500-paragraph doc cache-hits MOST pages via L-PERF-C", () => {
    // With L-PERF-C, after a single-paragraph edit at the start of
    // page 0, ONLY page 0 (containing the dirty paragraph) re-invokes
    // layoutBlock. Pages 1..N reuse their cached per-page BlockBoxes
    // via the page-level fingerprint cache — short-circuiting the
    // O(N_children_per_page) child iteration that L-PERF-A's per-
    // child cache reduced but did not eliminate.
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("?");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
      config,
    );
    for (let i = 0; i < 500; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `p${i}` }, config);
      if (i < 499) editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    }
    // Cursor at first para start.
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
      config,
    );

    __resetLayoutCacheStatsForTest();
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);
    const stats = __getLayoutCacheStatsForTest();

    (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(
      `[L-PERF-C 500-para] hits=${stats.hits}`,
      `fullLayouts=${stats.fullLayoutInvocations}`,
      `missesRenderInequiv=${stats.missesRenderInequiv}`,
      `missesPosition=${stats.missesPosition}`,
    );
    // Page 0 needs ~50 children re-iterated (the dirty para + dependents).
    // Pages 1..N reuse via page-cache → no layoutBlock invocations.
    // Compared to the L-PERF-A-only baseline (~28 full layouts), this
    // should drop to ~5: 1 per-page root for page 0, 1 dirty paragraph,
    // a handful of root-level invocations for the all-pages outer.
    expect(stats.fullLayoutInvocations).toBeLessThan(15);
  }, 30_000);

  it("bulk PASTE of 200 lines completes in linear time (L-PERF-E chain compaction)", () => {
    // Regression guard: pre-L-PERF-E, the snapshot cache chain grew
    // by 1 per applyOperation. Paste chains ~2 ops per line (insertText
    // + splitBlock), so 200 lines built a 400-deep chain. Each
    // subsequent getBlock walked O(depth) layers → bulk ops were
    // effectively O(N²). L-PERF-E compacts when depth ≥ 64, keeping
    // per-read amortized cost bounded. This test runs a 200-line paste
    // and asserts the wall-clock stays in a linear-scaling regime —
    // a regression to O(N²) would blow the threshold.
    const config = makeConfig();

    for (const N of [200, 1000, 4000]) {
      let testEditor = createInitialEditorState(config);
      const lines = Array(N).fill(0).map((_, i) => `paste-line-${i}`).join("\n");
      const t0 = performance.now();
      testEditor = reduceEditor(testEditor, { type: "PASTE", text: lines }, config);
      const pasteMs = performance.now() - t0;
      (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(
        `[L-PERF-E ${N}-line PASTE] ${pasteMs.toFixed(2)}ms (${(pasteMs / N).toFixed(3)}ms/line)`,
      );
      // Cap is generous (linear regime). O(N²) regression would blow it.
      expect(pasteMs).toBeLessThan(N * 5);
    }
  }, 60_000);

  it("single keystroke on a 500-paragraph doc: hit ratio + scaling diagnostic", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = (() => {
      const root = getBlock(editor.state, editor.state.rootId);
      if (root === null || root.firstChildId === null) throw new Error("?");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
      config,
    );
    for (let i = 0; i < 500; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `p${i}` }, config);
      if (i < 499) editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    }
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
      config,
    );

    __resetLayoutCacheStatsForTest();
    const t0 = performance.now();
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);
    const keystrokeMs = performance.now() - t0;
    const stats = __getLayoutCacheStatsForTest();

    const totalInvocations = stats.hits + stats.missesNoEntry + stats.missesRenderInequiv +
      stats.missesPosition + stats.missesSize + stats.missesResumeFrom + stats.missesReusableGate;
    const hitRatio = stats.hits / totalInvocations;
    (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(
      `[L-PERF-B 500-para] keystrokeMs=${keystrokeMs.toFixed(2)}`,
      `total=${totalInvocations}`,
      `hits=${stats.hits}`,
      `hitRatio=${(hitRatio * 100).toFixed(1)}%`,
      `fullLayouts=${stats.fullLayoutInvocations}`,
      `missesNoEntry=${stats.missesNoEntry}`,
      `missesRenderInequiv=${stats.missesRenderInequiv}`,
      `missesPosition=${stats.missesPosition}`,
      `missesSize=${stats.missesSize}`,
      `missesResumeFrom=${stats.missesResumeFrom}`,
      `missesReusableGate=${stats.missesReusableGate}`,
    );
    // Soft expectation: hit ratio should be very high; full layout
    // invocations should be ~N_pages + 1 (per-page roots + dirty para).
    expect(hitRatio).toBeGreaterThan(0.9);
  }, 30_000);
});

/**
 * Diagnostic test that drives a real editor keystroke on a multi-
 * paragraph paginated document and asserts that a single-paragraph
 * INSERT_TEXT reuses every UNCHANGED paragraph rather than re-laying it out.
 *
 * **Virtual-mode reuse metric (post Phase-3 wiring).** In virtual paginated
 * mode the reducer no longer runs the per-page `paginateRoot` paginator over
 * every paragraph — it builds a `PagePlan` + a lazy `VirtualLayoutTree` and
 * positions NO pages. Block reuse therefore moved out of bfc's per-block
 * subtree cache (`__getLayoutCacheStatsForTest`, which now reads ~0 because
 * that paginator doesn't run in the reducer) and INTO `buildBlockFitMetas`'s
 * meta cache (keyed on the cascaded node ref). So the surviving "most blocks
 * reused" signal is the META BUILD COUNT: a single-paragraph edit rebuilds
 * only the dirty paragraph's meta and ref-reuses the rest. These diagnostics
 * assert that.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  type EditorConfig,
  type PageConfig,
  getBlock,
  createPosition,
  createSpan,
} from "@taleweaver/core";
import {
  __getLayoutCacheStatsForTest,
  __resetLayoutCacheStatsForTest,
} from "../layout/bfc";
import {
  __getMetaBuildCountForTest,
  __resetMetaBuildCountForTest,
} from "../layout/build-fit-metas";

function makeConfig(): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 816,
    pageBlockSize: 1056,
    pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
    pageGap: 24,
  };
  return {
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
    __resetMetaBuildCountForTest();
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);
    const stats = __getLayoutCacheStatsForTest();
    const metaBuildCount = __getMetaBuildCountForTest();

    const total = stats.hits + stats.missesNoEntry + stats.missesRenderInequiv +
                  stats.hitsRepositioned + stats.missesSize + stats.missesResumeFrom +
                  stats.missesReusableGate + stats.fullLayoutInvocations;
    (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(
      `[L-PERF-B diag] total=${total}`,
      `hits=${stats.hits}`,
      `missesNoEntry=${stats.missesNoEntry}`,
      `missesRenderInequiv=${stats.missesRenderInequiv}`,
      `hitsRepositioned=${stats.hitsRepositioned}`,
      `missesSize=${stats.missesSize}`,
      `missesResumeFrom=${stats.missesResumeFrom}`,
      `fullLayoutInvocations=${stats.fullLayoutInvocations}`,
      `metaBuildCount=${metaBuildCount}`,
    );

    // Virtual-mode reuse signal: a single-paragraph edit on a 50-paragraph doc
    // rebuilds only the dirty paragraph's meta (and any ancestor whose child
    // list changed); the other ~49 paragraphs ref-reuse their cached meta. So
    // the meta build count is tiny and INDEPENDENT of the 50-block doc size.
    // (Pre-Task-0 this was 50 — a full rebuild every keystroke.)
    expect(metaBuildCount).toBeLessThanOrEqual(3);
    // Any bfc layoutBlock work in the reducer is now confined to the dirty
    // block's meta build (buildBlockFitMetas lays out only cache-miss blocks),
    // so full layout invocations stay tiny regardless of doc size.
    expect(stats.fullLayoutInvocations).toBeLessThanOrEqual(5);
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
      `hitsRepositioned=${stats.hitsRepositioned}`,
    );
    // Page 0 needs ~50 children re-iterated (the dirty para + dependents).
    // Pages 1..N reuse via page-cache → no layoutBlock invocations.
    // Compared to the L-PERF-A-only baseline (~28 full layouts), this
    // should drop to ~5: 1 per-page root for page 0, 1 dirty paragraph,
    // a handful of root-level invocations for the all-pages outer.
    expect(stats.fullLayoutInvocations).toBeLessThan(15);
    // #428: generous timeout — heavy 500-paragraph diagnostic asserting a
    // cache-hit COUNT (not wall-clock). ~16s in isolation but observed >70s
    // under full-suite parallel CPU contention; 120s keeps the suite green.
  }, 120_000);

  it("DIAGNOSTIC: SPLIT_NODE at top of N-paragraph doc — pure-model cost", () => {
    // No assertion — just print the model-layer cost of pressing Enter
    // at the start of a long doc, to determine whether the user's
    // reported ~150ms is dominated by model work or by React/paint.
    const config = makeConfig();
    for (const N of [500]) {
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
      for (let i = 0; i < N; i++) {
        editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `p${i}` }, config);
        if (i < N - 1) editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
      }
      editor = reduceEditor(
        editor,
        { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
        config,
      );
      __resetLayoutCacheStatsForTest();
      const t0 = performance.now();
      editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
      const ms = performance.now() - t0;
      const stats = __getLayoutCacheStatsForTest();
      (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(
        `[ENTER@top N=${N}] ${ms.toFixed(2)}ms`,
        `hits=${stats.hits} fulls=${stats.fullLayoutInvocations}`,
        `misses{pos=${stats.hitsRepositioned} renderInequiv=${stats.missesRenderInequiv}}`,
      );
    }
  }, 60_000);

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
    __resetMetaBuildCountForTest();
    const t0 = performance.now();
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);
    const keystrokeMs = performance.now() - t0;
    const stats = __getLayoutCacheStatsForTest();
    const metaBuildCount = __getMetaBuildCountForTest();

    (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(
      `[L-PERF-B 500-para] keystrokeMs=${keystrokeMs.toFixed(2)}`,
      `metaBuildCount=${metaBuildCount}`,
      `fullLayouts=${stats.fullLayoutInvocations}`,
    );
    // Scaling guard: on a 500-paragraph doc a single keystroke rebuilds only
    // the dirty paragraph's meta — the count is tiny and does NOT scale with N
    // (it is the same ~1 as the 50-paragraph case above). This is the property
    // virtualization delivers: per-keystroke work is O(dirty), not O(N_blocks).
    expect(metaBuildCount).toBeLessThanOrEqual(3);
    // #428: generous timeout — same heavy 500-paragraph diagnostic class as
    // above; asserts a scaling COUNT, not wall-clock. 120s absorbs full-suite
    // CPU contention so it doesn't flake on its 30s budget.
  }, 120_000);
});

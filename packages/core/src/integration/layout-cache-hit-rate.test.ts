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
    expect(stats.hits).toBeGreaterThanOrEqual(48); // allow 1-2 slack for first-render-warmup
    expect(stats.missesRenderInequiv).toBeLessThanOrEqual(5); // per-page roots fail by design
  });

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

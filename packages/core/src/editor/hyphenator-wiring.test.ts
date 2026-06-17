/**
 * Auto-hyphenation slice 2 — wiring smoke test.
 *
 * Proves the injected `EditorConfig.hyphenator` is threaded end-to-end through
 * BOTH layout passes: the cheap virtual measure pass (`buildVirtualPaginatedTree`
 * → `buildBlockFitMetas` / `measurePass`) AND the on-demand `getPage` render pass
 * (`makeVirtualLayoutTree` → per-page `layoutBlock`). A multi-page document
 * exercises the pagination producer; materializing every page exercises the
 * render arm. The hyphenator is carried but UNUSED in this slice (the producer is
 * slice 4), so the assertion is "lays out without error through both passes" —
 * the value arrives at every site that consumes it.
 */
import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, createMockHyphenator, render, cascadePass, type EditorConfig, type PageConfig, type EditorState, type Hyphenator } from "../index";
import { layoutTreeIncremental } from "@taleweaver/print";
import type { VirtualLayoutTree } from "@taleweaver/print";
import type { PageBox } from "@taleweaver/print";

// Short page (block-size 64, no margins, char width 8 / line height 16) fits a
// few one-line paragraphs, so a handful of paragraphs spans multiple pages.
const pageConfig: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize: 64,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 24,
};

// Phase 0b: `measurer`/`hyphenator` left core's `EditorConfig` for the backend's
// layout driver. The tests build the layout tree directly via core's pipeline
// (what the driver does), threading the hyphenator into `layoutTreeIncremental`
// exactly where the editor's incremental-rebuild path does, so the wiring
// behavior these tests assert still fires.
const measurer = createMockShaper(8, 16);

function makeConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
    pageConfig,
  };
}

/** Build the layout tree the backend driver would, threading the hyphenator. */
function layoutOf(
  editor: EditorState,
  config: EditorConfig,
  hyphenator?: Hyphenator,
): VirtualLayoutTree {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  const tree = layoutTreeIncremental(
    cascaded,
    null,
    null,
    config.containerWidth,
    measurer,
    config.pageConfig,
    undefined,
    undefined,
    undefined,
    undefined,
    hyphenator,
  );
  if (tree.type !== "virtual-root") throw new Error("expected virtual");
  return tree;
}

/** Type N paragraphs of text, splitting between each, to span several pages. */
function buildMultiPageDoc(config: EditorConfig, paragraphs: number): EditorState {
  let s = createInitialEditorState(config);
  for (let i = 0; i < paragraphs; i++) {
    s = reduceEditor(s, { type: "INSERT_TEXT", text: `paragraph ${i}` }, config);
    if (i < paragraphs - 1) s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
  }
  return s;
}

describe("auto-hyphenation slice 2 — hyphenator layout wiring", () => {
  it("lays out a multi-page document through both passes with a hyphenator configured", () => {
    const config = makeConfig();
    const hyphenator = createMockHyphenator({ every: 3, language: "en" });
    const editor = buildMultiPageDoc(config, 12);

    // The virtual measure pass ran (the producer threaded the hyphenator into
    // buildBlockFitMetas / resolveFootnotes / makeVirtualLayoutTree).
    const tree = layoutOf(editor, config, hyphenator);
    expect(tree.type).toBe("virtual-root");
    const vtree = tree;
    const pageCount = vtree.plan.entries.length;
    // 12 short paragraphs at ~3-4 per 64px page → multiple pages.
    expect(pageCount).toBeGreaterThan(1);

    // The render pass (getPage → per-page layoutBlock) materializes every page
    // without error — the hyphenator reached the per-page layout closure too.
    const pages: PageBox[] = [];
    for (let i = 0; i < pageCount; i++) {
      pages.push(vtree.getPage(i));
    }
    expect(pages).toHaveLength(pageCount);
    for (const page of pages) {
      expect(page.type).toBe("page");
    }
  });

  it("produces an identical page count with and without a hyphenator (slice-2 no-op)", () => {
    // The hyphenator is carried but UNUSED in this slice, so threading it must
    // not change layout output. Same doc, same page count.
    const config = makeConfig();
    const hyphenator = createMockHyphenator({ every: 3, language: "en" });
    const withDoc = buildMultiPageDoc(config, 12);
    const withoutDoc = buildMultiPageDoc(config, 12);
    const withTree = layoutOf(withDoc, config, hyphenator);
    const withoutTree = layoutOf(withoutDoc, config, undefined);
    expect(withTree.type).toBe("virtual-root");
    expect(withoutTree.type).toBe("virtual-root");
    expect(withTree.plan.entries.length).toBe(withoutTree.plan.entries.length);
  });
});

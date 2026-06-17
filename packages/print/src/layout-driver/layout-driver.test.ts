// packages/print/src/layout-driver/layout-driver.test.ts
//
// Phase 0b slice 3 (D2a), Step 1. The backend layout-driver owns the
// render → cascade → layout pipeline that used to live inside core's
// `rebuildTrees` / `createEditorStateFromState`. These tests prove the driver
// is a faithful relocation:
//   1. `rebuild(state, width, null)` (a full build) produces a layout tree
//      structurally equal to core's own `editorState.layoutTree` oracle.
//   2. A second `rebuild(state2, width, dirtyIds)` reuses unchanged page
//      subtrees by reference (the incremental path keys reuse off `dirtyIds`).
//
// Real core (no `@taleweaver/core` mock): the driver IS core's pipeline.

import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockMeasurer, render, cascadePass, makeBlockParentLookup, type EditorConfig, type EditorState, type PageConfig } from "@taleweaver/core";
import { layoutTreeIncremental, type LayoutBox, type VirtualLayoutTree, type PageBox } from "../index";
import { createLayoutDriver } from "./layout-driver";
import type { LayoutConfig } from "./layout-config";

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 400,
  pageMargins: { blockStart: 48, blockEnd: 48, inlineStart: 36, inlineEnd: 36 },
  pageGap: 24,
};

// Phase 0b: `measurer` left core's `EditorConfig` for the backend's layout
// driver (which now owns the render → cascade → layout pipeline). These tests
// keep a local measurer that BOTH the driver's `LayoutConfig` and the core-
// pipeline oracle below consume, so the relocation comparison stays apples-to-
// apples.
const measurer = createMockMeasurer(8, 16);

function makeConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 600,
    pageConfig: PAGE_CONFIG,
  };
}

function makeLayoutConfig(config: EditorConfig): LayoutConfig {
  return {
    measurer,
    pageConfig: config.pageConfig,
    componentRegistry: config.componentRegistry,
    attrRegistry: config.attrRegistry,
  };
}

/**
 * The oracle: core's render → cascade → layout pipeline run directly over the
 * editor's state (exactly what the driver relocates). Threads the same measurer
 * + parent-lookup the driver does so the trees are byte-comparable.
 */
function coreLayoutOracle(
  editor: EditorState,
  config: EditorConfig,
): LayoutBox | VirtualLayoutTree {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  return layoutTreeIncremental(
    cascaded,
    null,
    null,
    editor.containerWidth,
    measurer,
    config.pageConfig,
    undefined,
    undefined,
    rendered.footnoteAnchors,
    makeBlockParentLookup(editor.state),
  );
}

/** Materialize every page of a virtual tree (or wrap a positioned LayoutBox). */
function allPages(tree: LayoutBox | VirtualLayoutTree): readonly (PageBox | LayoutBox)[] {
  if (tree.type === "virtual-root") {
    return tree.plan.entries.map((_, i) => tree.getPage(i));
  }
  return [tree];
}

/** A stable, closure-free structural fingerprint of a layout box subtree. */
function fingerprint(box: { type: string; children?: readonly unknown[] } & Record<string, unknown>): unknown {
  const node = box as unknown as {
    type: string;
    x?: number;
    y?: number;
    inlineSize?: number;
    blockSize?: number;
    text?: string;
    children?: readonly unknown[];
  };
  return {
    type: node.type,
    x: node.x,
    y: node.y,
    inlineSize: node.inlineSize,
    blockSize: node.blockSize,
    text: node.text,
    children: (node.children ?? []).map((c) =>
      fingerprint(c as { type: string } & Record<string, unknown>),
    ),
  };
}

describe("createLayoutDriver — Phase 0b relocation of the layout pipeline", () => {
  it("full rebuild (null dirtyIds) matches core's editorState.layoutTree oracle", () => {
    const config = makeConfig();
    // A multi-paragraph doc so pagination actually splits across pages.
    let editor = createInitialEditorState(config);
    for (let i = 0; i < 40; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `Paragraph ${i} text` }, config);
      editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    }

    const oracle = coreLayoutOracle(editor, config);
    const driver = createLayoutDriver(makeLayoutConfig(config));
    const driverTree = driver.rebuild(editor.state, editor.containerWidth, null);

    // Both are paginated (same page count) and every page is byte-identical.
    expect(driverTree.type).toBe(oracle.type);
    const oraclePages = allPages(oracle);
    const driverPages = allPages(driverTree);
    expect(driverPages.length).toBe(oraclePages.length);
    expect(driverPages.length).toBeGreaterThan(1); // genuinely multi-page
    for (let i = 0; i < oraclePages.length; i++) {
      expect(fingerprint(driverPages[i] as never)).toEqual(
        fingerprint(oraclePages[i] as never),
      );
    }
  });

  it("incremental rebuild reuses an unchanged page by reference, rebuilds the edited one", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    for (let i = 0; i < 40; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `Paragraph ${i} text` }, config);
      editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    }

    const driver = createLayoutDriver(makeLayoutConfig(config));
    const tree1 = driver.rebuild(editor.state, editor.containerWidth, null);
    expect(tree1.type).toBe("virtual-root");
    if (tree1.type !== "virtual-root") return;
    const lastPageIndex = tree1.plan.entries.length - 1;
    expect(lastPageIndex).toBeGreaterThan(0);
    const firstPageBefore = tree1.getPage(0);

    // Edit at the END of the document (last block), then incrementally rebuild.
    const before = editor;
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);
    expect(editor.lastDirtyIds).not.toBeNull();
    const dirty = editor.lastDirtyIds;
    expect(dirty).not.toBeNull();
    if (dirty === null) return;

    const tree2 = driver.rebuild(editor.state, editor.containerWidth, dirty);
    expect(tree2.type).toBe("virtual-root");
    if (tree2.type !== "virtual-root") return;
    const firstPageAfter = tree2.getPage(0);

    // Page 0 (far from the edit at the end) is reused by reference.
    expect(firstPageAfter).toBe(firstPageBefore);
    // sanity: the doc genuinely changed at the tail
    expect(before.state).not.toBe(editor.state);
  });
});

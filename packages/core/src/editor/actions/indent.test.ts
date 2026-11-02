/**
 * `INDENT` / `OUTDENT` actions + `handleIndent` (indent / outdent — the Google
 * Docs increase/decrease-indent toolbar control).
 *
 * Each action steps the per-block `marginInlineStart` attr by ±`INDENT_STEP`
 * (48px ≈ 0.5in) on the target LEAF block(s): the focus block for a collapsed
 * selection, or every leaf the span covers for a range selection. The step is
 * read-modify-write PER BLOCK so blocks at different current indents each move
 * independently, and outdenting to 0 CLEARS the attr (so the block renders
 * identically to a never-indented one). The attr flows render (component
 * synthesizes `marginInlineStart` onto the ElementBox style) → layout (the BFC
 * insets the in-flow block and narrows its width). The reflow proof lives in the
 * integration test (`integration/state-render-cascade-layout.test.ts`); these
 * behavior tests assert the attr write, the step arithmetic, the clamp at 0,
 * per-block independence, selection preservation, and undo — mirroring
 * `set-line-spacing.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  measurer,
  createEditor, firstChildId, createPosition, createSpan } from "./test-helpers";
import { INDENT_STEP, MIN_INDENT_CONTENT_WIDTH } from "./helpers/shift-indent";
import { type Editor } from "../editor";
import { getBlock } from "../../state";
import type { BlockId, Document, Selection } from "../../state";
import { buildDocument, buildBlock, inlineContent, text } from "../../test-utils/document-builders";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "@taleweaver/print";
import { positionTreeForTest } from "@taleweaver/print";
import type { LayoutBox } from "@taleweaver/print";

// Phase 0b: core's `Editor` is geometry-free — the INDENT/OUTDENT handler
// reads no layout, so build only the geometry-free fields. The genuine
// indent-clamp GEOMETRY is asserted via `render → cascadePass → layoutTree`
// directly (the `listItemBox` helper below), exactly what the backend driver does.
function makeEditor(document: Document, selection: Selection): Editor {
  return createEditor(config, { document, selection: selection });
}

describe("handleIndent — INDENT / OUTDENT actions", () => {
  it("INDENT on a fresh block: sets marginInlineStart to one step", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(initial.document) as BlockId;

    // Baseline: no marginInlineStart attr.
    expect(getBlock(initial.document, paraId)?.attrs.marginInlineStart).toBeUndefined();

    const before = initial.snapshot();
    initial.dispatch({ type: "INDENT" });

    expect(getBlock(initial.document, paraId)?.attrs.marginInlineStart).toBe(INDENT_STEP);
    expect(INDENT_STEP).toBe(48);
    // A real change → new state reference.
    expect(initial.document).not.toBe(before.document);
  });

  it("INDENT twice: accumulates to two steps", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    let editor = initial;
    const paraId = firstChildId(editor.document) as BlockId;

    editor.dispatch({ type: "INDENT" });
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(48);

    editor.dispatch({ type: "INDENT" });
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(96);
  });

  it("INDENT caps at containerWidth - MIN_INDENT_CONTENT_WIDTH (can't push content off the page)", () => {
    // Narrow container → cap reached quickly: maxIndent = 200 - 96 = 104.
    const narrow = { ...config, containerWidth: 200 };
    const maxIndent = 200 - MIN_INDENT_CONTENT_WIDTH; // 104
    const initial = createEditor(narrow);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    let editor = initial;
    const paraId = firstChildId(editor.document) as BlockId;

    // Indent well past the cap (10 × 48 = 480 ≫ 104).
    for (let i = 0; i < 10; i++) {
      editor.dispatch({ type: "INDENT" });
    }
    // Capped exactly at maxIndent — never exceeds it (no off-page push).
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(maxIndent);

    // OUTDENT still works from the cap (reduces by one step).
    editor.dispatch({ type: "OUTDENT" });
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(maxIndent - INDENT_STEP);
  });

  it("OUTDENT from one step: clears the attr (back to 0 / undefined)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    let editor = initial;
    const paraId = firstChildId(editor.document) as BlockId;

    editor.dispatch({ type: "INDENT" });
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(48);

    editor.dispatch({ type: "OUTDENT" });
    // Outdent to 0 removes the attr entirely (renders like a never-indented block).
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBeUndefined();
  });

  it("OUTDENT from 0: no-op (clamped — same editor reference via the identity guard)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(initial.document) as BlockId;

    expect(getBlock(initial.document, paraId)?.attrs.marginInlineStart).toBeUndefined();

    const before = initial.snapshot();
    initial.dispatch({ type: "OUTDENT" });

    // Already at 0 → clamped → nothing changed. Phase 0b: the no-op identity is
    // `document` reference equality — the editor OBJECT differs because the dispatch
    // entry-clear strips the prior mutating INSERT_TEXT's stale `lastDirtyIds` hint.
    expect(initial.document).toBe(before.document);
    expect(initial.lastDirtyIds).toBeNull();
  });

  it("multi-block selection: paragraphs each +1 step; list-items are SKIPPED (I5)", () => {
    // p0 starts un-indented; the section's list-item `li` starts at 48. After
    // INDENT over the whole span, each PARAGRAPH leaf advances one step from its
    // own start (per-block read-modify-write), while the list-item is left
    // untouched — INDENT/OUTDENT skip list-items (their nesting is the listLevel
    // attr, edited by Tab→LIST_INDENT, not marginInlineStart).
    const initialDocument = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p2" }),
        buildBlock({
          id: "p0",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "sec",
          inlineContent: inlineContent([text("p0")]),
        }),
        buildBlock({
          id: "sec",
          type: "section",
          parentId: "doc",
          prevSiblingId: "p0",
          nextSiblingId: "p2",
          firstChildId: "li",
          lastChildId: "li",
        }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "sec",
          attrs: { listId: "L1", listLevel: 0, marginInlineStart: 48 },
          inlineContent: inlineContent([text("li")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "sec",
          inlineContent: inlineContent([text("p2")]),
        }),
      ],
    });
    const editor = makeEditor(initialDocument, {
      anchor: createPosition("p0" as BlockId, 0),
      focus: createPosition("p2" as BlockId, 2),
    });

    editor.dispatch({ type: "INDENT" });

    // p0: 0 → 48; p2: 0 → 48 (each paragraph steps from its own start).
    expect(getBlock(editor.document, "p0" as BlockId)?.attrs.marginInlineStart).toBe(48);
    expect(getBlock(editor.document, "p2" as BlockId)?.attrs.marginInlineStart).toBe(48);

    // The list-item is SKIPPED (I5) — its marginInlineStart stays at 48.
    expect(getBlock(editor.document, "li" as BlockId)?.attrs.marginInlineStart).toBe(48);

    // Containers are NOT indented.
    expect(getBlock(editor.document, "sec" as BlockId)?.attrs.marginInlineStart).toBeUndefined();
  });

  it("INDENT on a collapsed caret IN a list-item is a no-op (list-items are skipped)", () => {
    const initialDocument = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "doc",
          attrs: { listId: "L1" },
          inlineContent: inlineContent([text("item")]),
        }),
      ],
    });
    const editor = makeEditor(initialDocument, {
      anchor: createPosition("li" as BlockId, 0),
      focus: createPosition("li" as BlockId, 0),
    });

    const before = editor.snapshot();
    editor.dispatch({ type: "INDENT" });

    // Skipped → no marginInlineStart written, same editor reference (identity guard).
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
    expect(getBlock(editor.document, "li" as BlockId)?.attrs.marginInlineStart).toBeUndefined();
  });

  it("preserves the selection (indent does not move the caret)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(initial.document) as BlockId;
    const selection = createSpan(createPosition(paraId, 0), createPosition(paraId, 2));
    initial.dispatch({ type: "SET_SELECTION", selection });

    const before = initial.snapshot();
    initial.dispatch({ type: "INDENT" });

    expect(initial.selection).toEqual(before.selection);
  });

  it("undo restores the prior indent", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    let editor = initial;
    const paraId = firstChildId(editor.document) as BlockId;

    editor.dispatch({ type: "INDENT" });
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(48);

    editor.dispatch({ type: "INDENT" });
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(96);

    editor.dispatch({ type: "UNDO" });
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(48);
  });

  it("a list-item composes its level padding with a user marginInlineStart in layout", () => {
    // The indent BUTTON skips list-items, but a list-item CAN carry a user
    // marginInlineStart from another path. The BFC composes the two
    // (childInlineStart = parent.paddingInlineStart + child.marginInlineStart),
    // and the item's OWN paddingInlineStart (the level indent) still insets its
    // content — so the box shifts by the margin while the level padding stays.
    function findBlockBox(box: LayoutBox, key: string): LayoutBox | null {
      if (box.key === key) return box;
      if ("children" in box) {
        for (const child of box.children) {
          const found = findBlockBox(child, key);
          if (found !== null) return found;
        }
      }
      return null;
    }

    function listItemBox(margin: number | undefined): LayoutBox {
      const document = buildDocument({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
          buildBlock({
            id: "li",
            type: "list-item",
            parentId: "doc",
            attrs: { listId: "L1", listLevel: 1, marginInlineStart: margin },
            inlineContent: inlineContent([text("x")]),
          }),
        ],
      });
      const rendered = render(document, config.componentRegistry, config.attrRegistry);
      const cascadedRoot = cascadePass(rendered.root);
      const layout = positionTreeForTest(
        layoutTree(cascadedRoot, config.containerWidth, measurer, config.pageConfig),
      );
      const box = findBlockBox(layout, "li");
      if (box === null) throw new Error("no list-item box");
      return box;
    }

    const base = listItemBox(undefined); // level padding, no user margin
    const indented = listItemBox(48); // level padding + user margin

    // The level padding (the item's own paddingInlineStart) is present and is
    // INDEPENDENT of the user margin.
    expect(base.usedStyle.paddingInlineStart).toBeGreaterThan(0);
    expect(indented.usedStyle.paddingInlineStart).toBe(base.usedStyle.paddingInlineStart);

    // The user margin shifts the box inline by exactly 48, composing on top of
    // the level padding (which keeps insetting the content within the box).
    // `box.x` is parent-relative; the list-item is a direct child of the doc
    // root (no parent padding), so here it equals the absolute inline offset.
    expect(base.x).toBe(0);
    expect(indented.x).toBe(48);
  });
});

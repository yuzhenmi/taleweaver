/**
 * BUG 2 (downstream of BUG 1): cursor "Up" from a new section's first line
 * resolved to a LEAKED block. Because `materializePage` ignored the section
 * page-break cap, section 1's last page materialized the next section's first
 * block(s); line-navigation then found that leaked block on the wrong page and
 * the "Up" move landed on a position the user never sees as the line above —
 * or failed to move at all.
 *
 * This test exercises the real editor: cursor at `{ section2FirstBlock, 0 }`
 * (top of section 2's first page), drive a MOVE_LINE "up" intent through the
 * print backend's `resolveNavIntent` (driver layout → SET_SELECTION), and assert
 * the focus MOVED to a position OWNED by section 1's LAST block. A CONTROL case
 * confirms Up across an ordinary (non-section) page break still moves to the
 * previous page's last block.
 *
 * Migrated from `packages/core/src/cursor/section-line-nav.test.ts` (Phase 0b:
 * MOVE_LINE left core's reducer for the print backend). Assertions byte-identical;
 * the layout config (page geometry) now lives on the driver via `makeNavEditor`'s
 * `pageConfig` option.
 */
import { describe, it, expect } from "vitest";
import { getBlock, type BlockId, type PageConfig } from "@taleweaver/core";
import { makeNavEditor, dispatch, nav, type NavCtx } from "./nav-test-helpers";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// line height 16, char width 8; page 64 / 0 margins ⇒ 4 lines per page.
function makeConfig(pageBlockSize = 64): PageConfig {
  return {
    pageInlineSize: 800,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

/** Build an N-paragraph doc in one O(N) PASTE (one paragraph per line). */
function buildPasted(pageConfig: PageConfig, n: number): NavCtx {
  const ctx = makeNavEditor({ pageConfig, containerWidth: 800 });
  const text = Array.from({ length: n }, (_, i) => `para ${i}`).join("\n");
  return dispatch(ctx, { type: "PASTE", text });
}

/** Direct children of the document root, in order. */
function rootChildIds(ctx: NavCtx): BlockId[] {
  const root = getBlock(ctx.editor.state, ctx.editor.state.rootId);
  if (root === null || root.firstChildId === null) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = root.firstChildId;
  while (id !== null) {
    ids.push(id);
    id = getBlock(ctx.editor.state, id)?.nextSiblingId ?? null;
  }
  return ids;
}

/** Children of a block, in order. */
function childIds(ctx: NavCtx, parent: BlockId): BlockId[] {
  const block = getBlock(ctx.editor.state, parent);
  if (block === null || block.firstChildId === null) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = block.firstChildId;
  while (id !== null) {
    ids.push(id);
    id = getBlock(ctx.editor.state, id)?.nextSiblingId ?? null;
  }
  return ids;
}

function nthBlockId(ctx: NavCtx, n: number): BlockId {
  const id = rootChildIds(ctx)[n];
  if (id === undefined) throw new Error(`no block ${n}`);
  return id;
}

describe("line-navigation across a section page break (BUG 2)", () => {
  it("MOVE_LINE up from the top of section 2's first page lands in section 1's LAST block", () => {
    const pageConfig = makeConfig();
    // 6 one-line paragraphs; break at index 2 so section A = [p0, p1] (does NOT
    // fill page 0), section B = [p2..p5] starts a fresh page.
    let ctx = buildPasted(pageConfig, 6);
    const boundary = nthBlockId(ctx, 2);
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: {
        anchor: { blockId: boundary, offset: 0 },
        focus: { blockId: boundary, offset: 0 },
      },
    });
    ctx = dispatch(ctx, { type: "SECTION_BREAK" });

    const sections = rootChildIds(ctx);
    expect(sections).toHaveLength(2);
    const secA = nth(sections, 0, "section A");
    const secB = nth(sections, 1, "section B");

    // Section A's LAST paragraph, and section B's FIRST paragraph.
    const secAChildren = childIds(ctx, secA);
    const secBChildren = childIds(ctx, secB);
    expect(secAChildren.length).toBeGreaterThanOrEqual(1);
    expect(secBChildren.length).toBeGreaterThanOrEqual(1);
    const sectionALastBlock = nth(secAChildren, secAChildren.length - 1, "section A last block");
    const sectionBFirstBlock = nth(secBChildren, 0, "section B first block");

    // Put the cursor at the very top of section 2's first page.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: {
        anchor: { blockId: sectionBFirstBlock, offset: 0 },
        focus: { blockId: sectionBFirstBlock, offset: 0 },
      },
    });

    // Move up one line.
    const moved = nav(ctx, { type: "MOVE_LINE", direction: "up" });

    // The focus must have MOVED (not stayed in section B's first block) and must
    // land in section 1's LAST block — the line visually above.
    expect(moved.editor.selection.focus.blockId).not.toBe(sectionBFirstBlock);
    expect(moved.editor.selection.focus.blockId).toBe(sectionALastBlock);
  });

  it("CONTROL: MOVE_LINE up across an ordinary (non-section) page break moves to the previous page's last block", () => {
    const pageConfig = makeConfig();
    // 8 one-line paragraphs over 4-line pages ⇒ p0..p3 on page 0, p4..p7 on
    // page 1. No sections. Up from p4 (first line of page 1) → p3 (last of page 0).
    const ctx = buildPasted(pageConfig, 8);
    const page1First = nthBlockId(ctx, 4);
    const page0Last = nthBlockId(ctx, 3);

    const placed = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: {
        anchor: { blockId: page1First, offset: 0 },
        focus: { blockId: page1First, offset: 0 },
      },
    });
    const moved = nav(placed, { type: "MOVE_LINE", direction: "up" });
    expect(moved.editor.selection.focus.blockId).not.toBe(page1First);
    expect(moved.editor.selection.focus.blockId).toBe(page0Last);
  });
});

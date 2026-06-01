/**
 * BUG 2 (downstream of BUG 1): cursor "Up" from a new section's first line
 * resolved to a LEAKED block. Because `materializePage` ignored the section
 * page-break cap, section 1's last page materialized the next section's first
 * block(s); line-navigation then found that leaked block on the wrong page and
 * the "Up" move landed on a position the user never sees as the line above —
 * or failed to move at all.
 *
 * This test exercises the real editor: cursor at `{ section2FirstBlock, 0 }`
 * (top of section 2's first page), dispatch MOVE_LINE "up", and assert the focus
 * MOVED to a position OWNED by section 1's LAST block. A CONTROL case confirms
 * Up across an ordinary (non-section) page break still moves to the previous
 * page's last block.
 *
 * This is the SAME root cause as BUG 1, so it passes once BUG 1 is fixed.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createMockShaper,
  getBlock,
  createPosition,
  type EditorConfig,
  type PageConfig,
  type EditorState,
  type BlockId,
} from "../index";

// line height 16, char width 8; page 64 / 0 margins ⇒ 4 lines per page.
function makeConfig(pageBlockSize = 64): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 800,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
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

/** Build an N-paragraph doc in one O(N) PASTE (one paragraph per line). */
function buildPasted(config: EditorConfig, n: number): EditorState {
  const text = Array.from({ length: n }, (_, i) => `para ${i}`).join("\n");
  return reduceEditor(createInitialEditorState(config), { type: "PASTE", text }, config);
}

/** Direct children of the document root, in order. */
function rootChildIds(editor: EditorState): BlockId[] {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = root.firstChildId;
  while (id !== null) {
    ids.push(id);
    id = getBlock(editor.state, id)?.nextSiblingId ?? null;
  }
  return ids;
}

/** Children of a block, in order. */
function childIds(editor: EditorState, parent: BlockId): BlockId[] {
  const block = getBlock(editor.state, parent);
  if (block === null || block.firstChildId === null) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = block.firstChildId;
  while (id !== null) {
    ids.push(id);
    id = getBlock(editor.state, id)?.nextSiblingId ?? null;
  }
  return ids;
}

function nthBlockId(editor: EditorState, n: number): BlockId {
  const id = rootChildIds(editor)[n];
  if (id === undefined) throw new Error(`no block ${n}`);
  return id;
}

describe("line-navigation across a section page break (BUG 2)", () => {
  it("MOVE_LINE up from the top of section 2's first page lands in section 1's LAST block", () => {
    const config = makeConfig();
    // 6 one-line paragraphs; break at index 2 so section A = [p0, p1] (does NOT
    // fill page 0), section B = [p2..p5] starts a fresh page.
    let editor = buildPasted(config, 6);
    const boundary = nthBlockId(editor, 2);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: createPosition(boundary, 0), focus: createPosition(boundary, 0) } },
      config,
    );
    editor = reduceEditor(editor, { type: "SECTION_BREAK" }, config);

    const sections = rootChildIds(editor);
    expect(sections).toHaveLength(2);
    const [secA, secB] = sections;

    // Section A's LAST paragraph, and section B's FIRST paragraph.
    const secAChildren = childIds(editor, secA);
    const secBChildren = childIds(editor, secB);
    expect(secAChildren.length).toBeGreaterThanOrEqual(1);
    expect(secBChildren.length).toBeGreaterThanOrEqual(1);
    const sectionALastBlock = secAChildren[secAChildren.length - 1];
    const sectionBFirstBlock = secBChildren[0];

    // Put the cursor at the very top of section 2's first page.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: createPosition(sectionBFirstBlock, 0),
          focus: createPosition(sectionBFirstBlock, 0),
        },
      },
      config,
    );

    // Move up one line.
    const moved = reduceEditor(editor, { type: "MOVE_LINE", direction: "up" }, config);

    // The focus must have MOVED (not stayed in section B's first block) and must
    // land in section 1's LAST block — the line visually above.
    expect(moved.selection.focus.blockId).not.toBe(sectionBFirstBlock);
    expect(moved.selection.focus.blockId).toBe(sectionALastBlock);
  });

  it("CONTROL: MOVE_LINE up across an ordinary (non-section) page break moves to the previous page's last block", () => {
    const config = makeConfig();
    // 8 one-line paragraphs over 4-line pages ⇒ p0..p3 on page 0, p4..p7 on
    // page 1. No sections. Up from p4 (first line of page 1) → p3 (last of page 0).
    const editor = buildPasted(config, 8);
    const page1First = nthBlockId(editor, 4);
    const page0Last = nthBlockId(editor, 3);

    const placed = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: createPosition(page1First, 0),
          focus: createPosition(page1First, 0),
        },
      },
      config,
    );
    const moved = reduceEditor(placed, { type: "MOVE_LINE", direction: "up" }, config);
    expect(moved.selection.focus.blockId).not.toBe(page1First);
    expect(moved.selection.focus.blockId).toBe(page0Last);
  });
});

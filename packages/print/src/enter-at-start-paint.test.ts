// Regression (view layer): Enter at the first position of a single-page doc
// must REPAINT page 0 — the text that moved from line 0 to line 1 must be drawn
// at its new (lower) position. Uses the mock shaper (correct layout: empty
// strut on line 0 h=16, text on line 1) so this isolates the controller's paint
// flow: getPage(0) → paintPage(... persistent cache) against a spy ctx.
//
// The bug this guards: the virtual tree's per-page layout reuse returned the
// shifted text box at its STALE line-0 offset, so paintPage drew "Welcome" at
// the old y after Enter even though the model had moved it to line 1.
import { describe, it, expect } from "vitest";
import { paintPage } from "./canvas-renderer";
import { createPaintCache } from "./paint-cache";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, getBlock, createPosition, createSpan, render, cascadePass, type EditorConfig, type PageConfig, type EditorState, type BlockId } from "@taleweaver/core";
import { layoutTree, type LayoutBox } from "./index";

// Phase 0b: core's `EditorState` is geometry-free — the layout tree lives in the
// backend driver. Build it via core's render → cascade → layout pipeline (what
// the driver does) for the paint assertions below.
const measurer = createMockShaper(8, 16);

type Ctx = Parameters<typeof paintPage>[0];

interface FillText { text: string; y: number; }
function makeSpyCtx(): { ctx: Ctx; fills: FillText[] } {
  const fills: FillText[] = [];
  const stub = {
    canvas: { width: 816, height: 1056 }, font: "", textBaseline: "top", fillStyle: "", globalAlpha: 1,
    clearRect() {}, fillRect() {},
    fillText(text: string, _x: number, y: number) { fills.push({ text, y }); },
    measureText: (t: string) => ({ width: t.length * 8 }),
    save() {}, restore() {}, scale() {}, setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
  };
  return { ctx: stub as unknown as Ctx, fills };
}

function makeConfig(): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 816, pageBlockSize: 1056,
    pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 }, pageGap: 24,
  };
  return { componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(), containerWidth: 800, pageConfig };
}

function getPage0(editor: EditorState, config: EditorConfig): LayoutBox {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  const lt = layoutTree(cascaded, config.containerWidth, measurer, config.pageConfig);
  if (lt.type === "virtual-root") return lt.getPage(0);
  // Non-paginated / legacy fallback: `lt` is already a positioned `LayoutBox`.
  if (!("children" in lt)) throw new Error("expected positioned tree");
  const page0 = lt.children[0];
  if (page0 === undefined) throw new Error("expected page 0");
  return page0;
}

function firstChildId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no first block");
  return root.firstChildId;
}

const CURSOR = { x: 0, y: 0, height: 16 };

function welcomeY(fills: FillText[]): number {
  // #330: text paints one fillText PER CLUSTER (per code unit), so "Welcome"
  // is drawn as W,e,l,c,o,m,e — all on the same line (same y). The first
  // cluster ("W") carries that line's y. (The seeded doc has no other "W".)
  const hit = fills.find((f) => f.text === "W");
  if (hit === undefined) throw new Error("'Welcome' was not painted");
  return hit.y;
}

describe("Enter at first position repaints page 0 (view-layer regression)", () => {
  it("repaints 'Welcome' at the new (lower) line after Enter", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    const firstId = firstChildId(editor);
    editor = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "Welcome" }, config);

    const cache = createPaintCache();
    const mount = makeSpyCtx();
    paintPage(mount.ctx, getPage0(editor, config), [], [], [], [], CURSOR, "active", undefined, cache);
    const mountY = welcomeY(mount.fills);

    // Enter at the very start, then repaint page 0 with the SAME persistent
    // cache — exactly the controller's per-frame flow.
    editor = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) }, config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const after = makeSpyCtx();
    paintPage(after.ctx, getPage0(editor, config), [], [], [], [], CURSOR, "active", undefined, cache);

    // 'Welcome' must be redrawn LOWER (it moved from line 0 to line 1).
    expect(welcomeY(after.fills)).toBeGreaterThan(mountY);
  });
});

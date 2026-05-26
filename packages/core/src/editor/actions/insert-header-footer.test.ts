/**
 * C.2c T8: `INSERT_HEADER` / `INSERT_FOOTER` editor action + handler.
 *
 * The browser-verify vehicle (capstone of C.2c): dispatching INSERT_HEADER
 * creates a one-paragraph header template body, links it on the doc-root
 * (implicit section) via `attrs.headerBlockId`, and places a collapsed caret
 * in the new body. INSERT_FOOTER is symmetric (`footerBlockId`). The
 * create→caret→type chain is what makes the whole slice exercisable: type in
 * the new header → it repeats on every page (browser smoke, owed to the user).
 *
 * These tests run at editor-behavior level through `reduceEditor` and assert
 * via `getTemplateContent` / `getBlock` — the unit-level proxy for the smoke.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  type EditorState,
} from "./test-helpers";
import {
  getBlock,
  getTemplateContent,
  getTemplateContentIds,
} from "../../state";
import type { BlockId } from "../../state";

function templateRootCount(editor: EditorState): number {
  return [...getTemplateContentIds(editor.state)].length;
}

function joinText(
  items: ReadonlyArray<{ kind: string; text?: string }> | undefined,
): string {
  return (items ?? [])
    .map((i) => (i.kind === "text" ? (i as { text: string }).text : ""))
    .join("");
}

describe("handleInsertHeaderFooter — INSERT_HEADER", () => {
  it("creates a one-paragraph header body, links it on the doc root, and carets into it", () => {
    const initial = createInitialEditorState(config);
    expect(templateRootCount(initial)).toBe(0);

    const next = reduceEditor(initial, { type: "INSERT_HEADER" }, config);

    // A new state (real change).
    expect(next.state).not.toBe(initial.state);

    // The doc-root carries the link attr → a new body root id.
    const docRoot = getBlock(next.state, next.state.rootId);
    const headerId = docRoot?.attrs.headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;

    // The body is a one-paragraph root (parentId null, empty inline).
    const body = getTemplateContent(next.state, headerId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("paragraph");
    expect(body?.parentId).toBeNull();
    expect(body?.inlineContent).toEqual({ items: [] });

    // It's an enumerated template-content ROOT (render path #313 picks it up).
    expect([...getTemplateContentIds(next.state)]).toContain(headerId);
    expect(templateRootCount(next)).toBe(1);

    // The caret is a collapsed selection at the start of the new header body.
    expect(next.selection.anchor.blockId).toBe(headerId);
    expect(next.selection.anchor.offset).toBe(0);
    expect(next.selection.focus.blockId).toBe(headerId);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("INSERT_FOOTER creates + links a footer body and carets into it", () => {
    const initial = createInitialEditorState(config);
    const next = reduceEditor(initial, { type: "INSERT_FOOTER" }, config);

    const docRoot = getBlock(next.state, next.state.rootId);
    const footerId = docRoot?.attrs.footerBlockId as BlockId | undefined;
    expect(footerId).toBeDefined();
    expect(docRoot?.attrs.headerBlockId).toBeUndefined();
    if (footerId === undefined) return;

    expect(getTemplateContent(next.state, footerId)?.type).toBe("paragraph");
    expect(next.selection.focus.blockId).toBe(footerId);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("composes with T7: INSERT_HEADER then INSERT_TEXT types into the header body (the payoff)", () => {
    const initial = createInitialEditorState(config);
    const withHeader = reduceEditor(initial, { type: "INSERT_HEADER" }, config);
    const headerId = getBlock(withHeader.state, withHeader.state.rootId)?.attrs
      .headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;

    const typed = reduceEditor(withHeader, { type: "INSERT_TEXT", text: "Hi" }, config);

    // The header body block's text is now "Hi" (via getTemplateContent).
    expect(joinText(getTemplateContent(typed.state, headerId)?.inlineContent?.items)).toBe("Hi");
    // Caret advanced inside the header body.
    expect(typed.selection.focus.blockId).toBe(headerId);
    expect(typed.selection.focus.offset).toBe(2);
  });

  it("is idempotent (Google Docs: one header per doc): a 2nd INSERT_HEADER creates no duplicate, carets into the existing body", () => {
    const initial = createInitialEditorState(config);
    const once = reduceEditor(initial, { type: "INSERT_HEADER" }, config);
    const headerId = getBlock(once.state, once.state.rootId)?.attrs
      .headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;
    expect(templateRootCount(once)).toBe(1);

    // Move the caret OUT of the header (back into the body) before re-inserting.
    const body = getBlock(once.state, once.state.rootId);
    const bodyParaId = body?.firstChildId;
    expect(bodyParaId).toBeDefined();
    if (bodyParaId === undefined || bodyParaId === null) return;
    const moved = reduceEditor(
      once,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: bodyParaId, offset: 0 },
          focus: { blockId: bodyParaId, offset: 0 },
        },
      },
      config,
    );

    const twice = reduceEditor(moved, { type: "INSERT_HEADER" }, config);

    // Still exactly ONE template body — no duplicate created.
    expect(templateRootCount(twice)).toBe(1);
    // The link still points at the same body.
    expect(getBlock(twice.state, twice.state.rootId)?.attrs.headerBlockId).toBe(headerId);
    // The caret was placed into the EXISTING header body.
    expect(twice.selection.focus.blockId).toBe(headerId);
    expect(twice.selection.focus.offset).toBe(0);
  });

  it("undo after INSERT_HEADER removes the body + the attr (one undo entry)", () => {
    const initial = createInitialEditorState(config);
    const next = reduceEditor(initial, { type: "INSERT_HEADER" }, config);
    const headerId = getBlock(next.state, next.state.rootId)?.attrs
      .headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;
    expect(templateRootCount(next)).toBe(1);

    const undone = reduceEditor(next, { type: "UNDO" }, config);

    // Body gone, attr cleared.
    expect(getTemplateContent(undone.state, headerId)).toBeNull();
    expect(templateRootCount(undone)).toBe(0);
    expect(getBlock(undone.state, undone.state.rootId)?.attrs.headerBlockId).toBeUndefined();
  });
});

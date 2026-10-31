/**
 * C.2c T8: `INSERT_HEADER` / `INSERT_FOOTER` editor action + handler.
 *
 * The browser-verify vehicle (capstone of C.2c): dispatching INSERT_HEADER
 * creates a one-paragraph header template body, links it on the cursor's
 * ACTIVE SECTION (#485: the final section when there is no break) via `attrs.headerBlockId`, and places a collapsed caret in the new
 * body. INSERT_FOOTER is symmetric (`footerBlockId`). The
 * create→caret→type chain is what makes the whole slice exercisable: type in
 * the new header → it repeats on every page (browser smoke, owed to the user).
 *
 * These tests run at editor-behavior level through `reduceEditor` and assert
 * via `getTemplateContent` / `getBlock` — the unit-level proxy for the smoke.
 */
import { describe, it, expect } from "vitest";
import { finalSectionOf } from "../../test-utils/document-builders";
import {
  config,
  createPosition,
  createEditor,
  type Editor,
} from "./test-helpers";
import {
  getBlock,
  getTemplateContent,
  getTemplateContentIds,
  topLevelBlockIds,
} from "../../state";
import type { BlockId } from "../../state";
import { resolveActiveSection } from "./helpers/resolve-active-section";

function templateRootCount(editor: Editor): number {
  return [...getTemplateContentIds(editor.document)].length;
}

/** The document root's direct children (its sections), in order. */
function rootChildIds(editor: Editor): BlockId[] {
  const root = getBlock(editor.document, editor.document.rootId);
  if (root === null || root.firstChildId === null) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = root.firstChildId;
  while (id !== null) {
    ids.push(id);
    id = getBlock(editor.document, id)?.nextSiblingId ?? null;
  }
  return ids;
}

/**
 * Build a two-section editor (section A = [p0, H], section B = [p1, p2, ...];
 * H = the break's empty head paragraph)
 * with the cursor collapsed inside section B's first paragraph. Mirrors the
 * `twoSectionEditor` helper in `toggle-section-landscape.test.ts`: PASTE n
 * paragraphs, SET_SELECTION to the 2nd block, dispatch SECTION_BREAK, then
 * move the caret into section B's first paragraph.
 */
function twoSectionEditor(n = 3): {
  editor: Editor;
  sectionA: BlockId;
  sectionB: BlockId;
} {
  const text = Array.from({ length: n }, (_, i) => `para ${i}`).join("\n");
  let editor = createEditor(config);
  editor.dispatch({ type: "PASTE", text });
  // The boundary block = the 2nd top-level paragraph (so section A keeps p0).
  const topLevel = topLevelBlockIds(editor.document);
  const boundary = topLevel[1];
  if (boundary === undefined) throw new Error(`expected ≥2 paragraphs, got ${topLevel.length}`);
  editor.dispatch({
      type: "SET_SELECTION",
      selection: { anchor: createPosition(boundary, 0), focus: createPosition(boundary, 0) },
    });
  editor.dispatch({ type: "SECTION_BREAK" });

  const sectionIds = rootChildIds(editor);
  if (sectionIds.length !== 2) {
    throw new Error(`expected 2 sections, got ${sectionIds.length}`);
  }
  const sectionA = sectionIds[0];
  const sectionB = sectionIds[1];
  if (sectionA === undefined || sectionB === undefined) {
    throw new Error("section A/B not resolved");
  }
  const firstParaOfB = getBlock(editor.document, sectionB)?.firstChildId;
  if (firstParaOfB === undefined || firstParaOfB === null) {
    throw new Error("section B has no first child");
  }
  editor.dispatch({
      type: "SET_SELECTION",
      selection: {
        anchor: createPosition(firstParaOfB, 0),
        focus: createPosition(firstParaOfB, 0),
      },
    });
  return { editor, sectionA, sectionB };
}

function joinText(
  items: ReadonlyArray<{ kind: string; text?: string }> | undefined,
): string {
  return (items ?? [])
    .map((i) => (i.kind === "text" ? (i as { text: string }).text : ""))
    .join("");
}

/** Resolve the first paragraph child of a container body root. */
function firstChildOf(editor: Editor, rootId: BlockId): BlockId {
  const child = getTemplateContent(editor.document, rootId)?.firstChildId;
  if (child === undefined || child === null) {
    throw new Error(`body root ${rootId} has no first child`);
  }
  return child;
}

describe("handleInsertHeaderFooter — INSERT_HEADER", () => {
  it("creates a CONTAINER header body with one paragraph child, links the container, and carets into the child", () => {
    const initial = createEditor(config);
    expect(templateRootCount(initial)).toBe(0);

    const before = { ...initial };
    initial.dispatch({ type: "INSERT_HEADER" });

    // A new state (real change).
    expect(initial.document).not.toBe(before.document);

    // The (final) section carries the link attr → the CONTAINER root id.
    const docRoot = getBlock(initial.document, finalSectionOf(initial.document));
    const headerId = docRoot?.attrs.headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;

    // The body root is a `template-body` CONTAINER (parentId null, no inline).
    const body = getTemplateContent(initial.document, headerId);
    expect(body).not.toBeNull();
    expect(body?.type).toBe("template-body");
    expect(body?.parentId).toBeNull();
    expect(body?.inlineContent).toBeNull();

    // Its first child is an empty paragraph (the editable line).
    const paraId = firstChildOf(initial, headerId);
    const para = getTemplateContent(initial.document, paraId);
    expect(para?.type).toBe("paragraph");
    expect(para?.parentId).toBe(headerId);
    expect(para?.inlineContent).toEqual({ items: [] });

    // ONLY the container is an enumerated template-content ROOT (render path
    // #313 picks up exactly one root per body).
    const rootIds = [...getTemplateContentIds(initial.document)];
    expect(rootIds).toContain(headerId);
    expect(rootIds).not.toContain(paraId);
    expect(templateRootCount(initial)).toBe(1);

    // The caret is a collapsed selection at the start of the PARAGRAPH CHILD,
    // NOT the container root.
    expect(initial.selection.anchor.blockId).toBe(paraId);
    expect(initial.selection.anchor.offset).toBe(0);
    expect(initial.selection.focus.blockId).toBe(paraId);
    expect(initial.selection.focus.offset).toBe(0);
  });

  it("INSERT_FOOTER creates + links a footer container and carets into its paragraph child", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_FOOTER" });

    const docRoot = getBlock(initial.document, finalSectionOf(initial.document));
    const footerId = docRoot?.attrs.footerBlockId as BlockId | undefined;
    expect(footerId).toBeDefined();
    expect(docRoot?.attrs.headerBlockId).toBeUndefined();
    if (footerId === undefined) return;

    expect(getTemplateContent(initial.document, footerId)?.type).toBe("template-body");
    const paraId = firstChildOf(initial, footerId);
    expect(getTemplateContent(initial.document, paraId)?.type).toBe("paragraph");
    expect(initial.selection.focus.blockId).toBe(paraId);
    expect(initial.selection.focus.offset).toBe(0);
  });

  it("composes with map-agnostic ops: INSERT_HEADER then INSERT_TEXT types into the header body's paragraph child (the payoff)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_HEADER" });
    const headerId = getBlock(initial.document, finalSectionOf(initial.document))?.attrs
      .headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;
    const paraId = firstChildOf(initial, headerId);

    initial.dispatch({ type: "INSERT_TEXT", text: "Hi" });

    // The header body's paragraph child now reads "Hi".
    expect(joinText(getTemplateContent(initial.document, paraId)?.inlineContent?.items)).toBe("Hi");
    // Caret advanced inside the paragraph child.
    expect(initial.selection.focus.blockId).toBe(paraId);
    expect(initial.selection.focus.offset).toBe(2);
  });

  it("#326: INSERT_HEADER then Enter (SPLIT_NODE) adds a SECOND paragraph child UNDER the same container (no orphan root)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_HEADER" });
    const headerId = getBlock(initial.document, finalSectionOf(initial.document))?.attrs
      .headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;
    const firstParaId = firstChildOf(initial, headerId);

    // Type a line then press Enter — the caret is in the paragraph child.
    initial.dispatch({ type: "INSERT_TEXT", text: "Title" });
    initial.dispatch({ type: "SPLIT_NODE" });

    // Still exactly ONE template-content ROOT (the container) — Enter did NOT
    // orphan a second root.
    expect(templateRootCount(initial)).toBe(1);
    expect([...getTemplateContentIds(initial.document)]).toEqual([headerId]);

    // The container now has TWO distinct children (a chained pair).
    const container = getTemplateContent(initial.document, headerId);
    expect(container?.type).toBe("template-body");
    const firstChild = container?.firstChildId as BlockId | null;
    const lastChild = container?.lastChildId as BlockId | null;
    expect(firstChild).not.toBeNull();
    expect(lastChild).not.toBeNull();
    expect(firstChild).not.toBe(lastChild);
    if (firstChild === null || lastChild === null) return;

    // Both children are paragraphs whose parentId is the container (descendants
    // of the slot root, so the slot renders both lines).
    const c0 = getTemplateContent(initial.document, firstChild);
    const c1 = getTemplateContent(initial.document, lastChild);
    expect(c0?.type).toBe("paragraph");
    expect(c1?.type).toBe("paragraph");
    expect(c0?.parentId).toBe(headerId);
    expect(c1?.parentId).toBe(headerId);
    // The sibling chain links them.
    expect(c0?.nextSiblingId).toBe(lastChild);
    expect(c1?.prevSiblingId).toBe(firstChild);
    // the split's head is the new block, so the original
    // paragraph (keeping its ¶) is now the LAST child — and holds the caret.
    expect(lastChild).toBe(firstParaId);
    expect(initial.selection.focus.blockId).toBe(lastChild);
    expect(initial.selection.focus.offset).toBe(0);
  });

  it("is idempotent (Google Docs: one header per doc): a 2nd INSERT_HEADER creates no duplicate, carets into the existing body's first paragraph child", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_HEADER" });
    const headerId = getBlock(initial.document, finalSectionOf(initial.document))?.attrs
      .headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;
    expect(templateRootCount(initial)).toBe(1);
    const paraId = firstChildOf(initial, headerId);

    // Move the caret OUT of the header (back into the body) before re-inserting.
    const body = getBlock(initial.document, finalSectionOf(initial.document));
    const bodyParaId = body?.firstChildId;
    expect(bodyParaId).toBeDefined();
    if (bodyParaId === undefined || bodyParaId === null) return;
    initial.dispatch({
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: bodyParaId, offset: 0 },
          focus: { blockId: bodyParaId, offset: 0 },
        },
      });

    initial.dispatch({ type: "INSERT_HEADER" });

    // Still exactly ONE template body — no duplicate created.
    expect(templateRootCount(initial)).toBe(1);
    // The link still points at the same container body.
    expect(getBlock(initial.document, finalSectionOf(initial.document))?.attrs.headerBlockId).toBe(headerId);
    // The caret was placed into the EXISTING header body's FIRST paragraph child.
    expect(initial.selection.focus.blockId).toBe(paraId);
    expect(initial.selection.focus.offset).toBe(0);
  });

  it("undo after INSERT_HEADER removes the body + the attr (one undo entry)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_HEADER" });
    const headerId = getBlock(initial.document, finalSectionOf(initial.document))?.attrs
      .headerBlockId as BlockId | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;
    expect(templateRootCount(initial)).toBe(1);

    initial.dispatch({ type: "UNDO" });

    // Body gone, attr cleared.
    expect(getTemplateContent(initial.document, headerId)).toBeNull();
    expect(templateRootCount(initial)).toBe(0);
    expect(getBlock(initial.document, finalSectionOf(initial.document))?.attrs.headerBlockId).toBeUndefined();
  });
});

describe("handleInsertHeaderFooter — per-section (#485)", () => {
  it("attaches the header to the cursor's ACTIVE SECTION, not the doc root", () => {
    const { editor, sectionA, sectionB } = twoSectionEditor();

    // Precondition: the caret resolves to section B (not the doc root).
    expect(resolveActiveSection(editor, editor.selection.focus.blockId)).toBe(sectionB);

    editor.dispatch({ type: "INSERT_HEADER" });

    // The SECTION B block carries the header link...
    const secB = getBlock(editor.document, sectionB);
    const headerId = secB?.attrs.headerBlockId as BlockId | undefined;
    expect(typeof headerId).toBe("string");
    if (headerId === undefined) return;

    // ...and the DOC ROOT does NOT (the defect attached it to root).
    expect(getBlock(editor.document, editor.document.rootId)?.attrs.headerBlockId).toBeUndefined();
    // ...nor does the OTHER section.
    expect(getBlock(editor.document, sectionA)?.attrs.headerBlockId).toBeUndefined();

    // A real template body exists: a `template-body` CONTAINER + a paragraph child.
    const body = getTemplateContent(editor.document, headerId);
    expect(body?.type).toBe("template-body");
    const paraId = firstChildOf(editor, headerId);
    expect(getTemplateContent(editor.document, paraId)?.type).toBe("paragraph");
    expect(templateRootCount(editor)).toBe(1);

    // The caret landed in the new body's first paragraph.
    expect(editor.selection.focus.blockId).toBe(paraId);
    expect(editor.selection.focus.offset).toBe(0);
  });

  it("attaches to the FINAL section of a break-less doc (there is always a section; the root keeps none)", () => {
    // A bare doc with NO section break: the caret's section is the final section.
    const initial = createEditor(config);
    const finalSection = finalSectionOf(initial.document);
    expect(resolveActiveSection(initial, initial.selection.focus.blockId)).toBe(finalSection);

    initial.dispatch({ type: "INSERT_HEADER" });

    const headerId = getBlock(initial.document, finalSection)?.attrs.headerBlockId as BlockId | undefined;
    expect(typeof headerId).toBe("string");
    expect(getBlock(initial.document, initial.document.rootId)?.attrs.headerBlockId).toBeUndefined();
  });

  it("is a no-op when the caret is outside the main body (no active section)", () => {
    const withHeader = createEditor(config);
    withHeader.dispatch({ type: "INSERT_HEADER" });
    // The caret now sits in the header body's paragraph.
    expect(resolveActiveSection(withHeader, withHeader.selection.focus.blockId)).toBeNull();
    const before = { ...withHeader };
    withHeader.dispatch({ type: "INSERT_FOOTER" });
    expect(withHeader.document).toBe(before.document);
    expect(withHeader.selection).toBe(before.selection);
  });

  it("is per-section idempotent: a 2nd INSERT_HEADER in section B creates no duplicate, carets into the existing section-B body", () => {
    const { editor, sectionA, sectionB } = twoSectionEditor();

    editor.dispatch({ type: "INSERT_HEADER" });
    const headerId = getBlock(editor.document, sectionB)?.attrs.headerBlockId as
      | BlockId
      | undefined;
    expect(headerId).toBeDefined();
    if (headerId === undefined) return;
    expect(templateRootCount(editor)).toBe(1);
    const paraId = firstChildOf(editor, headerId);

    // Move the caret OUT of the header (back into section B's body) before re-inserting.
    const firstParaOfB = getBlock(editor.document, sectionB)?.firstChildId;
    expect(firstParaOfB).toBeDefined();
    if (firstParaOfB === undefined || firstParaOfB === null) return;
    editor.dispatch({
        type: "SET_SELECTION",
        selection: {
          anchor: createPosition(firstParaOfB, 0),
          focus: createPosition(firstParaOfB, 0),
        },
      });

    editor.dispatch({ type: "INSERT_HEADER" });

    // No duplicate body created (template-content root count unchanged).
    expect(templateRootCount(editor)).toBe(1);
    // Section B's link still points at the SAME container, and no second header.
    expect(getBlock(editor.document, sectionB)?.attrs.headerBlockId).toBe(headerId);
    // Section A and the doc root remain header-less.
    expect(getBlock(editor.document, sectionA)?.attrs.headerBlockId).toBeUndefined();
    expect(getBlock(editor.document, editor.document.rootId)?.attrs.headerBlockId).toBeUndefined();
    // The caret moved into the EXISTING section-B body's first paragraph.
    expect(editor.selection.focus.blockId).toBe(paraId);
    expect(editor.selection.focus.offset).toBe(0);
  });

  it("INSERT_FOOTER attaches the footer to the active section's footerBlockId, not the doc root", () => {
    const { editor, sectionA, sectionB } = twoSectionEditor();

    editor.dispatch({ type: "INSERT_FOOTER" });

    const footerId = getBlock(editor.document, sectionB)?.attrs.footerBlockId as
      | BlockId
      | undefined;
    expect(typeof footerId).toBe("string");
    if (footerId === undefined) return;

    // The doc root + section A carry no footer.
    expect(getBlock(editor.document, editor.document.rootId)?.attrs.footerBlockId).toBeUndefined();
    expect(getBlock(editor.document, sectionA)?.attrs.footerBlockId).toBeUndefined();

    expect(getTemplateContent(editor.document, footerId)?.type).toBe("template-body");
    const paraId = firstChildOf(editor, footerId);
    expect(getTemplateContent(editor.document, paraId)?.type).toBe("paragraph");
    expect(editor.selection.focus.blockId).toBe(paraId);
    expect(editor.selection.focus.offset).toBe(0);
  });
});

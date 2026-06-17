// #529 T6: INSERT_INLINE_IMAGE editor action.
//
// An inline image (Google Docs "In line" positioning) is an `inline-image`
// EmbedItem spliced at the caret — like a cross-reference / page-field field, it
// occupies exactly ONE Position.offset unit (#407: one embed = one offset), so the
// caret lands just AFTER it and a single DELETE_BACKWARD removes the whole embed
// atomically. Unlike a page-field (header/footer-only) it has NO context gate: an
// image may flow in body text, a header/footer, a footnote body, or a table cell —
// anywhere text can. So this mirrors the cross-reference handler MINUS the
// body-only gate and target validation: `prepareEmbedInsertPoint` (delete an
// expanded selection first, one undo step) → splice the embed → caret after.
//
// The fixture mirrors insert-page-field-action.test.ts: a main body paragraph
// built through the full pipeline so the handler + rebuildTrees have every
// EditorState field they expect.

import { describe, it, expect } from "vitest";
import { reduceEditor, type EditorState, type EditorConfig } from "../editor-state";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import {
  createHistory,
  createPosition,
  createSpan,
  getBlock,
  INLINE_IMAGE_EMBED_TYPE,
} from "../../state";
import type { State, BlockId, InlineItem, EmbedItem } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const config: EditorConfig = { componentRegistry, attrRegistry, containerWidth: 600 };

const BODY_P = "p" as BlockId;

const IMG = { src: "blob:img-1", width: 120, height: 80, alt: "a kitten" } as const;

function buildStateWithBody(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("ab")]),
      }),
    ],
  });
}

/**
 * Build a geometry-free EditorState with the caret at `caret`. Phase 0b: the
 * INSERT_INLINE_IMAGE handler reads only caret/selection state (no layout), so
 * the synthetic state needs only the geometry-free fields.
 */
function buildEditor(state: State, caret: { blockId: BlockId; offset: number }): EditorState {
  const cursor = createPosition(caret.blockId, caret.offset);
  return {
    state,
    selection: createSpan(cursor, cursor),
    history: createHistory(state),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

function inlineImageItemsOf(items: readonly InlineItem[] | undefined): EmbedItem[] {
  return (items ?? []).filter(
    (it): it is EmbedItem => it.kind === "embed" && it.embedType === INLINE_IMAGE_EMBED_TYPE,
  );
}
function bodyInlineImages(state: State, id: BlockId): EmbedItem[] {
  return inlineImageItemsOf(getBlock(state, id)?.inlineContent?.items);
}

describe("handleInsertInlineImage — INSERT_INLINE_IMAGE", () => {
  it("splices an inline-image EmbedItem at a collapsed caret and advances the caret by 1 (one embed = one offset)", () => {
    const editor = buildEditor(buildStateWithBody(), { blockId: BODY_P, offset: 1 }); // between "a" and "b"
    const out = reduceEditor(
      editor,
      { type: "INSERT_INLINE_IMAGE", src: IMG.src, width: IMG.width, height: IMG.height, alt: IMG.alt },
      config,
    );

    // (a) an inline-image embed carrying the supplied properties is inserted at the caret offset
    const images = bodyInlineImages(out.state, BODY_P);
    expect(images.length).toBe(1);
    expect(images[0]?.properties).toEqual({
      src: IMG.src,
      width: IMG.width,
      height: IMG.height,
      alt: IMG.alt,
    });

    // The embed lands at offset 1 (between "a" and "b"): items are ["a", <img>, "b"].
    const items = getBlock(out.state, BODY_P)?.inlineContent?.items ?? [];
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ kind: "text", text: "a" });
    expect(items[1]?.kind).toBe("embed");
    expect(items[2]).toMatchObject({ kind: "text", text: "b" });

    // (b) the caret lands AFTER the embed — exactly one offset past it.
    expect(out.selection.focus.blockId).toBe(BODY_P);
    expect(out.selection.focus.offset).toBe(2);
    expect(out.selection.anchor).toEqual(out.selection.focus); // collapsed
    expect(out.state).not.toBe(editor.state);
  });

  it("removes the whole embed in ONE DELETE_BACKWARD step (atomic, #407)", () => {
    const editor = buildEditor(buildStateWithBody(), { blockId: BODY_P, offset: 1 });
    const inserted = reduceEditor(
      editor,
      { type: "INSERT_INLINE_IMAGE", src: IMG.src, width: IMG.width, height: IMG.height, alt: IMG.alt },
      config,
    );
    expect(bodyInlineImages(inserted.state, BODY_P).length).toBe(1);
    // caret is just after the embed (offset 2) — one DELETE_BACKWARD must remove the
    // entire embed in a single step, leaving the text "ab" intact.
    const deleted = reduceEditor(inserted, { type: "DELETE_BACKWARD" }, config);
    expect(bodyInlineImages(deleted.state, BODY_P).length).toBe(0);
    const items = getBlock(deleted.state, BODY_P)?.inlineContent?.items ?? [];
    expect(items.map((it) => (it.kind === "text" ? it.text : "<embed>")).join("")).toBe("ab");
    expect(deleted.selection.focus.offset).toBe(1); // caret collapses to where the embed was
  });

  it("inserts directly (no throw) even when suggesting mode is configured — direct-mode v1", () => {
    // The field-insert handlers (cross-ref / page-field / footnote) do NOT branch on
    // suggestingAuthor — they splice directly. This handler mirrors them, so a
    // configured suggestingAuthor must NOT throw or alter the direct-insert path.
    const suggestingConfig: EditorConfig = { ...config, suggestingAuthor: "alice" };
    const editor = buildEditor(buildStateWithBody(), { blockId: BODY_P, offset: 1 });
    const out = reduceEditor(
      editor,
      { type: "INSERT_INLINE_IMAGE", src: IMG.src, width: IMG.width, height: IMG.height, alt: IMG.alt },
      suggestingConfig,
    );
    expect(bodyInlineImages(out.state, BODY_P).length).toBe(1);
  });

  it("is its own undo unit — UNDO removes the inserted image", () => {
    const editor = buildEditor(buildStateWithBody(), { blockId: BODY_P, offset: 1 });
    const inserted = reduceEditor(
      editor,
      { type: "INSERT_INLINE_IMAGE", src: IMG.src, width: IMG.width, height: IMG.height, alt: IMG.alt },
      config,
    );
    expect(bodyInlineImages(inserted.state, BODY_P).length).toBe(1);
    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    expect(bodyInlineImages(undone.state, BODY_P).length).toBe(0);
  });

  it("REPLACES an expanded selection (delete-then-insert, one undo step) — Google Docs field behavior", () => {
    const editor: EditorState = (() => {
      const base = buildEditor(buildStateWithBody(), { blockId: BODY_P, offset: 0 });
      // select the whole "ab"
      return {
        ...base,
        selection: createSpan(createPosition(BODY_P, 0), createPosition(BODY_P, 2)),
      };
    })();
    const out = reduceEditor(
      editor,
      { type: "INSERT_INLINE_IMAGE", src: IMG.src, width: IMG.width, height: IMG.height, alt: IMG.alt },
      config,
    );
    // "ab" replaced by the single image embed; caret after it (offset 1).
    expect(bodyInlineImages(out.state, BODY_P).length).toBe(1);
    const items = getBlock(out.state, BODY_P)?.inlineContent?.items ?? [];
    expect(items.length).toBe(1);
    expect(items[0]?.kind).toBe("embed");
    expect(out.selection.focus.offset).toBe(1);

    // delete+insert is ONE undo unit → a single UNDO restores "ab".
    const undone = reduceEditor(out, { type: "UNDO" }, config);
    const restored = getBlock(undone.state, BODY_P)?.inlineContent?.items ?? [];
    expect(restored.map((it) => (it.kind === "text" ? it.text : "<embed>")).join("")).toBe("ab");
  });
});

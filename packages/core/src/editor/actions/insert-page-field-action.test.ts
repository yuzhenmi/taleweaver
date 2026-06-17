// F-4: INSERT_PAGE_NUMBER / INSERT_PAGE_COUNT editor actions.
//
// A page-field is HEADER/FOOTER running content (spec §1, Google Docs). Per the
// 2026-06-10 scope decision, main-body page-number/page-count SELF-fields are OUT of
// scope, so `handleInsertPageField` DIVERGES from the cross-reference handler: it
// inserts ONLY when the caret is in a TEMPLATE (header/footer) context, and is a
// no-op in the main body (and in a footnote/embed body).
//
// The fixture mirrors header-caret-edit.test.ts: a document with a main body paragraph
// plus a header template body (a container root with two child paragraphs) living in
// templateContents, built through the full pipeline so the handlers + rebuildTrees
// have every EditorState field they expect.

import { describe, it, expect } from "vitest";
import { reduceEditor, type EditorState, type EditorConfig } from "../editor-state";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import {
  createHistory,
  createPosition,
  createSpan,
  getBlock,
  getTemplateContent,
  PAGE_FIELD_EMBED_TYPE,
} from "../../state";
import type { State, BlockId, InlineItem } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const config: EditorConfig = { componentRegistry, attrRegistry, containerWidth: 600 };

const HDR_P1 = "hdr-c1" as BlockId;
const BODY_P = "p" as BlockId;

const FN_P = "fn-c1" as BlockId;

/**
 * A document with a main body paragraph + a header template body (container root, one
 * paragraph) AND a footnote body in embedContents (container root, one paragraph). The
 * header exercises the ALLOWED (templateContent) path; the footnote body and the main
 * body exercise the two REJECTED context kinds (embedContent, block).
 */
function buildStateWithHeaderBody(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("body text")]) }),
    ],
    templateContents: [
      buildBlock({ id: "hdr-root", type: "document", parentId: null, firstChildId: "hdr-c1", lastChildId: "hdr-c1" }),
      buildBlock({ id: "hdr-c1", type: "paragraph", parentId: "hdr-root", inlineContent: inlineContent([text("Page ")]) }),
    ],
    embedContents: [
      buildBlock({ id: "fn-root", type: "document", parentId: null, firstChildId: "fn-c1", lastChildId: "fn-c1" }),
      buildBlock({ id: "fn-c1", type: "paragraph", parentId: "fn-root", inlineContent: inlineContent([text("note")]) }),
    ],
  });
}

/**
 * Build a geometry-free EditorState with the caret at `caret`. Phase 0b: the
 * `INSERT_PAGE_*` handlers are context-driven (caret block/context only) and
 * read no layout — the synthetic state needs only the geometry-free fields.
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

function pageFieldItemsOf(items: readonly InlineItem[] | undefined): InlineItem[] {
  return (items ?? []).filter((it) => it.kind === "embed" && it.embedType === PAGE_FIELD_EMBED_TYPE);
}
function headerPageFields(state: State, id: BlockId): InlineItem[] {
  return pageFieldItemsOf(getTemplateContent(state, id)?.inlineContent?.items);
}
function bodyPageFields(state: State, id: BlockId): InlineItem[] {
  return pageFieldItemsOf(getBlock(state, id)?.inlineContent?.items);
}

describe("handleInsertPageField — INSERT_PAGE_NUMBER / INSERT_PAGE_COUNT (header/footer only)", () => {
  it("INSERT_PAGE_NUMBER in a header inserts a page-field at the caret and advances the caret by 1", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P1, offset: 5 }); // after "Page "
    const out = reduceEditor(editor, { type: "INSERT_PAGE_NUMBER" }, config);

    const fields = headerPageFields(out.state, HDR_P1);
    expect(fields.length).toBe(1);
    expect((fields[0] as { properties?: { fieldKind?: string } }).properties?.fieldKind).toBe("page-number");
    // caret stayed in the header paragraph, advanced past the one-offset field
    expect(out.selection.focus.blockId).toBe(HDR_P1);
    expect(out.selection.focus.offset).toBe(6);
    expect(out.selection.anchor).toEqual(out.selection.focus); // collapsed
    expect(out.state).not.toBe(editor.state);
  });

  it("INSERT_PAGE_COUNT in a header inserts a page-count field; UNDO removes it (its own undo unit)", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P1, offset: 5 });
    const inserted = reduceEditor(editor, { type: "INSERT_PAGE_COUNT" }, config);
    const fields = headerPageFields(inserted.state, HDR_P1);
    expect(fields.length).toBe(1);
    expect((fields[0] as { properties?: { fieldKind?: string } }).properties?.fieldKind).toBe("page-count");

    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    expect(headerPageFields(undone.state, HDR_P1).length).toBe(0);
  });

  it("threads a non-default numberStyle through to the inserted field", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P1, offset: 5 });
    const out = reduceEditor(editor, { type: "INSERT_PAGE_NUMBER", numberStyle: "lower-roman" }, config);
    const fields = headerPageFields(out.state, HDR_P1);
    expect(fields.length).toBe(1);
    expect((fields[0] as { properties?: { numberStyle?: string } }).properties?.numberStyle).toBe("lower-roman");
  });

  it("is a NO-OP in the main body (main-body page-fields are OUT of scope)", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: BODY_P, offset: 4 }); // inside "body text"
    const out = reduceEditor(editor, { type: "INSERT_PAGE_NUMBER" }, config);
    expect(out).toBe(editor); // unchanged editor reference
    expect(bodyPageFields(out.state, BODY_P).length).toBe(0);
  });

  it("is a NO-OP in a footnote body (embedContent context — only the template host is allowed)", () => {
    // The gate rejects the embedContent kind, not just main-body: a footnote-body caret
    // resolves to a context root of kind "embedContent", which is NOT "templateContent".
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: FN_P, offset: 2 }); // inside "note"
    const out = reduceEditor(editor, { type: "INSERT_PAGE_COUNT" }, config);
    expect(out).toBe(editor); // unchanged editor reference — same-ref no-op proves nothing was inserted
  });
});

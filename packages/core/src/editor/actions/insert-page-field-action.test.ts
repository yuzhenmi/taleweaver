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
// templateContents, built through the full pipeline so the handlers + applyEdit
// have every EditorState field they expect.

import { describe, it, expect } from "vitest";
import { reduceEditor } from "../reduce-editor";
import { type EditorState, createEditorStateFromDocument } from "../editor-state";
import { type EditorConfig } from "../editor-config";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import {
  createPosition,
  createSpan,
  getBlock,
  getTemplateContent,
  PAGE_FIELD_EMBED_TYPE,
} from "../../state";
import type { Document, BlockId, InlineItem } from "../../state";
import { buildDocument, buildBlock, inlineContent, text, embed } from "../../test-utils/document-builders";

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
function buildDocumentWithHeaderBody(headerItems: InlineItem[] = [text("Page ")]): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("body text")]) }),
    ],
    templateContents: [
      buildBlock({ id: "hdr-root", type: "document", parentId: null, firstChildId: "hdr-c1", lastChildId: "hdr-c1" }),
      buildBlock({ id: "hdr-c1", type: "paragraph", parentId: "hdr-root", inlineContent: inlineContent(headerItems) }),
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
function buildEditor(document: Document, caret: { blockId: BlockId; offset: number }): EditorState {
  const cursor = createPosition(caret.blockId, caret.offset);
  return createEditorStateFromDocument(document, createSpan(cursor, cursor), config);
}

function pageFieldItemsOf(items: readonly InlineItem[] | undefined): InlineItem[] {
  return (items ?? []).filter((it) => it.kind === "embed" && it.embedType === PAGE_FIELD_EMBED_TYPE);
}
function headerPageFields(document: Document, id: BlockId): InlineItem[] {
  return pageFieldItemsOf(getTemplateContent(document, id)?.inlineContent?.items);
}
function bodyPageFields(document: Document, id: BlockId): InlineItem[] {
  return pageFieldItemsOf(getBlock(document, id)?.inlineContent?.items);
}

describe("handleInsertPageField — INSERT_PAGE_NUMBER / INSERT_PAGE_COUNT (header/footer only)", () => {
  it("INSERT_PAGE_NUMBER in a header inserts a page-field at the caret and advances the caret by 1", () => {
    const editor = buildEditor(buildDocumentWithHeaderBody(), { blockId: HDR_P1, offset: 5 }); // after "Page "
    const out = reduceEditor(editor, { type: "INSERT_PAGE_NUMBER" });

    const fields = headerPageFields(out.document, HDR_P1);
    expect(fields.length).toBe(1);
    expect((fields[0] as { properties?: { fieldKind?: string } }).properties?.fieldKind).toBe("page-number");
    // caret stayed in the header paragraph, advanced past the one-offset field
    expect(out.selection.focus.blockId).toBe(HDR_P1);
    expect(out.selection.focus.offset).toBe(6);
    expect(out.selection.anchor).toEqual(out.selection.focus); // collapsed
    expect(out.document).not.toBe(editor.document);
    // A caret before a marker inserts after it (inside a bookmark at its start), as typing.
    for (const type of ["INSERT_PAGE_NUMBER", "INSERT_PAGE_COUNT"] as const) {
      const marked = buildEditor(buildDocumentWithHeaderBody([embed("bookmark-start", { bookmarkId: "b" }), text("Page ")]), { blockId: HDR_P1, offset: 0 });
      const items = getTemplateContent(reduceEditor(marked, { type }).document, HDR_P1)?.inlineContent?.items ?? [];
      expect(items.map((i) => (i.kind === "embed" ? i.embedType : i.text))).toEqual(["bookmark-start", PAGE_FIELD_EMBED_TYPE, "Page "]);
    }
  });

  it("INSERT_PAGE_COUNT in a header inserts a page-count field; UNDO removes it (its own undo unit)", () => {
    const editor = buildEditor(buildDocumentWithHeaderBody(), { blockId: HDR_P1, offset: 5 });
    const inserted = reduceEditor(editor, { type: "INSERT_PAGE_COUNT" });
    const fields = headerPageFields(inserted.document, HDR_P1);
    expect(fields.length).toBe(1);
    expect((fields[0] as { properties?: { fieldKind?: string } }).properties?.fieldKind).toBe("page-count");

    const undone = reduceEditor(inserted, { type: "UNDO" });
    expect(headerPageFields(undone.document, HDR_P1).length).toBe(0);
  });

  it("threads a non-default numberStyle through to the inserted field", () => {
    const editor = buildEditor(buildDocumentWithHeaderBody(), { blockId: HDR_P1, offset: 5 });
    const out = reduceEditor(editor, { type: "INSERT_PAGE_NUMBER", numberStyle: "lower-roman" });
    const fields = headerPageFields(out.document, HDR_P1);
    expect(fields.length).toBe(1);
    expect((fields[0] as { properties?: { numberStyle?: string } }).properties?.numberStyle).toBe("lower-roman");
  });

  it("is a NO-OP in the main body (main-body page-fields are OUT of scope)", () => {
    const editor = buildEditor(buildDocumentWithHeaderBody(), { blockId: BODY_P, offset: 4 }); // inside "body text"
    const out = reduceEditor(editor, { type: "INSERT_PAGE_NUMBER" });
    expect(out).toBe(editor); // unchanged editor reference
    expect(bodyPageFields(out.document, BODY_P).length).toBe(0);
  });

  it("is a NO-OP in a footnote body (embedContent context — only the template host is allowed)", () => {
    // The gate rejects the embedContent kind, not just main-body: a footnote-body caret
    // resolves to a context root of kind "embedContent", which is NOT "templateContent".
    const editor = buildEditor(buildDocumentWithHeaderBody(), { blockId: FN_P, offset: 2 }); // inside "note"
    const out = reduceEditor(editor, { type: "INSERT_PAGE_COUNT" });
    expect(out).toBe(editor); // unchanged editor reference — same-ref no-op proves nothing was inserted
  });
});

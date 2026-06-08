/**
 * Editor document load/save convenience surface (`document-io.ts`): the
 * editor-level "open / save" operations over the engine's
 * `serializeDocument` / `deserializeDocument`. `exportDocument` serializes the
 * editor's current `State`; `loadDocument` deserializes bytes into a FRESH
 * `EditorState` (fresh `History` + a valid initial caret + full
 * render/cascade/layout).
 *
 * Also covers the shared `initialSelectionForState` caret-derivation helper:
 * both `createInitialEditorState` (empty doc) and `loadDocument` (arbitrary
 * deserialized doc) derive the initial collapsed caret through it, on the first
 * CONTENT-bearing leaf (robust against a first child that is a container, e.g.
 * a section wrapping a paragraph).
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { config, reduceEditor } from "./actions/test-helpers";
import {
  createInitialEditorState,
  createEditorStateFromState,
} from "./editor-state";
import { exportDocument, loadDocument } from "./document-io";
import { initialSelectionForState } from "./actions";
import {
  getBlock,
  createPosition,
  createSpan,
  createDefaultSerializerRegistry,
  createSerializerRegistry,
  serializeDocument,
  BINARY_FORMAT,
  UnknownSerializerFormatError,
  MalformedDocumentError,
  asBlockId,
} from "../state";
import type { State, BlockId } from "../state";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";

const ID = (s: string): BlockId => asBlockId(s);

/** Extract the full document's plain text (whole-doc span over the root). */
function docText(state: State): string {
  const root = getBlock(state, state.rootId);
  if (root === null) return "";
  // Walk every content leaf in document order; join their text with "\n".
  const parts: string[] = [];
  collectText(state, state.rootId, parts);
  return parts.join("\n");
}

function collectText(state: State, blockId: BlockId, out: string[]): void {
  const block = getBlock(state, blockId);
  if (block === null) return;
  if (block.inlineContent !== null) {
    out.push(
      block.inlineContent.items
        .map((it) => (it.kind === "text" ? it.text : ""))
        .join(""),
    );
    return;
  }
  let child = block.firstChildId;
  while (child !== null) {
    collectText(state, child, out);
    const childBlock = getBlock(state, child);
    child = childBlock === null ? null : childBlock.nextSiblingId;
  }
}

/**
 * A two-paragraph main-tree document (root → p1 "alpha", p2 "beta") built
 * directly so the round-trip has real content without depending on the editor
 * pipeline to seed it.
 */
function twoParagraphState(): State {
  return buildState({
    rootId: "root",
    blocks: [
      buildBlock({
        id: "root",
        type: "document",
        firstChildId: "p1",
        lastChildId: "p2",
      }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "root",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "root",
        prevSiblingId: "p1",
        inlineContent: inlineContent([text("beta")]),
      }),
    ],
  });
}

/**
 * A document whose root's FIRST child is a CONTAINER (a `section`, which has
 * `display:contents` and no inline content) wrapping a `paragraph` content
 * leaf. The robustness case `initialSelectionForState` must handle: the caret
 * lands on the inner paragraph (the content leaf), NOT the section container.
 */
function sectionWrappedState(): State {
  return buildState({
    rootId: "sw-root",
    blocks: [
      buildBlock({
        id: "sw-root",
        type: "document",
        firstChildId: "sw-section",
        lastChildId: "sw-section",
      }),
      buildBlock({
        id: "sw-section",
        type: "section",
        parentId: "sw-root",
        firstChildId: "sw-para",
        lastChildId: "sw-para",
      }),
      buildBlock({
        id: "sw-para",
        type: "paragraph",
        parentId: "sw-section",
        inlineContent: inlineContent([text("inner")]),
      }),
    ],
  });
}

describe("document-io — exportDocument / loadDocument", () => {
  it("export → load round-trip preserves the document", () => {
    const state = twoParagraphState();
    const editor = createEditorStateFromState(
      state,
      initialSelectionForState(state),
      config,
    );
    const reg = createDefaultSerializerRegistry();
    const bytes = exportDocument(editor, BINARY_FORMAT, reg);
    const loaded = loadDocument(bytes, BINARY_FORMAT, reg, config);

    expect(loaded.state.rootId).toBe(editor.state.rootId);
    expect(docText(loaded.state)).toBe(docText(editor.state));
    expect(docText(loaded.state)).toBe("alpha\nbeta");
  });

  it("loadDocument places a valid collapsed initial caret on a content leaf", () => {
    const state = twoParagraphState();
    const editor = createEditorStateFromState(
      state,
      initialSelectionForState(state),
      config,
    );
    const reg = createDefaultSerializerRegistry();
    const bytes = exportDocument(editor, BINARY_FORMAT, reg);
    const loaded = loadDocument(bytes, BINARY_FORMAT, reg, config);

    const { anchor, focus } = loaded.selection;
    // Collapsed: anchor === focus.
    expect(anchor.blockId).toBe(focus.blockId);
    expect(anchor.offset).toBe(focus.offset);
    expect(anchor.offset).toBe(0);
    // The caret block is a real content-bearing leaf.
    const caretBlock = getBlock(loaded.state, anchor.blockId);
    expect(caretBlock).not.toBeNull();
    expect(caretBlock?.inlineContent).not.toBeNull();
  });

  it("loadDocument gives a fresh, independent History (cannot undo into the exporting edits)", () => {
    // Build content via the editor pipeline so the EXPORTING editor has a
    // non-empty undo history; the loaded editor must NOT inherit it.
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "history" }, config);
    expect(editor.history.canUndo()).toBe(true);

    const reg = createDefaultSerializerRegistry();
    const bytes = exportDocument(editor, BINARY_FORMAT, reg);
    const loaded = loadDocument(bytes, BINARY_FORMAT, reg, config);

    // Fresh history bound to the loaded state: nothing to undo or redo.
    expect(loaded.history.canUndo()).toBe(false);
    expect(loaded.history.canRedo()).toBe(false);
  });

  it("loadDocument yields a live, editable editor (INSERT_TEXT round-trips through the full pipeline)", () => {
    const state = twoParagraphState();
    const editor = createEditorStateFromState(
      state,
      initialSelectionForState(state),
      config,
    );
    const reg = createDefaultSerializerRegistry();
    const bytes = exportDocument(editor, BINARY_FORMAT, reg);
    const loaded = loadDocument(bytes, BINARY_FORMAT, reg, config);

    const caretBlockId = loaded.selection.anchor.blockId;
    const edited = reduceEditor(loaded, { type: "INSERT_TEXT", text: "X" }, config);
    const editedBlock = getBlock(edited.state, caretBlockId);
    expect(editedBlock).not.toBeNull();
    const text = editedBlock?.inlineContent?.items
      .map((it) => (it.kind === "text" ? it.text : ""))
      .join("");
    expect(text).toBe("Xalpha");
  });

  it("exportDocument throws UnknownSerializerFormatError for an unregistered format", () => {
    const editor = createInitialEditorState(config);
    const emptyReg = createSerializerRegistry();
    expect(() => exportDocument(editor, BINARY_FORMAT, emptyReg)).toThrow(
      UnknownSerializerFormatError,
    );
  });

  it("loadDocument throws UnknownSerializerFormatError for an unregistered format", () => {
    // Produce valid bytes via a populated registry, then attempt to load with
    // an empty one — the format lookup fails before any decode.
    const editor = createInitialEditorState(config);
    const fullReg = createDefaultSerializerRegistry();
    const bytes = serializeDocument(editor.state, BINARY_FORMAT, fullReg);
    const emptyReg = createSerializerRegistry();
    expect(() => loadDocument(bytes, BINARY_FORMAT, emptyReg, config)).toThrow(
      UnknownSerializerFormatError,
    );
  });

  it("loadDocument throws MalformedDocumentError for malformed wire data", () => {
    const reg = createDefaultSerializerRegistry();
    // A genuine Yjs update from an empty Y.Doc: it applies cleanly but seeds no
    // meta.rootId → getMetaRootId returns undefined → MalformedDocumentError.
    // This exercises the specific code-owned path. (Raw garbage like
    // `new Uint8Array(0)` is NOT used — Y.applyUpdate rejects it with a
    // Yjs-internal decode error before the rootId check.)
    const noRootUpdate = Y.encodeStateAsUpdate(new Y.Doc());
    expect(() => loadDocument(noRootUpdate, BINARY_FORMAT, reg, config)).toThrow(
      MalformedDocumentError,
    );
  });
});

describe("initialSelectionForState — robust caret derivation", () => {
  it("empty document: caret on the seeded paragraph (a content leaf)", () => {
    const editor = createInitialEditorState(config);
    const sel = editor.selection;
    expect(sel.anchor.blockId).toBe(sel.focus.blockId);
    expect(sel.anchor.offset).toBe(0);
    const block = getBlock(editor.state, sel.anchor.blockId);
    expect(block).not.toBeNull();
    expect(block?.inlineContent).not.toBeNull();
  });

  it("collapsed caret on the first content leaf of a two-paragraph doc", () => {
    const state = twoParagraphState();
    const sel = initialSelectionForState(state);
    expect(sel.anchor.blockId).toBe(sel.focus.blockId);
    expect(sel.anchor.blockId).toBe(ID("p1"));
    expect(sel.anchor.offset).toBe(0);
  });

  it("caret lands on the inner paragraph, NOT a container first child (section-wrapped)", () => {
    const state = sectionWrappedState();
    const sel = initialSelectionForState(state);
    // Robustness over the old `firstChildId` derivation: the root's first child
    // is the `section` CONTAINER; the caret must land on the inner paragraph.
    expect(sel.anchor.blockId).toBe(ID("sw-para"));
    expect(sel.anchor.blockId).not.toBe(ID("sw-section"));
    expect(sel.anchor.offset).toBe(0);
    const block = getBlock(state, sel.anchor.blockId);
    expect(block?.inlineContent).not.toBeNull();
    // Round-trips equal selections (anchor === focus, collapsed).
    expect(sel).toEqual(
      createSpan(createPosition(ID("sw-para"), 0), createPosition(ID("sw-para"), 0)),
    );
  });
});

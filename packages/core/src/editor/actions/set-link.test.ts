import { finalSectionOf } from "../../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  getBlock,
  createPosition,
  createSpan,
  type EditorConfig,
} from "../../index";
import type { TextItem } from "../../state";

function makeConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
  };
}

/** Sum text content + first text item's attrs from the doc's first
 * (and only) paragraph in the editor's seeded state. */
function firstTextItem(editor: ReturnType<typeof createInitialEditorState>): TextItem | null {
  const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
  if (root === null) return null;
  const pId = root.firstChildId;
  if (pId === null) return null;
  const p = getBlock(editor.state, pId);
  if (p === null || p.inlineContent === null) return null;
  const first = p.inlineContent.items[0];
  if (first === undefined || first.kind !== "text") return null;
  return first;
}

describe("handleSetLink", () => {
  it("no-op on collapsed selection (no link can target a single cursor)", () => {
    const config = makeConfig();
    const initial = createInitialEditorState(config);
    // Seed text so we have something to potentially link.
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hello" });
    const before = editor;
    // Collapsed at end.
    editor = reduceEditor(editor, { type: "SET_LINK", url: "https://example.com" });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.state).toBe(before.state);
  });

  it("sets link attr on selected text", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "click here" });
    const pId = (() => {
      const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    // Select the whole inserted text [0, 10).
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 10)),
      },
    );
    editor = reduceEditor(editor, { type: "SET_LINK", url: "https://example.com" });

    const item = firstTextItem(editor);
    expect(item).not.toBeNull();
    if (item === null) return;
    expect(item.text).toBe("click here");
    expect(item.attrs.link).toBe("https://example.com");
  });

  it("clears link attr when given null (link removed)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "click here" });
    const pId = (() => {
      const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 10)),
      },
    );
    // Set a link, then clear it.
    editor = reduceEditor(editor, { type: "SET_LINK", url: "https://example.com" });
    expect(firstTextItem(editor)?.attrs.link).toBe("https://example.com");
    editor = reduceEditor(editor, { type: "SET_LINK", url: null });
    expect(firstTextItem(editor)?.attrs.link).toBeUndefined();
  });

  it("clears link attr when given empty string (UX rule: empty URL isn't a meaningful link)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "click here" });
    const pId = (() => {
      const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 10)),
      },
    );
    editor = reduceEditor(editor, { type: "SET_LINK", url: "https://example.com" });
    expect(firstTextItem(editor)?.attrs.link).toBe("https://example.com");
    editor = reduceEditor(editor, { type: "SET_LINK", url: "" });
    expect(firstTextItem(editor)?.attrs.link).toBeUndefined();
  });

  it("clearing a link that never existed leaves the content unchanged (defensive)", () => {
    // The state-equality short-circuit (`result.state === editor.state`)
    // is the standard pattern across all attr-mutating handlers but
    // is not actually reachable here via the public SET_LINK API:
    // `applyAttrsToRange` writes to Y.Doc on every call (even
    // setting an absent key to undefined emits a delete op), so
    // `result.state !== editor.state`. The short-circuit remains
    // as defensive insurance against a future state-module
    // enhancement (true no-op detection in `applyAttrsToRange`).
    // What we CAN verify here: the content is unchanged.
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "click here" });
    const pId = (() => {
      const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 10)),
      },
    );
    const beforeText = firstTextItem(editor)?.text;
    const beforeLink = firstTextItem(editor)?.attrs.link;
    editor = reduceEditor(editor, { type: "SET_LINK", url: null });
    expect(firstTextItem(editor)?.text).toBe(beforeText);
    expect(firstTextItem(editor)?.attrs.link).toBe(beforeLink);
  });

  it("preserves selection DIRECTION (a backward selection stays backward — Google-Docs parity)", () => {
    // Applying a link is an attr-only edit: it shifts no offsets, so the
    // selection must be returned UNCHANGED — same endpoints AND same anchor/
    // focus orientation. A backward (RTL-drag) selection must not flip to
    // forward, else a following Shift+Arrow extends from the wrong end.
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "click here" });
    const pId = (() => {
      const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    // BACKWARD selection: anchor at the later offset (10), focus at the earlier (0).
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 10), createPosition(pId, 0)),
      },
    );
    editor = reduceEditor(editor, { type: "SET_LINK", url: "https://example.com" });
    // Link applied...
    expect(firstTextItem(editor)?.attrs.link).toBe("https://example.com");
    // ...and the backward orientation survives (anchor still after focus).
    expect(editor.selection.anchor.offset).toBe(10);
    expect(editor.selection.focus.offset).toBe(0);
  });

  it("undo restores the pre-link state", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "click here" });
    const pId = (() => {
      const root = getBlock(editor.state, finalSectionOf(editor.state)); // the root holds sections
      if (root === null || root.firstChildId === null) throw new Error("no para");
      return root.firstChildId;
    })();
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(pId, 0), createPosition(pId, 10)),
      },
    );
    editor = reduceEditor(editor, { type: "SET_LINK", url: "https://example.com" });
    expect(firstTextItem(editor)?.attrs.link).toBe("https://example.com");

    editor = reduceEditor(editor, { type: "UNDO" });
    expect(firstTextItem(editor)?.attrs.link).toBeUndefined();
  });
});

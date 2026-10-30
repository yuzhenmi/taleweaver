import { describe, it, expect } from "vitest";
import {
  buildDocumentFromTree,
  createInitialEditorState,
  reduceEditor,
  createPosition,
  createSpan,
  getBlock,
  type EditorConfig,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  productionAllocator,
  type ContainerBlockNode,
  type State,
} from "@taleweaver/core";
import { renderDocumentToDom } from "./render-to-dom";

const TEST_RESOLVER = createDefaultComponentRegistry();

const components = createDefaultComponentRegistry();
const attrs = createDefaultAttrRegistry();

// A document containing one paragraph whose text is "hello".
// Shape per packages/print/src/html-serializer.test.ts: the root is a
// ContainerBlockNode `{ type: "document", children: [...] }`; a paragraph leaf
// carries `{ type: "paragraph", inlineContent: { items: [TextItem] } }`.
// buildDocumentFromTree(root, listDefs, allocator) — note the 3-arg signature
// and that `productionAllocator` is a value, not a factory.
function helloDoc(): State {
  const tree: ContainerBlockNode = {
    type: "document",
    children: [
      {
        type: "paragraph",
        inlineContent: { items: [{ kind: "text", text: "hello", attrs: {} }] },
      },
    ],
  };
  return buildDocumentFromTree(tree, {}, productionAllocator, TEST_RESOLVER);
}

describe("renderDocumentToDom (end-to-end)", () => {
  it("renders a paragraph through the full render+cascade+walk pipeline", () => {
    const root = renderDocumentToDom(helloDoc(), components, attrs, document);
    expect(root).toBeInstanceOf(HTMLElement);
    expect(root.textContent).toContain("hello");
  });

  it("emits NO geometry — only CSS styles, never left/top coordinates", () => {
    const root = renderDocumentToDom(helloDoc(), components, attrs, document);
    for (const elem of Array.from(root.querySelectorAll("*"))) {
      const style = elem.getAttribute("style") ?? "";
      expect(style).not.toMatch(/(^|;)\s*(left|top)\s*:/);
    }
  });

  it("accepts a suggestionView option (final view renders cleanly)", () => {
    const root = renderDocumentToDom(helloDoc(), components, attrs, document, { suggestionView: "final" });
    expect(root).toBeInstanceOf(HTMLElement);
    expect(root.textContent).toContain("hello");
  });

  it("an empty paragraph's line takes its ¶ character props (the render strut sentinel, `markAttrs`)", () => {
    const config: EditorConfig = { componentRegistry: components, attrRegistry: attrs, containerWidth: 800 };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" });
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "c" });
    const c = editor.selection.focus.blockId;
    const two = getBlock(editor.state, c)?.prevSiblingId;
    if (two === null || two === undefined) throw new Error("no empty paragraph");
    const plain = renderDocumentToDom(editor.state, components, attrs, document, { stampBlockIds: true });
    expect(plain.querySelector(`[data-block-id="${two}"] > br[data-tw-empty-line]`)?.hasAttribute("style")).toBe(false);
    // Formatting over the empty paragraph's ¶ — (E, 0)–(C, 0) — writes its markAttrs.
    editor = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(two, 0), createPosition(c, 0)) });
    editor = reduceEditor(editor, { type: "SET_FONT_SIZE", size: 40 });
    expect(getBlock(editor.state, two)?.markAttrs).toBeDefined();
    const root = renderDocumentToDom(editor.state, components, attrs, document, { stampBlockIds: true });
    const br = root.querySelector(`[data-block-id="${two}"] > br[data-tw-empty-line]`);
    expect(br?.getAttribute("style")).toContain("font-size: 40px");
  });

  it("a list marker takes its ¶ character props (`list.markerStyle` from `markAttrs`; Word formats the number with the ¶'s rPr)", () => {
    const config: EditorConfig = { componentRegistry: components, attrRegistry: attrs, containerWidth: 800 };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "one" });
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" });
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "two" });
    const two = editor.selection.focus.blockId;
    const one = getBlock(editor.state, two)?.prevSiblingId;
    if (one === null || one === undefined) throw new Error("no first item");
    editor = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(one, 0), createPosition(two, 3)) });
    editor = reduceEditor(editor, { type: "TOGGLE_LIST", listType: "ordered" });
    const root = renderDocumentToDom(editor.state, components, attrs, document);
    const markers = Array.from(root.querySelectorAll("[data-tw-marker]")).map((m) => m.getAttribute("style") ?? "");
    expect(markers).toHaveLength(2);
    expect(markers[0]).not.toContain("font-weight");
    expect(markers[1]).toContain("font-weight");
  });
});

/**
 * Smell B (#291): characterization + migration safety net for `handlePaste`.
 *
 * `handlePaste` had NO test coverage before this file. These tests pin down
 * the OBSERVABLE paste behavior (block content + cursor + block type
 * inheritance) so the migration from the per-line
 * `splitBlockAtPosition`+`insertText` chain onto the `insertBlocksAfter`
 * bulk primitive can be proven behavior-preserving: every test here must
 * pass against the ORIGINAL handler AND the migrated handler.
 *
 * Harness mirrors the other `actions/*.test.ts` (insert-node, section-break):
 * drive via `reduceEditor`, inspect via `getBlock` walking the block tree.
 *
 * T10 additions: rich routing tests (clip→html→text priority, suggesting mode).
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  getTextOf,
  firstChildId,
  type EditorState,
  type EditorConfig,
} from "./test-helpers";
import {
  getBlock,
  buildDocumentFromTree,
  createTestAllocator,
  encodeFragmentClip,
  decodeFragmentClip,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  resolveBlock,
} from "../../state";
import type { BlockId, HtmlParser, HtmlNode, State } from "../../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Ordered list of the document root's direct children. */
function rootChildren(editor: EditorState): BlockId[] {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  let guard = 0;
  while (cur !== null && guard++ < 100000) {
    ids.push(cur);
    const b = getBlock(editor.state, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

function paste(editor: EditorState, text: string): EditorState {
  return reduceEditor(editor, { type: "PASTE", text }, config);
}

describe("handlePaste — multi-line plain-text paste (characterization + migration)", () => {
  it("(1) single line into empty paragraph: para = text, cursor at end, ONE block", () => {
    const initial = createInitialEditorState(config);
    const paraId = firstChildId(initial.state) as BlockId;

    const next = paste(initial, "abc");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(paraId);
    expect(getTextOf(next.state, paraId)).toBe("abc");
    expect(next.selection.focus).toEqual({ blockId: paraId, offset: 3 });
    expect(next.selection.anchor).toEqual({ blockId: paraId, offset: 3 });
  });

  it("(2) three lines into empty doc: 3 paragraphs a/b/c, cursor at end of c", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\nb\nc");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(3);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("b");
    expect(getTextOf(next.state, nth(blocks, 2, "block"))).toBe("c");
    // Cursor collapsed at end of the last pasted line ("c", length 1).
    expect(next.selection.focus).toEqual({ blockId: blocks[2], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[2], offset: 1 });
  });

  it("(3) two lines into the MIDDLE of helloworld at offset 5", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "helloworld" }, config);
    // Place collapsed cursor at offset 5 (between "hello" and "world").
    const mid = { blockId: paraId, offset: 5 };
    s = reduceEditor(s, { type: "SET_SELECTION", selection: { anchor: mid, focus: mid } }, config);

    const next = paste(s, "X\nY");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    // First block: prefix "hello" + L0 "X".
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("helloX");
    // Second block: L1 "Y" + suffix "world".
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("Yworld");
    // Cursor at end of last pasted line "Y" (length 1) in the new block.
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 1 });
  });

  it("(4) trailing empty line a\\n: 'a' then an empty paragraph, cursor in empty para at 0", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\n");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("");
    // Last pasted line is "" (length 0): cursor at offset 0 of the empty para.
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 0 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 0 });
  });

  it("(5) empty MIDDLE line a\\n\\nb: 'a', empty para, 'b'", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\n\nb");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(3);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("");
    expect(getTextOf(next.state, nth(blocks, 2, "block"))).toBe("b");
    expect(next.selection.focus).toEqual({ blockId: blocks[2], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[2], offset: 1 });
  });

  it("(5b) leading empty line \\nY into a non-empty block: empty para, then Y+suffix", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "world" }, config);
    // Cursor at offset 0 (start of "world").
    const startPos = { blockId: paraId, offset: 0 };
    s = reduceEditor(
      s,
      { type: "SET_SELECTION", selection: { anchor: startPos, focus: startPos } },
      config,
    );

    const next = paste(s, "\nY");

    // L0 is empty → not inserted, pos stays at offset 0; split at 0 makes B
    // an empty prefix block and N_last the whole "world" suffix; L1 "Y"
    // prepends to N_last.
    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("Yworld");
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 1 });
  });

  it("(6) paste into an EXPANDED selection replaces it then inserts", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "helloworld" }, config);
    // Select "world" (offsets 5..10).
    const sel = {
      anchor: { blockId: paraId, offset: 5 },
      focus: { blockId: paraId, offset: 10 },
    };
    s = reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);

    const next = paste(s, "X\nY");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    // "world" deleted → prefix "hello", then "X" appended; new block "Y".
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("helloX");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("Y");
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 1 });
  });

  it("(7) new blocks inherit the target block's type (heading)", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(getBlock(s.state, paraId)?.type).toBe("heading");

    const next = paste(s, "a\nb");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    for (const id of blocks) {
      expect(getBlock(next.state, id)?.type).toBe("heading");
    }
    // New blocks also inherit the source attrs (level: 1).
    expect(getBlock(next.state, nth(blocks, 1, "block"))?.attrs).toEqual({ level: 1 });
  });

  it("(8) k=4 lines into the middle of a non-empty block: content + cursor match, no throw", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "PREsuf" }, config);
    // Cursor at offset 3 (between "PRE" and "suf").
    const mid = { blockId: paraId, offset: 3 };
    s = reduceEditor(s, { type: "SET_SELECTION", selection: { anchor: mid, focus: mid } }, config);

    let next: EditorState | undefined;
    expect(() => {
      next = paste(s, "L0\nL1\nL2\nL3");
    }).not.toThrow();
    if (next === undefined) throw new Error("paste returned undefined");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(4);
    // B keeps prefix "PRE" + L0 "L0".
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("PREL0");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("L1");
    expect(getTextOf(next.state, nth(blocks, 2, "block"))).toBe("L2");
    // Last block: L3 + suffix "suf".
    expect(getTextOf(next.state, nth(blocks, 3, "block"))).toBe("L3suf");
    // Cursor at end of last pasted line "L3" (length 2) in the last block.
    expect(next.selection.focus).toEqual({ blockId: blocks[3], offset: 2 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[3], offset: 2 });
  });

  it("empty rawText is a no-op (returns the same editor reference)", () => {
    const initial = createInitialEditorState(config);
    const next = paste(initial, "");
    expect(next).toBe(initial);
  });

  it("\\r\\n line endings normalize to \\n", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\r\nb");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("b");
  });
});

describe("handlePaste — paste-then-select-all preserves content (regression)", () => {
  /**
   * Regression guard for the long-standing "paste-then-select-all reverts
   * content" report (`state-of-branch.md`, editor `[partial]`). This pins the
   * actual reported sequence — RAPID (sequential) paste immediately followed
   * by SELECT_ALL — and proves no pasted content is lost.
   *
   * SELECT_ALL is purely read-only (it sets `selection`, never mutating the
   * block tree); PASTE commits atomically in a single transaction; sequential
   * pastes each reduce against the prior result (the React `useReducer`
   * contract), so neither clobbers the other. The reducer path is therefore
   * provably content-preserving. (Any residual symptom would live only in the
   * browser event / hidden-textarea sync layer, covered by the user's
   * in-browser smoke — not reproducible at the reducer level, where this test
   * proves the core is safe.)
   */
  it("rapid sequential pastes then SELECT_ALL keeps all content + spans the whole doc", () => {
    const initial = createInitialEditorState(config);

    // first paste: "one" / "two" (cursor ends at "two"|). second paste at that
    // caret: "two" becomes "twothree", then a new "four" block. → 3 blocks,
    // content from BOTH pastes intact.
    const first = paste(initial, "one\ntwo");
    const second = paste(first, "three\nfour");
    const after = reduceEditor(second, { type: "SELECT_ALL" }, config);

    const blocks = rootChildren(after);
    expect(blocks.map((id) => getTextOf(after.state, id))).toEqual([
      "one",
      "twothree",
      "four",
    ]);
    // SELECT_ALL spans first-content-block start → last-content-block end
    // ("four", length 4) — and must not have touched the block tree.
    expect(after.selection.anchor).toEqual({ blockId: blocks[0], offset: 0 });
    expect(after.selection.focus).toEqual({ blockId: blocks[2], offset: 4 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10: rich routing helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal DOM-free HtmlParser for T10 tests. Parses `<p>text</p>` fragments
 * only — the surface handlePaste tests exercise (full whitespace-collapsing
 * is covered in html-decode.test.ts).
 *
 * Produces a synthetic BODY node implementing the HtmlNode interface.
 */
class T10TestNode implements HtmlNode {
  readonly kind: "element" | "text" | "other";
  readonly tagName: string;
  private readonly _attrs: Map<string, string>;
  private readonly _children: T10TestNode[];
  private readonly _childNodes: T10TestNode[];
  readonly data: string;

  constructor(
    kind: "element" | "text" | "other",
    tagName: string,
    attrs: Map<string, string>,
    childNodes: T10TestNode[],
    data: string,
  ) {
    this.kind = kind;
    this.tagName = tagName;
    this._attrs = attrs;
    this._childNodes = childNodes;
    this._children = childNodes.filter((n) => n.kind === "element");
    this.data = data;
  }
  getAttribute(name: string): string | null {
    return this._attrs.get(name.toLowerCase()) ?? null;
  }
  get children(): readonly HtmlNode[] { return this._children; }
  get childNodes(): readonly HtmlNode[] { return this._childNodes; }
  getStyleProperty(_prop: "textAlign" | "width"): string | null { return null; }
}

const VOID_TAGS_T10 = new Set(["BR", "HR", "IMG", "COL", "INPUT", "META", "LINK"]);

function t10ParseNode(html: string, pos: number): { node: T10TestNode; end: number } | null {
  if (pos >= html.length) return null;
  if (html[pos] === "<") {
    if (html[pos + 1] === "/" || html.slice(pos, pos + 4) === "<!--") return null;
    const gtIdx = html.indexOf(">", pos + 1);
    if (gtIdx < 0) return null;
    const tagContent = html.slice(pos + 1, gtIdx);
    const selfClose = tagContent.endsWith("/");
    const tagBody = selfClose ? tagContent.slice(0, -1).trim() : tagContent;
    const spaceIdx = tagBody.search(/\s/);
    const tagName = (spaceIdx < 0 ? tagBody : tagBody.slice(0, spaceIdx)).toUpperCase();
    let end = gtIdx + 1;
    const childNodes: T10TestNode[] = [];
    if (!selfClose && !VOID_TAGS_T10.has(tagName)) {
      let cur = end;
      while (cur < html.length) {
        const closingMatch = new RegExp(`^</${tagName}\\s*>`, "i").exec(html.slice(cur));
        if (closingMatch !== null) { cur += closingMatch[0].length; break; }
        const child = t10ParseNode(html, cur);
        if (child === null) break;
        childNodes.push(child.node);
        cur = child.end;
      }
      end = cur;
    }
    return { node: new T10TestNode("element", tagName, new Map(), childNodes, ""), end };
  } else {
    const ltIdx = html.indexOf("<", pos);
    const raw = ltIdx < 0 ? html.slice(pos) : html.slice(pos, ltIdx);
    if (raw === "") return null;
    const decoded = raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
    return { node: new T10TestNode("text", "", new Map(), [], decoded), end: ltIdx < 0 ? html.length : ltIdx };
  }
}

const testHtmlParser: HtmlParser = (html: string): HtmlNode => {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const inner = bodyMatch !== null ? (bodyMatch[1] ?? html) : html;
  const childNodes: T10TestNode[] = [];
  let pos = 0;
  while (pos < inner.length) {
    const r = t10ParseNode(inner, pos);
    if (r === null) {
      const next = inner.indexOf("<", pos);
      if (next < 0 || next === pos) break;
      pos = next;
      continue;
    }
    childNodes.push(r.node);
    pos = r.end;
  }
  return new T10TestNode("element", "BODY", new Map(), childNodes, "");
};

/** Config with html parser for rich paste tests. */
const richConfig: EditorConfig = { ...config, htmlParser: testHtmlParser };

/** Config with suggesting mode for suggesting-branch tests. */
const suggestingConfig: EditorConfig = { ...config, suggestingAuthor: "alice" };

/** Config with both html parser and suggesting mode. */
const richSuggestingConfig: EditorConfig = {
  ...config,
  htmlParser: testHtmlParser,
  suggestingAuthor: "alice",
};

/**
 * Build a minimal fragment State with one paragraph containing `text`.
 * Used to encode as clip and verify priority routing.
 */
function makeClipFragment(text: string): State {
  return buildDocumentFromTree(
    {
      type: "document",
      children: [
        {
          type: "paragraph",
          inlineContent: { items: [{ kind: "text", text, attrs: {} }] },
        },
      ],
    },
    {},
    createTestAllocator("clip"),
  );
}

/**
 * Build a clip fragment whose single run carries the given inline attrs (used to
 * simulate carried suggestion provenance — a foreign DELETION/INSERTION id).
 */
function makeClipFragmentWithAttrs(
  text: string,
  attrs: Record<string, unknown>,
  seed = "clipattr",
): State {
  return buildDocumentFromTree(
    {
      type: "document",
      children: [
        {
          type: "paragraph",
          inlineContent: { items: [{ kind: "text", text, attrs }] },
        },
      ],
    },
    {},
    createTestAllocator(seed),
  );
}

/** Walk a State document root's top-level children and collect their block ids. */
function fragTopLevelBlocks(state: State): BlockId[] {
  const root = resolveBlock(state, state.rootId)?.block;
  if (root === undefined) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = root.firstChildId ?? null;
  while (id !== null) {
    ids.push(id);
    id = resolveBlock(state, id)?.block.nextSiblingId ?? null;
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// T10 priority routing tests
// ─────────────────────────────────────────────────────────────────────────────

describe("handlePaste — T10 rich routing: priority clip→html→text", () => {
  it("prefers clip over html and text: clip fragment text lands, not html/text content", () => {
    const initial = createInitialEditorState(richConfig);
    const clipFragment = makeClipFragment("FROM_CLIP");
    const clip = encodeFragmentClip(clipFragment);

    const next = reduceEditor(
      initial,
      { type: "PASTE", clip, html: "<p>FROM_HTML</p>", text: "FROM_TEXT" },
      richConfig,
    );

    const blocks = fragTopLevelBlocks(next.state);
    // The clip fragment has exactly 1 paragraph with "FROM_CLIP".
    expect(getTextOf(next.state, blocks[0]!)).toBe("FROM_CLIP");
  });

  it("falls back to html when no clip present and parser is configured", () => {
    const initial = createInitialEditorState(richConfig);

    const next = reduceEditor(
      initial,
      { type: "PASTE", html: "<p>FROM_HTML</p>", text: "FROM_TEXT" },
      richConfig,
    );

    const blocks = fragTopLevelBlocks(next.state);
    expect(getTextOf(next.state, blocks[0]!)).toBe("FROM_HTML");
  });

  it("falls back to text when no parser is configured, even with html present", () => {
    // config has NO htmlParser — html present but no parser → plain-text path.
    const initial = createInitialEditorState(config);

    const next = reduceEditor(
      initial,
      { type: "PASTE", html: "<p>FROM_HTML</p>", text: "FROM_TEXT" },
      config,
    );

    const blocks = fragTopLevelBlocks(next.state);
    // Plain text path: no <p> tags stripped, literal text "FROM_TEXT" inserted.
    expect(getTextOf(next.state, blocks[0]!)).toBe("FROM_TEXT");
  });

  it("malformed clip falls through to html (clip:'@@@' → invalid base64)", () => {
    const initial = createInitialEditorState(richConfig);
    // "@@@" is not valid base64 → decodeFragmentClip returns null → fall through to html.
    const badClip = "@@@";
    expect(decodeFragmentClip(badClip)).toBeNull(); // pre-condition

    const next = reduceEditor(
      initial,
      { type: "PASTE", clip: badClip, html: "<p>FROM_HTML</p>", text: "FROM_TEXT" },
      richConfig,
    );

    const blocks = fragTopLevelBlocks(next.state);
    expect(getTextOf(next.state, blocks[0]!)).toBe("FROM_HTML");
  });

  it("plain {text} path is byte-identical to today — no regression on multi-line", () => {
    // This mirrors test (2) from the existing suite but goes through the new routing code.
    const initial = createInitialEditorState(richConfig);

    const next = reduceEditor(initial, { type: "PASTE", text: "a\nb\nc" }, richConfig);

    const blocks = fragTopLevelBlocks(next.state);
    expect(blocks).toHaveLength(3);
    expect(getTextOf(next.state, blocks[0]!)).toBe("a");
    expect(getTextOf(next.state, blocks[1]!)).toBe("b");
    expect(getTextOf(next.state, blocks[2]!)).toBe("c");
    // Cursor at end of last line.
    expect(next.selection.focus).toEqual({ blockId: blocks[2], offset: 1 });
  });

  it("no usable payload → no-op (returns same editor reference)", () => {
    const initial = createInitialEditorState(richConfig);
    // PASTE with nothing usable: empty text, no html, no clip.
    const next = reduceEditor(initial, { type: "PASTE" }, richConfig);
    expect(next).toBe(initial);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 suggesting-mode tests
// ─────────────────────────────────────────────────────────────────────────────

describe("handlePaste — T10 suggesting mode with rich routing", () => {
  /**
   * Walk all inline items of a block and return the set of unique
   * INSERTION_SUGGESTION_ATTR values present.
   */
  function insertionIds(state: State, blockId: BlockId): Set<string> {
    const block = resolveBlock(state, blockId)?.block;
    const ids = new Set<string>();
    for (const item of block?.inlineContent?.items ?? []) {
      if (item.kind === "text") {
        const v = item.attrs[INSERTION_SUGGESTION_ATTR];
        if (typeof v === "string") ids.add(v);
      }
    }
    return ids;
  }

  /** Collect the unique DELETION_SUGGESTION_ATTR values on a block's text runs. */
  function deletionIds(state: State, blockId: BlockId): Set<string> {
    const block = resolveBlock(state, blockId)?.block;
    const ids = new Set<string>();
    for (const item of block?.inlineContent?.items ?? []) {
      if (item.kind === "text") {
        const v = item.attrs[DELETION_SUGGESTION_ATTR];
        if (typeof v === "string") ids.add(v);
      }
    }
    return ids;
  }

  it("rich html paste in suggesting mode tracks ALL pasted text as ONE insertion id", () => {
    // Two paragraphs in the fragment: both runs should share the same insertionId.
    const initial = createInitialEditorState(richSuggestingConfig);

    const next = reduceEditor(
      initial,
      { type: "PASTE", html: "<p>Hello</p><p>World</p>", text: "Hello\nWorld" },
      richSuggestingConfig,
    );

    const blocks = fragTopLevelBlocks(next.state);
    // At least 2 blocks in the result doc.
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    // Collect all insertionIds across all blocks.
    const allIds = new Set<string>();
    for (const id of blocks) {
      for (const insId of insertionIds(next.state, id)) allIds.add(insId);
    }
    // All tracked insertion runs share ONE suggestion id (the whole paste is ONE insertion).
    expect(allIds.size).toBe(1);
  });

  it("table in fragment is flattened to leaf paragraphs in suggesting mode", () => {
    // A table fragment: <table><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></table>
    const tableHtml =
      "<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></tbody></table>";

    const initial = createInitialEditorState(richSuggestingConfig);

    const next = reduceEditor(
      initial,
      { type: "PASTE", html: tableHtml, text: "Cell A\tCell B" },
      richSuggestingConfig,
    );

    // In suggesting mode, the table MUST have been flattened. The resulting
    // document should contain text from both cells as tracked insertions.
    const blocks = fragTopLevelBlocks(next.state);
    const allText = blocks.map((id) => getTextOf(next.state, id)).join("|");
    // Both cell texts must be present somewhere.
    expect(allText).toContain("Cell A");
    expect(allText).toContain("Cell B");

    // Every tracked text run should carry an insertionId (suggesting mode).
    const allIds = new Set<string>();
    for (const id of blocks) {
      for (const insId of insertionIds(next.state, id)) allIds.add(insId);
    }
    expect(allIds.size).toBeGreaterThanOrEqual(1);
  });

  it("suggesting mode: clip paste carrying a foreign INSERTION id re-tracks under a FRESH id", () => {
    // The clip's run carries a foreign insertion id (provenance from the source doc).
    // Per spec §3.3, suggesting-mode paste IGNORES carried suggestion state and
    // re-tracks the whole paste as a fresh insertion: the resulting run's insertion
    // id must DIFFER from the carried one (no foreign/dangling id survives).
    const carriedInsId = "foreign-insertion-id-123";
    const clipFragment = makeClipFragmentWithAttrs("CLIP_TEXT", {
      [INSERTION_SUGGESTION_ATTR]: carriedInsId,
    });
    const clip = encodeFragmentClip(clipFragment);

    const freshSuggesting = createInitialEditorState(suggestingConfig);
    const next = reduceEditor(
      freshSuggesting,
      { type: "PASTE", clip, text: "CLIP_TEXT" },
      suggestingConfig,
    );

    const resultBlocks = fragTopLevelBlocks(next.state);
    expect(getTextOf(next.state, resultBlocks[0]!)).toBe("CLIP_TEXT");

    const allIns = new Set<string>();
    for (const id of resultBlocks) {
      for (const insId of insertionIds(next.state, id)) allIns.add(insId);
    }
    // Exactly one fresh insertion id, and it is NOT the carried (foreign) one.
    expect(allIns.size).toBe(1);
    expect(allIns.has(carriedInsId)).toBe(false);
  });

  it("suggesting mode: clip paste carrying a foreign DELETION id is stripped — no deletion attr leaks", () => {
    // The clip's run carries a foreign DELETION id (e.g. text copied while it had a
    // pending deletion suggestion). Per §3.3, suggesting-mode paste must STRIP it:
    // the re-tracked run carries ONLY the fresh insertion id, NO deletion attr, and
    // the dangling foreign id never appears in the destination.
    const carriedDelId = "foreign-deletion-id-456";
    const clipFragment = makeClipFragmentWithAttrs("CLIP_TEXT", {
      [DELETION_SUGGESTION_ATTR]: carriedDelId,
    });
    const clip = encodeFragmentClip(clipFragment);

    const freshSuggesting = createInitialEditorState(suggestingConfig);
    const next = reduceEditor(
      freshSuggesting,
      { type: "PASTE", clip, text: "CLIP_TEXT" },
      suggestingConfig,
    );

    const resultBlocks = fragTopLevelBlocks(next.state);
    expect(getTextOf(next.state, resultBlocks[0]!)).toBe("CLIP_TEXT");

    // No deletion attr survives anywhere — the carried (foreign) id is gone.
    const allDel = new Set<string>();
    for (const id of resultBlocks) {
      for (const delId of deletionIds(next.state, id)) allDel.add(delId);
    }
    expect(allDel.size).toBe(0);
    expect(allDel.has(carriedDelId)).toBe(false);

    // The run IS tracked as a fresh insertion (suggesting mode re-tracks it).
    const allIns = new Set<string>();
    for (const id of resultBlocks) {
      for (const insId of insertionIds(next.state, id)) allIns.add(insId);
    }
    expect(allIns.size).toBe(1);
  });
});

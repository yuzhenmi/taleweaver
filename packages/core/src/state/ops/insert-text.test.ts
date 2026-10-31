import { describe, it, expect } from "vitest";
import { insertText, insertTextInTx, planInsertText } from "./insert-text";
import { getBlock } from "../document";
import { DOCUMENT_INTERNAL } from "../document-internal";
import * as Y from "yjs";
import { buildBlock, buildDocument, buildFlowDoc, text, embed, inlineContent, withTestAttrs } from "../../test-utils/document-builders";
import { splitBlockAtPosition } from "./split-block";
import { getRegistry } from "../registry";
import { createTestAllocator } from "../block-id";
import { createPosition } from "../block-position";
import type { BlockId } from "../block-id";
import { relAt, survives } from "../../test-utils/relpos-survival";

describe("insertText — middle of single text item", () => {
  // doc > [p("hello world")]
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello world")]),
        }),
      ],
    });

  it("inserts the text into the middle of the existing item, preserving attrs", () => {
    const document = fixture();
    const result = insertText(document, createPosition("p" as BlockId, 5), " beautiful", {});
    const updated = getBlock(result.document, "p" as BlockId);
    expect(updated?.inlineContent?.items).toHaveLength(1);
    const item = updated?.inlineContent?.items[0];
    expect(item?.kind).toBe("text");
    if (item?.kind === "text") {
      expect(item.text).toBe("hello beautiful world");
      expect(item.attrs).toEqual({});
    }
  });

  it("returns dirtyIds containing only the modified block", () => {
    const document = fixture();
    const result = insertText(document, createPosition("p" as BlockId, 5), " beautiful", {});
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("preserves immutability (original snapshots and state not mutated; modified block produces a fresh snapshot)", () => {
    const document = fixture();
    const beforeP = getBlock(document, "p" as BlockId);
    const beforeDoc = getBlock(document, "doc" as BlockId);
    const result = insertText(document, createPosition("p" as BlockId, 5), " x", {});
    // Original state instance is replaced by a fresh one (fresh snapshot cache).
    expect(result.document).not.toBe(document);
    // The modified block produces a new snapshot.
    expect(getBlock(result.document, "p" as BlockId)).not.toBe(beforeP);
    // Original block snapshot is frozen and unchanged.
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world" });
    // Unmodified blocks (doc) preserve snapshot reference identity across
    // operations via the carry-forward cache in applyOperation — memoized
    // renderers can `prev === next` to skip unchanged subtrees.
    expect(getBlock(result.document, "doc" as BlockId)).toBe(beforeDoc);
  });

  it("normalizes already-unnormalized inline content (merges adjacent same-attrs text items in input)", () => {
    // Input is unnormalized: three adjacent same-attrs text items. The
    // post-pass should merge them all (along with any new insertion).
    // inlineContent() does NOT normalize, so this is a real input shape.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("a"), text("b"), text("c")]),
        }),
      ],
    });
    // Insert at offset 1 (between "a" and "b"): all attrs equal, so the result should be one merged item.
    const result = insertText(document, createPosition("p" as BlockId, 1), "X", {});
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "aXbc", attrs: {} });
  });
});

describe("insertText — offset 0 (beginning of block)", () => {
  it("prepends text in front of the existing first item (different attrs → new run)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 0), "hello ", { bold: true });
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello ", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });

  it("merges with the first item when attrs are equal", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 0), "hello ", {});
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello world", attrs: {} });
  });
});

describe("insertText — end of block (offset === inlineContentLength)", () => {
  it("appends text after the last item (different attrs → new run)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 5), "!", { italic: true });
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "!", attrs: { italic: true } });
  });

  it("merges with the last item when attrs are equal", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 5), "!", {});
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello!", attrs: {} });
  });
});

describe("insertText — empty block", () => {
  it("creates the first text item in an empty block", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 0), "hi", { bold: true });
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hi", attrs: { bold: true } });
  });
});

describe("insertText — split a different-attrs text item", () => {
  // Block: [text("helloworld") with attrs {}]
  // Insert "BOLD" with { bold: true } at offset 5
  // Expected: [text("hello") {}, text("BOLD") {bold:true}, text("world") {}]
  it("splits the affected text item into prefix + new + suffix when attrs differ", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("helloworld")]) }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 5), "BOLD", { bold: true });
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "BOLD", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "world", attrs: {} });
  });
});

describe("insertText — at boundary between two text items", () => {
  // Block: [text("hello") {}, text("world") {bold:true}]  (length 10)
  // Insert " " {} at offset 5 (the boundary between the two items)
  // Expected: text(" ") merges with the prev item (same attrs), giving:
  //   [text("hello ") {}, text("world") {bold:true}]
  it("merges with the previous item when boundary attrs match the prev item", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 5), " ", {});
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello ", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "world", attrs: { bold: true } });
  });

  it("creates a new run when boundary attrs match neither side", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), text("world", { bold: true })]),
        }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 5), "X", { italic: true });
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "X", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "world", attrs: { bold: true } });
  });

  it("does NOT merge two same-attrs runs across a different-attrs insert (contract pin)", () => {
    // [text("a") {bold}, text("b") {bold}] insert "X" {italic} at offset 1
    // Expected: [text("a") {bold}, text("X") {italic}, text("b") {bold}]
    // — the two {bold} runs do NOT collapse across the {italic} run.
    // This pins the contract: the merge pass walks linearly and only
    // merges immediately adjacent same-attrs items; it never collapses
    // across an intervening different-attrs item.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("a", { bold: true }), text("b", { bold: true })]),
        }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 1), "X", { italic: true });
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "X", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});

describe("insertText — adjacent to embed items", () => {
  // Block: [text("a") {}, embed("image"), text("b") {}]  (length 3)

  it("inserts immediately before an embed when offset === embed start", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 1 = end of "a" / start of embed. Algorithm prefers trailing-edge of text item, so "X" merges with "a".
    const result = insertText(document, createPosition("p" as BlockId, 1), "X", {});
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "aX" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b" });
  });

  it("inserts immediately after an embed when offset === embed end", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    // offset 2 = end of embed / start of "b". Algorithm puts text BEFORE the next text item; merges with "b" if attrs match.
    const result = insertText(document, createPosition("p" as BlockId, 2), "Y", {});
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "Yb" });
  });

  it("inserts at the start of a block whose first item is an embed", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("image"), text("b")]),
        }),
      ],
    });
    // offset 0 = before embed.
    const result = insertText(document, createPosition("p" as BlockId, 0), "X", {});
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "X" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "image" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b" });
  });
});

describe("insertText — empty text", () => {
  it("returns the original state with empty dirtyIds", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = insertText(document, createPosition("p" as BlockId, 2), "", {});
    expect(result.document).toBe(document);
    expect([...result.dirtyIds]).toEqual([]);
  });
});

describe("insertText — character survival (one offset insert)", () => {
  // Inline storage is one Y.Text per block: an insert never re-mints an existing
  // character, whatever its attrs — same-attrs, different-attrs (mid-run), or next
  // to an embed.
  const fixture = (runs: Parameters<typeof inlineContent>[0]) =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent(runs) }),
      ],
    });

  it("same-attrs insert keeps every character", () => {
    const document = fixture([text("hello")]);
    const rels = [0, 4].map((o) => relAt(document, "p", o));
    const after = insertText(document, createPosition("p" as BlockId, 3), "X", {}).document;
    expect(survives(rels[0] ?? relAt(document, "p", 0), after, "h")).toBe(true);
    expect(survives(rels[1] ?? relAt(document, "p", 0), after, "o")).toBe(true);
  });

  it("a DIFFERENT-attrs insert inside a run keeps every character of the run", () => {
    const document = fixture([text("helloworld")]);
    const relW = relAt(document, "p", 5);
    const relO = relAt(document, "p", 4);
    const result = insertText(document, createPosition("p" as BlockId, 5), "BOLD", { bold: true });
    expect(survives(relW, result.document, "w")).toBe(true);
    expect(survives(relO, result.document, "o")).toBe(true);
    expect(getBlock(result.document, "p" as BlockId)?.inlineContent?.items).toEqual([
      text("hello"),
      text("BOLD", { bold: true }),
      text("world"),
    ]);
  });

  it("inserts with COMPLETE attrs: typing {} after a bold run is not bold", () => {
    const document = fixture([text("hello", { bold: true })]);
    const result = insertText(document, createPosition("p" as BlockId, 5), "!", {});
    expect(getBlock(result.document, "p" as BlockId)?.inlineContent?.items).toEqual([
      text("hello", { bold: true }),
      text("!"),
    ]);
  });

  it("an insert next to an embed keeps the neighbouring characters", () => {
    const document = fixture([text("a"), embed("image", {}), text("hello", { italic: true })]);
    const rel = relAt(document, "p", 2);
    const result = insertText(document, createPosition("p" as BlockId, 3), "X", { italic: true });
    expect(survives(rel, result.document, "h")).toBe(true);
    expect(getBlock(result.document, "p" as BlockId)?.inlineContent?.items).toEqual([
      text("a"),
      embed("image", {}),
      text("hXello", { italic: true }),
    ]);
  });
});

describe("insertText — error cases", () => {
  it("throws when the block does not exist", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(() => insertText(document, createPosition("missing" as BlockId, 0), "x", {})).toThrow(/not found/);
  });

  it("throws when the block is a container (no inlineContent)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        // A container with a child (an empty SECTION is not in the read model).
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => insertText(document, createPosition("s" as BlockId, 0), "x", {})).toThrow(/not a leaf/);
  });

  it("throws when offset is negative", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(() => insertText(document, createPosition("p" as BlockId, -1), "x", {})).toThrow(/out of range/);
  });

  it("throws when offset exceeds inline-content length", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    // Inline-content length is 2; valid offsets are [0, 2]. Offset 3 is out of range.
    expect(() => insertText(document, createPosition("p" as BlockId, 3), "x", {})).toThrow(/out of range/);
  });
});

describe("insertTextInTx — transaction guard", () => {
  it("throws when called outside any Y.Doc transaction", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hi")]),
        }),
      ],
    });
    const plan = planInsertText(document, createPosition("p" as BlockId, 0), "X", {});
    expect(() => insertTextInTx(document[DOCUMENT_INTERNAL].doc, plan)).toThrow(
      /insertText: must be called inside Y\.Doc\.transact/,
    );
  });
});

describe("insertText — the ¶'s character props follow typing at the paragraph end", () => {
  // The editor binds its attr registry to the doc; every ¶-props writer reads it there.
  const flowDoc = (...a: Parameters<typeof buildFlowDoc>) => withTestAttrs(buildFlowDoc(...a));
  const marks = (s: ReturnType<typeof buildFlowDoc>, b: string) => getBlock(s, b as BlockId)?.markAttrs;

  it("typing at (P, len) gives ¶P the inclusive subset of the typed run's attrs (no link, no provenance)", () => {
    const s0 = flowDoc([{ p: "P", t: "ab" }, { p: "Q", t: "z" }]);
    const s1 = insertText(s0, createPosition("P" as BlockId, 2), "c", { bold: true, link: "x", insertionSuggestionId: "s1" }).document;
    expect(marks(s1, "P")).toEqual({ bold: true });
    // Typing into an EMPTY paragraph also sets them (its start is its end).
    const s2 = insertText(flowDoc([{ p: "E", t: "" }]), createPosition("E" as BlockId, 0), "x", { italic: true }).document;
    expect(marks(s2, "E")).toEqual({ italic: true });
  });

  it("typing before the end, or a keystroke with unchanged attrs, writes no entry update (O(1))", () => {
    const s0 = flowDoc([{ p: "P", t: "ab", markAttrs: { bold: true } }]);
    const m = getRegistry(s0[DOCUMENT_INTERNAL].doc).get("P")?.get("markAttrs");
    if (!(m instanceof Y.Map)) throw new Error("no markAttrs map");
    let events = 0;
    m.observe(() => events++);
    const mid = insertText(s0, createPosition("P" as BlockId, 1), "x", { italic: true }).document;
    const same = insertText(mid, createPosition("P" as BlockId, 3), "y", { bold: true, link: "u" }).document;
    expect(events).toBe(0);
    expect(marks(same, "P")).toEqual({ bold: true });
  });

  it("Enter after bold text at the end leaves a bold EMPTY line (the tail keeps ¶B)", () => {
    const s0 = flowDoc([{ p: "B", t: "ab" }]);
    const typed = insertText(s0, createPosition("B" as BlockId, 2), "c", { bold: true }).document;
    const split = splitBlockAtPosition(typed, createPosition("B" as BlockId, 3), createTestAllocator("n")).document;
    expect(getBlock(split, "B" as BlockId)?.inlineContent?.items).toEqual([]);
    expect(marks(split, "B")).toEqual({ bold: true });
    expect(marks(split, "n-0")).toEqual({ bold: true });
  });

  it("suggesting-style typing at (P, len) then Enter: the empty line carries no suggestion attr and no link", () => {
    const s0 = flowDoc([{ p: "B", t: "ab" }]);
    const typed = insertText(s0, createPosition("B" as BlockId, 2), "c", { insertionSuggestionId: "s1", link: "x" }).document;
    const split = splitBlockAtPosition(typed, createPosition("B" as BlockId, 3), createTestAllocator("n")).document;
    expect(marks(split, "B")).toBeUndefined();
  });
});

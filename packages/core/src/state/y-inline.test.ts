import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  attrsDiff,
  buildYInlineText,
  deleteInlineRange,
  formatInlineRange,
  inlineItemsFromYText,
  insertInlineItems,
  insertInlineText,
  readYInline,
  toYAttributes,
  assertInlineStorageInvariants,
  LegacyDocumentError,
} from "./y-inline";
import { mergeAdjacentTextItems, type InlineItem } from "./inline-content";
import type { BlockId } from "./block-id";
import { AttrRegistry } from "../cascade/attr-registry";

/** A live (integrated) block Y.Text seeded with `items`. */
function liveText(items: InlineItem[], doc = new Y.Doc()): Y.Text {
  const yText = buildYInlineText({ items });
  doc.getMap("root").set("t", yText);
  return yText;
}

const text = (t: string, attrs: Record<string, unknown> = {}): InlineItem => ({ kind: "text", text: t, attrs });
const marker = (embedType = "comment-start"): InlineItem => ({
  kind: "embed",
  embedType,
  attrs: {},
  properties: { commentId: "c1" },
});

describe("y-inline — attr boundary", () => {
  it("toYAttributes drops null and undefined (stored attrs never hold either)", () => {
    expect(toYAttributes({ bold: true, link: null, color: undefined })).toEqual({ bold: true });
  });

  it("an insert with a null attr reads back exactly like one without the key", () => {
    const yText = liveText([]);
    insertInlineText(yText, 0, "ab", { bold: true, italic: null });
    expect(inlineItemsFromYText(yText)).toEqual([text("ab", { bold: true })]);
  });

  it("a format delta's null / undefined value REMOVES the key", () => {
    const yText = liveText([text("abc", { bold: true, italic: true })]);
    formatInlineRange(yText, 0, 3, { bold: null, italic: undefined, color: "red" });
    expect(inlineItemsFromYText(yText)).toEqual([text("abc", { color: "red" })]);
  });

  it("attrsDiff yields set keys + null for removed keys, nothing for equal ones", () => {
    expect(attrsDiff({ a: 1, b: 2, c: { x: 1 } }, { a: 1, c: { x: 1 }, d: 4 })).toEqual({ b: null, d: 4 });
  });
});

describe("y-inline — inserts pass COMPLETE attrs", () => {
  it("an insert next to a bold run with {} attrs is NOT bold (Yjs negates unlisted keys)", () => {
    const yText = liveText([text("ab", { bold: true })]);
    insertInlineText(yText, 2, "X", {});
    expect(inlineItemsFromYText(yText)).toEqual([text("ab", { bold: true }), text("X")]);
  });

  it("a registry-equal attr value is written as the left neighbour's stored value", () => {
    const registry = new AttrRegistry();
    registry.register({
      attrKey: "comment",
      toStyle: () => ({}),
      equals: (a, b) => typeof a === "object" && a !== null && typeof b === "object" && b !== null && "id" in a && "id" in b && a.id === b.id,
    });
    const yText = liveText([text("ab", { comment: { id: "c", ts: 1 } })]);
    insertInlineText(yText, 2, "X", { comment: { id: "c", ts: 2 } }, registry);
    expect(inlineItemsFromYText(yText)).toEqual([text("abX", { comment: { id: "c", ts: 1 } })]);
  });

  it("never takes a structural marker as the canonical neighbour", () => {
    const registry = new AttrRegistry();
    registry.register({ attrKey: "comment", toStyle: () => ({}), equals: () => true });
    const yText = liveText([text("ab", { comment: 1 }), marker()]);
    // Left of offset 3 is the marker; the canonical source is the run before it.
    insertInlineText(yText, 3, "X", { comment: 2 }, registry);
    const items = inlineItemsFromYText(yText);
    expect(items[2]).toEqual(text("X", { comment: 1 }));
  });
});

describe("y-inline — format", () => {
  it("never writes formatting onto a structural marker (split around it)", () => {
    const yText = liveText([text("ab"), marker(), text("cd")]);
    formatInlineRange(yText, 0, 5, { bold: true });
    expect(inlineItemsFromYText(yText)).toEqual([text("ab", { bold: true }), marker(), text("cd", { bold: true })]);
    // The marker embed itself holds no format item.
    const delta = yText.toDelta() as { insert: unknown; attributes?: unknown }[];
    expect(delta[1]?.attributes).toBeUndefined();
  });

  it("clamps the range to the content (Yjs would append newlines past the end)", () => {
    const yText = liveText([text("ab")]);
    formatInlineRange(yText, 1, 50, { bold: true });
    expect(yText.length).toBe(2);
    expect(inlineItemsFromYText(yText)).toEqual([text("a"), text("b", { bold: true })]);
  });

  it("re-applying an existing format writes nothing (no Yjs change)", () => {
    const doc = new Y.Doc();
    const yText = liveText([text("abc", { bold: true })], doc);
    let changed = 0;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      if (tx.changed.size > 0) changed++;
    });
    doc.transact(() => formatInlineRange(yText, 0, 3, { bold: true }));
    expect(changed).toBe(0);
  });

  it("formatting never re-mints characters (a RelativePosition keeps its char)", () => {
    const doc = new Y.Doc();
    const yText = liveText([text("hello")], doc);
    const rel = Y.createRelativePositionFromTypeIndex(yText, 3);
    formatInlineRange(yText, 1, 4, { bold: true });
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
    expect(abs?.type).toBe(yText);
    expect(abs?.index).toBe(3);
  });
});

describe("y-inline — grapheme snapping (no U+FFFD)", () => {
  const SMILE = "😀"; // a surrogate pair
  const FAMILY = "👨‍👩‍👧"; // a ZWJ sequence

  it("format with an endpoint inside a surrogate pair snaps the range OUT", () => {
    const yText = liveText([text(`a${SMILE}b`)]);
    formatInlineRange(yText, 2, 4, { bold: true }); // 2 is between the surrogates
    const items = inlineItemsFromYText(yText);
    expect(items).toEqual([text("a"), text(`${SMILE}b`, { bold: true })]);
    expect(items.map((i) => (i.kind === "text" ? i.text : "")).join("")).not.toContain("�");
  });

  it("delete with an endpoint inside a ZWJ sequence removes the whole cluster", () => {
    const yText = liveText([text(`x${FAMILY}y`)]);
    deleteInlineRange(yText, 0, 3); // ends inside the family cluster
    expect(inlineItemsFromYText(yText)).toEqual([text("y")]);
  });

  it("an insert offset inside a surrogate pair snaps to the cluster start", () => {
    const yText = liveText([text(`a${SMILE}`)]);
    insertInlineText(yText, 2, "Z", {});
    expect(inlineItemsFromYText(yText)).toEqual([text(`aZ${SMILE}`)]);
  });
});

describe("y-inline — read model", () => {
  it("coalesces adjacent runs whose attrs are deep-equal (Yjs compares flat)", () => {
    const yText = liveText([]);
    insertInlineText(yText, 0, "ab", { link: { href: "x" } });
    // A distinct-but-deep-equal object value: Yjs keeps a format boundary.
    yText.insert(2, "cd", { link: { href: "x" } });
    expect(inlineItemsFromYText(yText)).toEqual([text("abcd", { link: { href: "x" } })]);
  });

  it("projects a peer-formatted marker to empty attrs", () => {
    const yText = liveText([text("ab"), marker()]);
    yText.format(0, 3, { bold: true }); // a raw (peer-style) format across the marker
    expect(inlineItemsFromYText(yText)).toEqual([text("ab", { bold: true }), marker()]);
  });

  it("embeds are plain JSON { embedType, properties }", () => {
    const yText = liveText([]);
    insertInlineItems(yText, 0, [{ kind: "embed", embedType: "tab", attrs: { bold: true }, properties: { w: 1 } }]);
    expect(yText.toDelta()).toEqual([{ insert: { embedType: "tab", properties: { w: 1 } }, attributes: { bold: true } }]);
  });
});

describe("y-inline — legacy detection", () => {
  it("readYInline throws LegacyDocumentError on the legacy run-array shape", () => {
    const doc = new Y.Doc();
    const yBlock = new Y.Map<unknown>();
    doc.getMap("blocks").set("p", yBlock);
    yBlock.set("inlineContent", new Y.Array());
    expect(() => readYInline(yBlock, "p" as BlockId)).toThrow(LegacyDocumentError);
  });
});

describe("y-inline — read model equals the JS normalizer (randomized)", () => {
  // Deterministic PRNG (mulberry32) — same seed, same inputs, no flake.
  function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ATTRS = [{}, { bold: true }, { italic: true }, { bold: true, italic: true }, { link: { href: "x" } }];
  const TEXTS = ["", "a", "bc", "xyz"];

  it("storing any item stream and reading it back = mergeAdjacentTextItems(stream)", () => {
    const rng = mulberry32(0xcafebabe);
    const pick = <T,>(xs: readonly T[]): T => {
      const v = xs[Math.floor(rng() * xs.length)];
      if (v === undefined) throw new Error("empty pool");
      return v;
    };
    for (let iter = 0; iter < 200; iter++) {
      const input: InlineItem[] = Array.from({ length: 2 + Math.floor(rng() * 9) }, () =>
        rng() < 0.7
          ? text(pick(TEXTS), { ...pick(ATTRS) })
          : { kind: "embed", embedType: pick(["image", "tab", "comment-end"]), attrs: { ...pick(ATTRS) }, properties: {} },
      );
      const expected = mergeAdjacentTextItems(input).map((it) =>
        it.kind === "embed" && it.embedType === "comment-end" ? { ...it, attrs: {} } : it,
      );
      expect(inlineItemsFromYText(liveText(input)), JSON.stringify(input)).toEqual(expected);
    }
  });
});

describe("y-inline — assertInlineStorageInvariants", () => {
  /** A doc whose block "p" holds a Y.Text written by `write`. */
  function blockWith(write: (t: Y.Text) => void): Y.Doc {
    const doc = new Y.Doc();
    const yBlock = new Y.Map<unknown>();
    const yText = new Y.Text();
    yBlock.set("inlineContent", yText);
    doc.getMap<Y.Map<unknown>>("blocks").set("p", yBlock);
    write(yText);
    return doc;
  }
  const check = (doc: Y.Doc) => () => assertInlineStorageInvariants(doc, "op", ["p" as BlockId]);

  it("a pair split across two RUNS throws, though the joined text is whole", () => {
    const doc = blockWith((t) => {
      t.insert(0, "\uD83D", { bold: true });
      t.insert(1, "\uDE00");
    });
    expect(check(doc)).toThrow(/lone surrogate/);
  });

  it("a pair split across two SAME-attr items throws (the delta joins them)", () => {
    const doc = blockWith((t) => {
      t.insert(0, "\uDE00");
      t.insert(0, "\uD83D"); // left of the first item: Yjs keeps two items
    });
    const yText = doc.getMap<Y.Map<unknown>>("blocks").get("p")?.get("inlineContent");
    if (!(yText instanceof Y.Text)) throw new Error("setup");
    expect(yText.toDelta()).toEqual([{ insert: "😀" }]);
    expect(check(doc)).toThrow(/lone surrogate/);
  });

  it("a whole pair passes", () => {
    expect(check(blockWith((t) => t.insert(0, "a😀b")))).not.toThrow();
  });
});

/**
 * Several formatting suggestions on the same characters: each keeps its own
 * per-run tag (`formattingSuggestionId:<id>`), so each stays independently
 * resolvable; preview + resolution follow the (createdAt, id) order with
 * per-run shadowing of keys an accepted newer suggestion already set.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  acceptAll,
  acceptSuggestion,
  acceptSuggestionGroup,
  assignSuggestionGroup,
  markFormatting,
  rejectAll,
  rejectSuggestion,
} from "./suggestion-ops";
import {
  formattingSuggestionIds,
  formattingSuggestionKey,
  getSuggestionGroups,
  getSuggestions,
  nextSuggestionOrder,
  pendingFormattingSuggestions,
  readSuggestionRecord,
  resolveFormattingSuggestionTags,
  type SuggestionId,
} from "../suggestions";
import { createHistory } from "../history";
import { createDocument, getBlock, type Document } from "../document";
import { DOCUMENT_INTERNAL } from "../document-internal";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { TEST_RESOLVER, buildBlock, buildDocument, embed, inlineContent, text } from "../../test-utils/document-builders";
import { suggestionHighlightDecorations } from "../../decorations/builtin-highlights";
import { getMarkRanges } from "../mark-ranges";
import { createDefaultAttrRegistry, markTypeOf } from "../../cascade/attr-registry";

const A = "sA" as SuggestionId;
const B = "sB" as SuggestionId;
const C = "sC" as SuggestionId;
const P = "p" as BlockId;

function doc(chars = "abcdefghijklmnopqrst"): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text(chars)]) }),
    ],
  });
}

const span = (a: number, b: number) => createSpan(createPosition(P, a), createPosition(P, b));

/** The attrs of the char at `offset` in p. */
function attrsAt(s: Document, offset: number): ReadonlyAttrs {
  let pos = 0;
  for (const it of getBlock(s, P)?.inlineContent?.items ?? []) {
    const len = it.kind === "text" ? it.text.length : 1;
    if (offset < pos + len) return it.attrs;
    pos += len;
  }
  throw new Error(`no char at ${offset}`);
}

function rangeOf(s: Document, id: SuggestionId): [number, number] | null {
  const r = getSuggestions(s).find((x) => x.id === id)?.range ?? null;
  return r === null ? null : [r.start.offset, r.end.offset];
}

/** Live attrs without provenance tags. */
function live(s: Document, offset: number): ReadonlyAttrs {
  return Object.fromEntries(Object.entries(attrsAt(s, offset)).filter(([k]) => !k.startsWith("formattingSuggestionId")));
}

/** Composite ("final" preview) attrs at `offset`. */
function preview(s: Document, offset: number): ReadonlyAttrs {
  const d = s[DOCUMENT_INTERNAL].doc;
  return resolveFormattingSuggestionTags(attrsAt(s, offset), () => "accept", (id) => readSuggestionRecord(d, id));
}

/** A (alice, t=1) bold over [0,10); B (bob, t=2) italic over [5,15). */
function stackedBoldItalic(): Document {
  const s1 = markFormatting(doc(), span(0, 10), { bold: true }, { id: A, author: "alice", createdAt: 1 }).document;
  return markFormatting(s1, span(5, 15), { italic: true }, { id: B, author: "bob", createdAt: 2 }).document;
}

/** A (t=1) color red and B (t=2) color blue, both over [0,10). */
function conflictingColors(): Document {
  const s1 = markFormatting(doc(), span(0, 10), { color: "red" }, { id: A, author: "alice", createdAt: 1 }).document;
  return markFormatting(s1, span(0, 10), { color: "blue" }, { id: B, author: "bob", createdAt: 2 }).document;
}

describe("stacked formatting suggestions — creation", () => {
  it("a second suggestion over an existing one keeps BOTH ranges (the earlier one is not shrunk)", () => {
    const s = stackedBoldItalic();
    expect(rangeOf(s, A)).toEqual([0, 10]);
    expect(rangeOf(s, B)).toEqual([5, 15]);
    expect(formattingSuggestionIds(attrsAt(s, 7)).sort()).toEqual([A, B]);
    expect(live(s, 7)).toEqual({}); // live attrs untouched
    expect(preview(s, 7)).toEqual({ bold: true, italic: true });
  });

  it("the tag is not a mark: markTypeOf / getMarkRanges / the registry ignore it", () => {
    const s = stackedBoldItalic();
    const key = formattingSuggestionKey(A);
    expect(markTypeOf(key)).toBe(key);
    expect(getMarkRanges(s, "formattingSuggestionId")).toEqual([]);
    const registry = createDefaultAttrRegistry();
    expect(registry.get(key)).toBeUndefined();
    expect(registry.applyAll({ [key]: true })).toEqual({});
  });

  it("never coalesces into an id shadowed on a span character: re-applying it mints a fresh, newest suggestion", () => {
    // X (alice, red) on [0,10); W (bob, blue) on [2,4) accepted → X shadows color on [2,4);
    // then Alice re-applies red on [2,4): the before-neighbour X matches, but X is shadowed there.
    const build = (): Document => {
      let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: A, author: "alice", createdAt: 1 }).document;
      s = markFormatting(s, span(2, 4), { color: "blue" }, { id: B, author: "bob", createdAt: 2 }).document;
      s = acceptSuggestion(s, B).document;
      expect(attrsAt(s, 2)[formattingSuggestionKey(A)]).toBe('["color"]');
      return markFormatting(s, span(2, 4), { color: "red" }, { id: C, author: "alice", createdAt: 3 }).document;
    };
    const s = build();
    expect(getSuggestions(s).map((x) => x.id).sort()).toEqual([A, C]);
    expect(preview(s, 2).color).toBe("red");
    expect(live(acceptAll(s).document, 2).color).toBe("red");
    expect(live(acceptSuggestion(build(), C).document, 2).color).toBe("red");
  });

  it("a later mint with a smaller counter (reload / peer) still ranks above what it stacks on (Lamport bump)", () => {
    let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: B, author: "peer", createdAt: 5, order: 10 }).document;
    s = markFormatting(s, span(2, 4), { color: "blue" }, { id: A, author: "me", createdAt: 5, order: 2 }).document;
    const mine = getSuggestions(s).find((x) => x.id === A);
    expect(mine?.order).toBe(11);
    expect(preview(s, 2).color).toBe("blue");
    expect(nextSuggestionOrder()).toBeGreaterThan(11); // the counter moved past it
    expect(live(acceptAll(s).document, 2).color).toBe("blue");
  });

  it("a mint ranks above what it stacks on even when that has a LATER createdAt (peer clock ahead)", () => {
    let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: B, author: "peer", createdAt: 9000, order: 4 }).document;
    s = markFormatting(s, span(2, 4), { color: "blue" }, { id: A, author: "me", createdAt: 1000, order: 1 }).document;
    expect(preview(s, 2).color).toBe("blue");
    expect(live(acceptAll(s).document, 2).color).toBe("blue");
  });

  it.each([Infinity, 1e300, -3, 2.5])("a peer-written invalid order (%s) reads as absent: it cannot freeze the counter or beat a newer mint", (bad) => {
    let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: B, author: "peer", createdAt: 5, order: 3 }).document;
    const d = s[DOCUMENT_INTERNAL].doc;
    const yRecord = d.getMap("suggestions").get(B);
    if (!(yRecord instanceof Y.Map)) throw new Error("no record");
    d.transact(() => yRecord.set("order", bad));
    s = createDocument({ resolver: TEST_RESOLVER, rootId: s.rootId, doc: d });
    expect(readSuggestionRecord(d, B)?.order).toBeUndefined();
    s = markFormatting(s, span(2, 4), { color: "blue" }, { id: A, author: "me", createdAt: 5, order: nextSuggestionOrder() }).document;
    expect(preview(s, 2).color).toBe("blue");
    const n1 = nextSuggestionOrder();
    const n2 = nextSuggestionOrder();
    expect(Number.isSafeInteger(n1) && n2 > n1).toBe(true);
  });

  it("the bump is clamped to a safe integer over a maximal stacked order", () => {
    let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: B, author: "peer", createdAt: 5, order: Number.MAX_SAFE_INTEGER }).document;
    s = markFormatting(s, span(2, 4), { color: "blue" }, { id: A, author: "me", createdAt: 6, order: 1 }).document;
    expect(readSuggestionRecord(s[DOCUMENT_INTERNAL].doc, A)?.order).toBe(Number.MAX_SAFE_INTEGER);
    expect(preview(s, 2).color).toBe("blue"); // tie on order → the later createdAt
    const n = nextSuggestionOrder();
    expect(Number.isSafeInteger(n)).toBe(true);
  });

  it("an invalid input order counts as absent: the mint still bumps above what it stacks on", () => {
    for (const bad of [Number.NaN, -1, 2.5]) {
      let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: B, author: "peer", createdAt: 5, order: 3 }).document;
      s = markFormatting(s, span(2, 4), { color: "blue" }, { id: A, author: "me", createdAt: 5, order: bad }).document;
      expect(readSuggestionRecord(s[DOCUMENT_INTERNAL].doc, A)?.order).toBe(4);
      expect(preview(s, 2).color).toBe("blue");
    }
  });

  it("ties on createdAt are broken by the mint order, not the id", () => {
    for (const [first, second] of [[A, B], [B, A]] as const) {
      let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: first, author: "h", createdAt: 5, order: 1, noCoalesce: true }).document;
      s = markFormatting(s, span(2, 4), { color: "blue" }, { id: second, author: "h", createdAt: 5, order: 2, noCoalesce: true }).document;
      expect(preview(s, 2).color).toBe("blue");
      expect(live(acceptSuggestion(acceptSuggestion(s, second).document, first).document, 2).color).toBe("blue");
    }
  });

  it("does not coalesce into an older suggestion when the span holds a NEWER one (the new action stays on top)", () => {
    let s = markFormatting(doc(), span(0, 5), { color: "red" }, { id: A, author: "alice", createdAt: 1 }).document;
    s = markFormatting(s, span(5, 10), { color: "blue" }, { id: B, author: "bob", createdAt: 2 }).document;
    s = markFormatting(s, span(5, 10), { color: "red" }, { id: C, author: "alice", createdAt: 3 }).document;
    expect(getSuggestions(s).map((x) => x.id).sort()).toEqual([A, B, C]);
    expect(preview(s, 7).color).toBe("red");
  });
});

describe("stacked formatting suggestions — sequential resolution", () => {
  const cases: [string, (s: Document) => Document, ReadonlyAttrs][] = [
    ["accept A then B", (s) => acceptSuggestion(acceptSuggestion(s, A).document, B).document, { bold: true, italic: true }],
    ["accept B then A", (s) => acceptSuggestion(acceptSuggestion(s, B).document, A).document, { bold: true, italic: true }],
    ["reject A then accept B", (s) => acceptSuggestion(rejectSuggestion(s, A).document, B).document, { italic: true }],
    ["reject B then accept A", (s) => acceptSuggestion(rejectSuggestion(s, B).document, A).document, { bold: true }],
  ];
  for (const [name, run, overlap] of cases) {
    it(`${name}: each suggestion lands (or not) independently`, () => {
      const s = run(stackedBoldItalic());
      expect(live(s, 7)).toEqual(overlap);
      expect(formattingSuggestionIds(attrsAt(s, 7))).toEqual([]);
      expect(getSuggestions(s)).toEqual([]);
    });
  }

  const colorCases: [string, (s: Document) => Document, string | undefined][] = [
    ["accept A, accept B", (s) => acceptSuggestion(acceptSuggestion(s, A).document, B).document, "blue"],
    ["accept B, accept A", (s) => acceptSuggestion(acceptSuggestion(s, B).document, A).document, "blue"],
    ["accept A, reject B", (s) => rejectSuggestion(acceptSuggestion(s, A).document, B).document, "red"],
    ["reject A, accept B", (s) => acceptSuggestion(rejectSuggestion(s, A).document, B).document, "blue"],
    ["accept B, reject A", (s) => rejectSuggestion(acceptSuggestion(s, B).document, A).document, "blue"],
    ["reject B, accept A", (s) => acceptSuggestion(rejectSuggestion(s, B).document, A).document, "red"],
    ["reject both", (s) => rejectSuggestion(rejectSuggestion(s, A).document, B).document, undefined],
  ];
  for (const [name, run, color] of colorCases) {
    it(`two suggestions setting the same property — ${name} → ${String(color)}`, () => {
      const s = run(conflictingColors());
      expect(live(s, 3).color).toBe(color);
      expect(getSuggestions(s)).toEqual([]);
    });
  }

  it("accepting the newer one first shadows the key on the older one (preview stays the newer value)", () => {
    const s = acceptSuggestion(conflictingColors(), B).document;
    expect(attrsAt(s, 3)[formattingSuggestionKey(A)]).toBe('["color"]');
    expect(live(s, 3).color).toBe("blue");
    expect(preview(s, 3).color).toBe("blue");
  });

  it("three suggestions: any accept order yields the creation-order result", () => {
    const build = (): Document => {
      let s = markFormatting(doc(), span(0, 10), { color: "red" }, { id: A, author: "a", createdAt: 1 }).document;
      s = markFormatting(s, span(0, 10), { color: "blue", bold: true }, { id: B, author: "b", createdAt: 2 }).document;
      return markFormatting(s, span(0, 10), { color: "green" }, { id: C, author: "c", createdAt: 3 }).document;
    };
    expect(preview(build(), 4)).toEqual({ color: "green", bold: true });
    const orders = [[A, B, C], [A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A]];
    for (const order of orders) {
      let s = build();
      for (const id of order) {
        s = acceptSuggestion(s, id).document;
        // The preview never changes while resolving: accepted values + pending previews.
        expect(preview(s, 4)).toEqual({ color: "green", bold: true });
      }
      expect(live(s, 4)).toEqual({ color: "green", bold: true });
      expect(getSuggestions(s)).toEqual([]);
    }
    // Accept B, reject C, accept A → blue + bold (A's color shadowed by B).
    let s = acceptSuggestion(build(), B).document;
    s = rejectSuggestion(s, C).document;
    s = acceptSuggestion(s, A).document;
    expect(live(s, 4)).toEqual({ color: "blue", bold: true });
  });

  it("accept-all / group accept equal the creation-order result", () => {
    expect(live(acceptAll(conflictingColors()).document, 3).color).toBe("blue");
    expect(live(rejectAll(conflictingColors()).document, 3)).toEqual({});
    const grouped = assignSuggestionGroup(conflictingColors(), [A, B], "g", undefined).document;
    const s = acceptSuggestionGroup(grouped, "g").document;
    expect(live(s, 3).color).toBe("blue");
    expect(formattingSuggestionIds(attrsAt(s, 3))).toEqual([]);
    // Group of just A, while B (newer) stays pending: A lands, B still previews on top.
    const onlyA = acceptSuggestionGroup(assignSuggestionGroup(conflictingColors(), [A], "gA", undefined).document, "gA").document;
    expect(live(onlyA, 3).color).toBe("red");
    expect(preview(onlyA, 3).color).toBe("blue");
  });

  it("undo of each accept restores the tags and the shadowed keys exactly", () => {
    const s0 = conflictingColors();
    const history = createHistory(s0);
    history.beginEntry("command", 10);
    const r1 = acceptSuggestion(s0, B);
    history.commit(r1, { before: null, after: null });
    history.beginEntry("command", 20);
    const r2 = acceptSuggestion(r1.document, A);
    history.commit(r2, { before: null, after: null });
    expect(live(r2.document, 3).color).toBe("blue");

    const u1 = history.undo();
    if (u1 === null) throw new Error("expected undo");
    expect(attrsAt(u1.document, 3)).toEqual(attrsAt(r1.document, 3)); // A tagged with its shadow
    expect(attrsAt(u1.document, 3)[formattingSuggestionKey(A)]).toBe('["color"]');
    const u2 = history.undo();
    if (u2 === null) throw new Error("expected undo");
    expect(attrsAt(u2.document, 3)).toEqual(attrsAt(s0, 3));
    expect(getSuggestions(u2.document).map((x) => x.id).sort()).toEqual([A, B]);
    history.destroy();
  });
});

describe("stacked formatting suggestions — missing records + concurrency", () => {
  it("a tag whose record is gone is ignored by readers and stripped by the next resolve of that run", () => {
    const s0 = stackedBoldItalic();
    const d = s0[DOCUMENT_INTERNAL].doc;
    d.transact(() => {
      d.getMap("suggestions").delete(A);
    });
    const s = createDocument({ resolver: TEST_RESOLVER, rootId: s0.rootId, doc: d });
    expect(pendingFormattingSuggestions(attrsAt(s, 7), (id) => readSuggestionRecord(d, id)).map((p) => p.record.id)).toEqual([B]);
    expect(preview(s, 7)).toEqual({ italic: true });
    const r = acceptSuggestion(s, B).document;
    expect(attrsAt(r, 7)).toEqual({ italic: true });
  });

  it("concurrent accept of A and B on two peers converges with no visible suggestion left", () => {
    const s0 = conflictingColors();
    const update = Y.encodeStateAsUpdate(s0[DOCUMENT_INTERNAL].doc);
    const peer = (clientID: number): Document => {
      const d = new Y.Doc();
      d.clientID = clientID;
      Y.applyUpdate(d, update);
      return createDocument({ resolver: TEST_RESOLVER, rootId: s0.rootId, doc: d });
    };
    const p1 = acceptSuggestion(peer(101), A).document;
    const p2 = acceptSuggestion(peer(202), B).document;
    const d1 = p1[DOCUMENT_INTERNAL].doc;
    const d2 = p2[DOCUMENT_INTERNAL].doc;
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2));
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    const m1 = createDocument({ resolver: TEST_RESOLVER, rootId: s0.rootId, doc: d1 });
    const m2 = createDocument({ resolver: TEST_RESOLVER, rootId: s0.rootId, doc: d2 });
    expect(getBlock(m1, P)?.inlineContent).toEqual(getBlock(m2, P)?.inlineContent);
    expect(getSuggestions(m1)).toEqual([]);
    for (const m of [m1, m2]) {
      const d = m[DOCUMENT_INTERNAL].doc;
      expect(pendingFormattingSuggestions(attrsAt(m, 3), (id) => readSuggestionRecord(d, id))).toEqual([]);
      expect(["red", "blue"]).toContain(live(m, 3).color);
    }
  });
});

describe("formatting suggestions on visible embeds", () => {
  const withTab = (): Document =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("ab"), embed("tab"), text("cd")]) }),
      ],
    });

  it("an embed-only suggestion is reported, grouped and highlighted", () => {
    const s = markFormatting(withTab(), span(2, 3), { bold: true }, { id: A, author: "alice", createdAt: 1 }).document;
    expect(rangeOf(s, A)).toEqual([2, 3]);
    expect(getSuggestionGroups(s).map((g) => g.id)).toEqual([A]);
    expect(suggestionHighlightDecorations(s, [{ suggestionId: A, active: false }]).map((d) => [d.from.offset, d.to.offset])).toEqual([[2, 3]]);
  });

  it("a suggestion over text ending on an embed includes the embed in its range", () => {
    const s = markFormatting(withTab(), span(0, 3), { bold: true }, { id: A, author: "alice", createdAt: 1 }).document;
    expect(rangeOf(s, A)).toEqual([0, 3]);
  });
});

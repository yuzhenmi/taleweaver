/**
 * Legacy inline storage (schema 1) — detection, refusal to load, the explicit
 * single-authority `upgradeDocument`, and the peer-update guard.
 */
import { attrRegistry } from "../cascade/attr-registry";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createState, getBlock, type Document } from "./state";
import { createYDoc, getMetaMap } from "./yjs-doc";
import { upgradeDocument, inspectDocument, CURRENT_SCHEMA_VERSION, type IncompatibleDocumentReport } from "./upgrade";
import { LegacyDocumentError } from "./y-inline";
import { createHistory } from "./history";
import { insertText } from "./ops/insert-text";
import { extractText } from "./extract-text";
import { subscribeForeignChanges } from "./collab";
import { decodeFragmentClip } from "./serialize/fragment-clip";
import { bytesToBase64 } from "./serialize/base64";
import { createBinaryDocumentSerializer } from "./serialize/binary-serializer";
import { createPosition, createSpan } from "./block-position";
import { STATE_INTERNAL } from "./state-internal";
import type { BlockId } from "./block-id";
import { legacyDoc, legacyInline, LEGACY_ROOT } from "../test-utils/legacy-fixture";
import { TEST_RESOLVER, embed, text, withTestAttrs } from "../test-utils/state-builders";

const P1 = "p1" as BlockId;
const span = (id: BlockId, a: number, b: number) => createSpan(createPosition(id, a), createPosition(id, b));

describe("legacy detection + load refusal", () => {
  it("inspectDocument infers schema 1 from shape (no marker) and lists the legacy blocks", () => {
    const doc = legacyDoc([text("hi")], [text("yo")]);
    // Every block still stored in the legacy roots is listed (schema 3 converts whole trees).
    expect(inspectDocument(doc)).toEqual({ schemaVersion: 1, legacyBlocks: ["doc", "p1", "p2"] });
  });

  it("a fresh doc is born at the current schema (marker written by createYDoc)", () => {
    const doc = createYDoc({ rootId: "r" as BlockId });
    expect(getMetaMap(doc).get("schemaVersion")).toBe(CURRENT_SCHEMA_VERSION);
    expect(inspectDocument(doc)).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, legacyBlocks: [] });
  });

  it("createState on a legacy doc throws LegacyDocumentError (and never writes the marker)", () => {
    const doc = legacyDoc([text("hi")]);
    expect(() => createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc })).toThrow(LegacyDocumentError);
    expect(getMetaMap(doc).get("schemaVersion")).toBeUndefined();
  });

  it("binary decode of a legacy document throws LegacyDocumentError", () => {
    const bytes = Y.encodeStateAsUpdate(legacyDoc([text("hi")]));
    expect(() => createBinaryDocumentSerializer({ blockKindResolver: TEST_RESOLVER }).decode(bytes)).toThrow(LegacyDocumentError);
  });
});

describe("upgradeDocument", () => {
  it("converts every legacy block, drops stored nulls, re-keys the legacy formatting-suggestion attr, writes the marker; then edit + undo work", () => {
    const doc = legacyDoc(
      [text("ab", { bold: true, link: null }), embed("tab", {}, { formattingSuggestionId: "f1" }), text("cd")],
      [text("second", { formattingSuggestionId: "f2" })],
    );
    const report = upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    expect(report).toEqual({ fromVersion: 1, toVersion: CURRENT_SCHEMA_VERSION, upgradedBlocks: ["doc", "p1", "p2"], orphanedBreakSuggestions: [], unregisteredTypes: [], crossReferences: { rewritten: [], broken: [] } });
    expect(inspectDocument(doc)).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, legacyBlocks: [] });

    const s0 = createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc });
    expect(getBlock(s0, P1)?.inlineContent?.items).toEqual([
      text("ab", { bold: true }),
      embed("tab", {}, { "formattingSuggestionId:f1": true }),
      text("cd"),
    ]);
    expect(getBlock(s0, "p2" as BlockId)?.inlineContent?.items).toEqual([text("second", { "formattingSuggestionId:f2": true })]);

    const history = createHistory(s0);
    history.beginEntry("insert", 0, span(P1, 5, 5));
    const typed = insertText(s0, createPosition(P1, 5), "!", {});
    history.commit(typed, { before: span(P1, 5, 5), after: span(P1, 6, 6) });
    expect(extractText(typed.state, span(P1, 0, 6))).toContain("cd!");
    const undone = history.undo();
    expect(undone === null ? null : extractText(undone.state, span(P1, 0, 5))).not.toContain("!");
  });

  it("is idempotent and is not an undoable change", () => {
    const doc = legacyDoc([text("x")]);
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    const s = createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc });
    const history = createHistory(s);
    expect(upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER }).upgradedBlocks).toEqual([]);
    expect(history.canUndo()).toBe(false);
  });

  it("a section-less schema-2 root's page keys move onto the final section (Word: body sectPr lives on the final section)", () => {
    const doc = legacyDoc([text("x")]);
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    const rootAttrs = blocks.get("doc")?.get("attrs");
    if (!(rootAttrs instanceof Y.Map)) throw new Error("fixture root has no attrs map");
    rootAttrs.set("headerBlockId", "hdr");
    rootAttrs.set("footerBlockId", "ftr");
    rootAttrs.set("columnCount", 2);
    rootAttrs.set("columnGap", 24);
    rootAttrs.set("lang", "fr");
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    const s = createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc });
    const root = getBlock(s, LEGACY_ROOT);
    const fin = root?.lastChildId === undefined || root.lastChildId === null ? null : getBlock(s, root.lastChildId);
    expect(fin?.type).toBe("section");
    expect(fin?.attrs).toMatchObject({ headerBlockId: "hdr", footerBlockId: "ftr", columnCount: 2, columnGap: 24 });
    expect(root?.attrs).toEqual({ lang: "fr" });
  });

  it("a sectioned schema-2 root's page keys go onto every section lacking them (a section's own value wins) and leave the root", () => {
    const doc = legacyDoc([text("a")], [text("b")]);
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    doc.transact(() => {
      // doc > [ s1 > p1, s2(own header + columnCount) > p2 ]
      const section = (child: string, prev: string | null, next: string | null): Y.Map<unknown> => {
        const m = new Y.Map<unknown>();
        for (const [k, v] of Object.entries({ type: "section", parentId: "doc", prevSiblingId: prev, nextSiblingId: next, firstChildId: child, lastChildId: child, inlineContent: null })) m.set(k, v);
        m.set("attrs", new Y.Map<unknown>());
        return m;
      };
      blocks.set("s1", section("p1", null, "s2"));
      blocks.set("s2", section("p2", "s1", null));
      for (const [p, s] of [["p1", "s1"], ["p2", "s2"]] as const) {
        const b = blocks.get(p);
        b?.set("parentId", s);
        b?.set("prevSiblingId", null);
        b?.set("nextSiblingId", null);
      }
      const root = blocks.get("doc");
      root?.set("firstChildId", "s1");
      root?.set("lastChildId", "s2");
      const s2Attrs = blocks.get("s2")?.get("attrs");
      if (s2Attrs instanceof Y.Map) {
        s2Attrs.set("headerBlockId", "own");
        s2Attrs.set("columnCount", 3);
      }
      const rootAttrs = root?.get("attrs");
      if (!(rootAttrs instanceof Y.Map)) throw new Error("fixture root has no attrs map");
      rootAttrs.set("headerBlockId", "hdr");
      rootAttrs.set("footerBlockId", "ftr");
      rootAttrs.set("columnCount", 2);
      rootAttrs.set("lang", "fr");
    });
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    const s = createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc });
    expect(getBlock(s, "s1" as BlockId)?.attrs).toMatchObject({ headerBlockId: "hdr", footerBlockId: "ftr", columnCount: 2 });
    expect(getBlock(s, "s2" as BlockId)?.attrs).toMatchObject({ headerBlockId: "own", footerBlockId: "ftr", columnCount: 3 });
    expect(getBlock(s, LEGACY_ROOT)?.attrs).toEqual({ lang: "fr" });
  });

  it("rewrites each cross-reference targetId into a bookmark around the target's text (one per target); an unresolvable target → broken", () => {
    const doc = legacyDoc(
      [text("Title")],
      [embed("cross-reference", { targetId: "p1", refMode: "text" }), embed("cross-reference", { targetId: "p1", refMode: "number" })],
      [embed("cross-reference", { targetId: "gone", refMode: "text" })],
    );
    const report = upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    expect(report.crossReferences).toEqual({ rewritten: ["p2", "p2"], broken: ["p3"] });
    const s = createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc });
    const fields = getBlock(s, "p2" as BlockId)?.inlineContent?.items ?? [];
    const ids = fields.map((f) => (f.kind === "embed" ? f.properties.bookmarkId : undefined));
    const bid = ids[0];
    expect(typeof bid).toBe("string");
    expect(ids).toEqual([bid, bid]);
    expect(fields.every((f) => f.kind === "embed" && !("targetId" in f.properties))).toBe(true);
    expect(getBlock(s, P1)?.inlineContent?.items).toEqual([
      embed("bookmark-start", { bookmarkId: bid }),
      text("Title"),
      embed("bookmark-end", { bookmarkId: bid }),
    ]);
    expect(getBlock(s, "p3" as BlockId)?.inlineContent?.items).toEqual([embed("cross-reference", { refMode: "text" })]);
  });

  it("a legacy clip pastes correctly (decodeFragmentClip upgrades the private clip doc)", () => {
    const bytes = Y.encodeStateAsUpdate(legacyDoc([text("clip", { italic: true })]));
    const legacyClip = bytesToBase64(bytes); // the clip codec's base64 framing
    const decoded = decodeFragmentClip(legacyClip, TEST_RESOLVER, attrRegistry);
    expect(decoded === null ? null : getBlock(decoded, P1)?.inlineContent?.items).toEqual([text("clip", { italic: true })]);
  });
});

describe("a peer update carrying legacy storage", () => {
  function current(): Document {
    const doc = legacyDoc([text("hello")]);
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    return createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc });
  }

  /** An old client rewrites p1 in its (now frozen) legacy `blocks` root. */
  function legacyWrite(doc: Y.Doc, origin?: string): void {
    doc.transact(() => doc.getMap<Y.Map<unknown>>("blocks").get("p1")?.set("inlineContent", legacyInline([text("old")])), origin);
  }

  it("is reported to onIncompatible (with the touched block's legacy text), never as a foreign change", () => {
    const s = current();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(s[STATE_INTERNAL].doc));
    const changes: BlockId[][] = [];
    const reports: IncompatibleDocumentReport[] = [];
    subscribeForeignChanges(s, "self", (ids) => changes.push([...ids]), (r) => reports.push(r));
    legacyWrite(peer);
    Y.applyUpdate(s[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(peer));
    expect(reports).toEqual([{ reason: "legacy-write", legacyBlocks: ["p1"], legacyText: { p1: "old" } }]);
    expect(changes).toEqual([]);
  });

  it("a legacy-write halt is STICKY: not even a self transaction resumes the subscription", () => {
    const s = current();
    const doc = s[STATE_INTERNAL].doc;
    let compatible = 0;
    const changes: BlockId[][] = [];
    subscribeForeignChanges(s, "self", (ids) => changes.push([...ids]), () => {}, () => compatible++);
    legacyWrite(doc, "peer");
    doc.transact(() => doc.getMap<Y.Map<unknown>>("blocks").delete("p1"), "self");
    insertText(s, createPosition(P1, 0), "!", {});
    expect(compatible).toBe(0);
    expect(changes).toEqual([]);
  });

  it("startHalted inspects once at subscribe: an already-compatible document fires onCompatible on a microtask", async () => {
    const s = current();
    let compatible = 0;
    const first = subscribeForeignChanges(s, "self", () => {}, () => {}, () => compatible++, { startHalted: true });
    expect(compatible).toBe(0);
    await Promise.resolve();
    expect(compatible).toBe(1);
    first();
    // Unsubscribed before the microtask: dropped.
    const off = subscribeForeignChanges(s, "self", () => {}, () => {}, () => compatible++, { startHalted: true });
    off();
    await Promise.resolve();
    expect(compatible).toBe(1);
  });

  it("startHalted on a not-yet-upgraded document reports nothing until upgradeDocument, then resumes", async () => {
    const doc = new Y.Doc();
    const s = createState({ resolver: TEST_RESOLVER, rootId: LEGACY_ROOT, doc });
    // A schema-1 document arrives (e.g. synced from storage after binding).
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(legacyDoc([text("hello")])));
    let compatible = 0;
    const changes: BlockId[][] = [];
    subscribeForeignChanges(s, "self", (ids) => changes.push([...ids]), () => {}, () => compatible++, { startHalted: true });
    await Promise.resolve();
    expect(compatible).toBe(0);
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    expect(compatible).toBe(1);
  });
});

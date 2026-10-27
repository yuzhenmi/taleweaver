/**
 * Legacy inline storage (schema 1) — detection, refusal to load, the explicit
 * single-authority `upgradeDocument`, and the peer-update guard.
 */
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { createState, getBlock, type State } from "./state";
import { createYDoc, getBlocksMap, getMetaMap } from "./yjs-doc";
import { upgradeDocument, inspectDocument, CURRENT_SCHEMA_VERSION } from "./upgrade";
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
import { embed, text } from "../test-utils/state-builders";

const P1 = "p1" as BlockId;
const span = (id: BlockId, a: number, b: number) => createSpan(createPosition(id, a), createPosition(id, b));

describe("legacy detection + load refusal", () => {
  it("inspectDocument infers schema 1 from shape (no marker) and lists the legacy blocks", () => {
    const doc = legacyDoc([text("hi")], [text("yo")]);
    expect(inspectDocument(doc)).toEqual({ schemaVersion: 1, legacyBlocks: ["p1", "p2"] });
  });

  it("a fresh doc is born at the current schema (marker written by createYDoc)", () => {
    const doc = createYDoc({ rootId: "r" as BlockId });
    expect(getMetaMap(doc).get("schemaVersion")).toBe(CURRENT_SCHEMA_VERSION);
    expect(inspectDocument(doc)).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, legacyBlocks: [] });
  });

  it("createState on a legacy doc throws LegacyDocumentError (and never writes the marker)", () => {
    const doc = legacyDoc([text("hi")]);
    expect(() => createState({ rootId: LEGACY_ROOT, doc })).toThrow(LegacyDocumentError);
    expect(getMetaMap(doc).get("schemaVersion")).toBeUndefined();
  });

  it("binary decode of a legacy document throws LegacyDocumentError", () => {
    const bytes = Y.encodeStateAsUpdate(legacyDoc([text("hi")]));
    expect(() => createBinaryDocumentSerializer().decode(bytes)).toThrow(LegacyDocumentError);
  });
});

describe("upgradeDocument", () => {
  it("converts every legacy block, drops stored nulls, re-keys the legacy formatting-suggestion attr, writes the marker; then edit + undo work", () => {
    const doc = legacyDoc(
      [text("ab", { bold: true, link: null }), embed("tab", {}, { formattingSuggestionId: "f1" }), text("cd")],
      [text("second", { formattingSuggestionId: "f2" })],
    );
    const report = upgradeDocument(doc);
    expect(report).toEqual({ fromVersion: 1, toVersion: CURRENT_SCHEMA_VERSION, upgradedBlocks: ["p1", "p2"] });
    expect(inspectDocument(doc)).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, legacyBlocks: [] });

    const s0 = createState({ rootId: LEGACY_ROOT, doc });
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
    upgradeDocument(doc);
    const s = createState({ rootId: LEGACY_ROOT, doc });
    const history = createHistory(s);
    expect(upgradeDocument(doc).upgradedBlocks).toEqual([]);
    expect(history.canUndo()).toBe(false);
  });

  it("a legacy clip pastes correctly (decodeFragmentClip upgrades the private clip doc)", () => {
    const bytes = Y.encodeStateAsUpdate(legacyDoc([text("clip", { italic: true })]));
    const legacyClip = bytesToBase64(bytes); // the clip codec's base64 framing
    const decoded = decodeFragmentClip(legacyClip);
    expect(decoded === null ? null : getBlock(decoded, P1)?.inlineContent?.items).toEqual([text("clip", { italic: true })]);
  });
});

describe("a peer update carrying legacy storage", () => {
  function current(): State {
    const doc = legacyDoc([text("hello")]);
    upgradeDocument(doc);
    return createState({ rootId: LEGACY_ROOT, doc });
  }

  it("is reported to onIncompatible, never as a foreign change", () => {
    const s = current();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(s[STATE_INTERNAL].doc));
    const changes: BlockId[][] = [];
    const incompatible: BlockId[][] = [];
    subscribeForeignChanges(
      s,
      "self",
      (ids) => changes.push([...ids]),
      (ids) => incompatible.push([...ids]),
    );
    // An old client rewrites p1 with its run-array storage.
    peer.transact(() => getBlocksMap(peer).get("p1")?.set("inlineContent", legacyInline([text("old")])));
    Y.applyUpdate(s[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(peer));
    expect(incompatible).toEqual([["p1"]]);
    expect(changes).toEqual([]);
  });

  it("while halted, a SELF transaction that removes the legacy storage resumes the subscription", () => {
    const s = current();
    const doc = s[STATE_INTERNAL].doc;
    let compatible = 0;
    const changes: BlockId[][] = [];
    subscribeForeignChanges(s, "self", (ids) => changes.push([...ids]), () => {}, () => compatible++);
    doc.transact(() => getBlocksMap(doc).get("p1")?.set("inlineContent", legacyInline([text("old")])), "peer");
    // The host (single authority) rewrites the block itself, under its own origin.
    doc.transact(() => getBlocksMap(doc).get("p1")?.set("inlineContent", new Y.Text("new")), "self");
    expect(compatible).toBe(1);
    doc.transact(() => {
      const t = getBlocksMap(doc).get("p1")?.get("inlineContent");
      if (t instanceof Y.Text) t.insert(0, "!");
    }, "peer");
    expect(changes).toEqual([["p1"]]); // reporting again
  });

  it("while halted, a transaction re-checks only the known legacy blocks + the touched ones (not the document)", () => {
    const s = current();
    const doc = s[STATE_INTERNAL].doc;
    // Unrelated current-shape blocks the halted gate must not walk.
    doc.transact(() => {
      for (let i = 0; i < 50; i++) {
        const b = new Y.Map<unknown>();
        b.set("inlineContent", new Y.Text("x"));
        getBlocksMap(doc).set(`extra${i}`, b);
      }
    });
    subscribeForeignChanges(s, "self", () => {}, () => {}, () => {});
    doc.transact(() => getBlocksMap(doc).get("p1")?.set("inlineContent", legacyInline([text("old")])), "peer");
    let reads = 0;
    const get = Y.Map.prototype.get;
    const spy = vi.spyOn(Y.Map.prototype, "get").mockImplementation(function (this: Y.Map<unknown>, key: string) {
      if (key === "inlineContent") reads++;
      return get.call(this, key);
    });
    try {
      doc.transact(() => {
        const t = getBlocksMap(doc).get("extra0")?.get("inlineContent");
        if (t instanceof Y.Text) t.insert(0, "!");
      }, "peer");
    } finally {
      spy.mockRestore();
    }
    // extra0 (touched) + p1 (legacy), plus the edit's own read.
    expect(reads).toBeLessThanOrEqual(3);
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
    // Still legacy at subscribe: nothing until the storage is gone.
    const doc = s[STATE_INTERNAL].doc;
    doc.transact(() => getBlocksMap(doc).get("p1")?.set("inlineContent", legacyInline([text("old")])));
    subscribeForeignChanges(s, "self", () => {}, () => {}, () => compatible++, { startHalted: true });
    await Promise.resolve();
    expect(compatible).toBe(1);
    upgradeDocument(doc);
    expect(compatible).toBe(2);
  });

  it("a read of the uncached legacy block on the last good State throws a typed LegacyDocumentError", () => {
    const s = current(); // p1 never read → no snapshot cache entry
    const doc = s[STATE_INTERNAL].doc;
    doc.transact(() => {
      getBlocksMap(doc).get("p1")?.set("inlineContent", legacyInline([text("old")]));
    }, "peer");
    // A host that keeps reading the halted State hits the typed error on a cache miss.
    expect(() => getBlock(s, P1)).toThrow(LegacyDocumentError);
    expect(() => extractText(s, span(P1, 0, 1))).toThrow(LegacyDocumentError);
  });
});

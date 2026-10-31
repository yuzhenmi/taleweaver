/**
 * Change-tracking slice 1 — INERT state vocabulary tests.
 *
 * Covers (1) the 6th `suggestions` side-table Y.Map seeding + getter + its
 * exclusion from the block-tree getters; (2) the `SuggestionRecord` write/read
 * round-trip for all three kinds (incl. the formatting variant's
 * `proposedAttrs`); (3) the `suggestions` map as the 6th `Y.UndoManager`
 * tracked scope (a tracked write reverts; a pure text edit leaves it
 * untouched). Mirrors the comments slice-1/slice-2 tests.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createYDoc,
  getSuggestionsMap,
} from "./yjs-doc";
import { getRegistry } from "./registry";
import {
  writeSuggestionRecordInTx,
  readSuggestionRecord,
  buildSuggestionRangeIndex,
  resolveSuggestionRange,
  getSuggestions,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  formattingSuggestionKey,
  type SuggestionId,
  type SuggestionRecord,
} from "./suggestions";
import { markParagraphMarkDeletion } from "./ops/merge-blocks";
import {
  buildDocument,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/document-builders";
import { asBlockId } from "./block-id";
import { applyOperation, type Document } from "./document";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { createHistory } from "./history";
import { insertText } from "./ops/insert-text";
import { createPosition } from "./block-position";
import type { BlockId } from "./block-id";

describe("suggestions — 6th side-table Y.Map (slice 1.1)", () => {
  it("createYDoc seeds an empty `suggestions` map and getSuggestionsMap returns it", () => {
    const doc = createYDoc();
    const map = getSuggestionsMap(doc);
    expect(map).toBeInstanceOf(Y.Map);
    expect(map.size).toBe(0);
  });

  it("getSuggestionsMap is stable (same Y.Map instance across calls)", () => {
    const doc = createYDoc();
    expect(getSuggestionsMap(doc)).toBe(getSuggestionsMap(doc));
  });

  it("the suggestions map is NOT the block registry (side-tables are not block trees)", () => {
    const doc = createYDoc();
    expect(getSuggestionsMap(doc)).not.toBe(getRegistry(doc));
  });
});

describe("suggestions — record write/read round-trip (slice 1.2)", () => {
  function roundTrip(record: SuggestionRecord): SuggestionRecord | null {
    const doc = createYDoc();
    doc.transact(() => {
      writeSuggestionRecordInTx(doc, record);
    });
    return readSuggestionRecord(doc, record.id);
  }

  it("round-trips an insertion record (scalar fields only)", () => {
    const record: SuggestionRecord = {
      id: "s-ins" as SuggestionId,
      kind: "insertion",
      author: "alice",
      createdAt: 1000,
    };
    expect(roundTrip(record)).toEqual(record);
  });

  it("round-trips a deletion record (scalar fields only)", () => {
    const record: SuggestionRecord = {
      id: "s-del" as SuggestionId,
      kind: "deletion",
      author: "bob",
      createdAt: 2000,
    };
    expect(roundTrip(record)).toEqual(record);
  });

  it("round-trips a formatting record including proposedAttrs (nested attrs Y.Map)", () => {
    const record: SuggestionRecord = {
      id: "s-fmt" as SuggestionId,
      kind: "formatting",
      author: "carol",
      createdAt: 3000,
      proposedAttrs: { bold: true, color: "#f00", fontSize: 14 },
    };
    const read = roundTrip(record);
    expect(read).not.toBeNull();
    expect(read?.proposedAttrs).toEqual({ bold: true, color: "#f00", fontSize: 14 });
    // The whole record (incl. kind/author/createdAt) round-trips.
    expect(read).toEqual(record);
  });

  it("readSuggestionRecord returns null for an absent id", () => {
    const doc = createYDoc();
    expect(readSuggestionRecord(doc, "missing" as SuggestionId)).toBeNull();
  });

  it("writeSuggestionRecordInTx throws when not inside a transaction", () => {
    const doc = createYDoc();
    expect(() =>
      writeSuggestionRecordInTx(doc, {
        id: "s-x" as SuggestionId,
        kind: "insertion",
        author: "a",
        createdAt: 0,
      }),
    ).toThrow(/transact/);
  });
});

describe("suggestions — 6th Y.UndoManager tracked scope (slice 1.4)", () => {
  const ROOT = asBlockId("doc");
  const PARA = asBlockId("p");

  function freshDoc(): Document {
    return buildDocument({
      rootId: ROOT,
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
  }

  it("a tracked write to the suggestions map is reverted by History.undo", () => {
    const s0 = freshDoc();
    const history = createHistory(s0);
    const record: SuggestionRecord = {
      id: "s-1" as SuggestionId,
      kind: "insertion",
      author: "alice",
      createdAt: 42,
    };
    // Side-table-only write: surface state.rootId as the dirtyId (the comments /
    // listDefs precedent) so the op advances state and lands a tracked,
    // undoable entry.
    history.beginEntry("command", 0);
    const written = applyOperation(s0, (doc) => {
      writeSuggestionRecordInTx(doc, record);
      return new Set<BlockId>([s0.rootId]);
    });
    history.commit(written, { before: null, after: null });

    const docAfterWrite = written.document[DOCUMENT_INTERNAL].doc;
    expect(getSuggestionsMap(docAfterWrite).size).toBe(1);
    expect(readSuggestionRecord(docAfterWrite, record.id)).toEqual(record);

    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const docAfterUndo = undone.document[DOCUMENT_INTERNAL].doc;
    expect(getSuggestionsMap(docAfterUndo).size).toBe(0);
    expect(readSuggestionRecord(docAfterUndo, record.id)).toBeNull();
  });

  it("undo of a pure text edit does NOT touch the suggestions map (per-transaction tracking)", () => {
    const s0 = freshDoc();
    const history = createHistory(s0);
    const record: SuggestionRecord = {
      id: "s-2" as SuggestionId,
      kind: "deletion",
      author: "bob",
      createdAt: 7,
    };
    // First: write a suggestion record + commit (its own undo entry).
    history.beginEntry("command", 0);
    const written = applyOperation(s0, (doc) => {
      writeSuggestionRecordInTx(doc, record);
      return new Set<BlockId>([s0.rootId]);
    });
    history.commit(written, { before: null, after: null });

    // Then: a pure text edit (insert "X" at offset 0) + commit — a SEPARATE
    // undo entry (beginEntry closes the prior group) whose transaction never
    // touches the suggestions map.
    history.beginEntry("insert", 10_000);
    const typed = insertText(written.document, createPosition(PARA, 0), "X", {});
    history.commit(typed, { before: null, after: null });

    // Undo the text edit: the suggestion record must SURVIVE.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const docAfterUndo = undone.document[DOCUMENT_INTERNAL].doc;
    expect(getSuggestionsMap(docAfterUndo).size).toBe(1);
    expect(readSuggestionRecord(docAfterUndo, record.id)).toEqual(record);
  });
});

describe("suggestions — range index + read (slice 2 piece A)", () => {
  /**
   * doc > [ p("AB" tagged s1, "C") ] — the first text item carries the
   * insertion suggestion id `s1`, the second is untagged.
   */
  function oneTaggedRun(): Document {
    return buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("AB", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
            text("C"),
          ]),
        }),
      ],
    });
  }

  it("buildSuggestionRangeIndex resolves a tagged run's [start, end-after] span", () => {
    const document = oneTaggedRun();
    const index = buildSuggestionRangeIndex(document);
    const range = index.get("s1" as SuggestionId);
    expect(range).toBeDefined();
    // "AB" occupies offsets [0,2); range start = offset 0, end = offset 2.
    expect(range?.start).toEqual(createPosition(asBlockId("p"), 0));
    expect(range?.end).toEqual(createPosition(asBlockId("p"), 2));
  });

  it("resolveSuggestionRange returns the single id's range, null for an unknown id", () => {
    const document = oneTaggedRun();
    const range = resolveSuggestionRange(document, "s1" as SuggestionId);
    expect(range?.start).toEqual(createPosition(asBlockId("p"), 0));
    expect(range?.end).toEqual(createPosition(asBlockId("p"), 2));
    expect(resolveSuggestionRange(document, "nope" as SuggestionId)).toBeNull();
  });

  it("indexes all three attr dimensions + a paragraph-join boundary tag", () => {
    // p1: "X"(del s-del) "Y"(fmt s-fmt) ; p2: "Z"(ins s-ins), tagged with join s-join
    const base = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p2",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([
            text("X", { [DELETION_SUGGESTION_ATTR]: "s-del" }),
            text("Y", { [formattingSuggestionKey("s-fmt" as SuggestionId)]: true }),
          ]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([
            text("Z", { [INSERTION_SUGGESTION_ATTR]: "s-ins" }),
          ]),
        }),
      ],
    });
    const document = markParagraphMarkDeletion(base, asBlockId("p1"), {
      id: "s-join" as SuggestionId,
      author: "alice",
      createdAt: 1,
    }).document;
    const index = buildSuggestionRangeIndex(document);

    expect(index.get("s-del" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p1"), 0),
      end: createPosition(asBlockId("p1"), 1),
    });
    expect(index.get("s-fmt" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p1"), 1),
      end: createPosition(asBlockId("p1"), 2),
    });
    // The join boundary runs from the end of p1 to the start of p2.
    expect(index.get("s-join" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p1"), 2),
      end: createPosition(asBlockId("p2"), 0),
    });
    expect(index.get("s-ins" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p2"), 0),
      end: createPosition(asBlockId("p2"), 1),
    });
  });

  it("a cross-block insertion (same id on text in two blocks) spans both blocks", () => {
    // Same id `s1` tags "AB" in p1 and "CD" in p2 — the range runs from p1:0
    // to p2:2 (after the last tagged item in document order).
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p2",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([
            text("AB", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
          ]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([
            text("CD", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
          ]),
        }),
      ],
    });
    const range = resolveSuggestionRange(document, "s1" as SuggestionId);
    expect(range?.start).toEqual(createPosition(asBlockId("p1"), 0));
    expect(range?.end).toEqual(createPosition(asBlockId("p2"), 2));
  });

  it("MT-2: resolves a suggestion tagged in an embed (footnote) body, main-tree unaffected", () => {
    // The range index walks ALL THREE trees: a deletion suggestion tagged in a
    // footnote-body block (`embedContents`) must resolve to that body block's
    // span — pre-MT-2 the scan only visited the main tree and returned null.
    // A main-tree suggestion in the SAME doc still resolves unchanged.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("M", { [INSERTION_SUGGESTION_ATTR]: "s-main" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "body-container", firstChildId: "fnp", lastChildId: "fnp" }),
        buildBlock({
          id: "fnp",
          type: "paragraph",
          parentId: "fn",
          inlineContent: inlineContent([
            text("BODY", { [DELETION_SUGGESTION_ATTR]: "s-body" }),
          ]),
        }),
      ],
    });

    const bodyRange = resolveSuggestionRange(document, "s-body" as SuggestionId);
    expect(bodyRange?.start).toEqual(createPosition(asBlockId("fnp"), 0));
    expect(bodyRange?.end).toEqual(createPosition(asBlockId("fnp"), 4));

    const mainRange = resolveSuggestionRange(document, "s-main" as SuggestionId);
    expect(mainRange?.start).toEqual(createPosition(asBlockId("p"), 0));
    expect(mainRange?.end).toEqual(createPosition(asBlockId("p"), 1));
  });

  it("getSuggestions joins records with their ranges and never surfaces a rangeless record", () => {
    const liveRecord: SuggestionRecord = {
      id: "s1" as SuggestionId,
      kind: "insertion",
      author: "alice",
      createdAt: 1,
    };
    const orphanRecord: SuggestionRecord = {
      id: "s-orphan" as SuggestionId,
      kind: "deletion",
      author: "bob",
      createdAt: 2,
    };
    // Tag p with `s1` only; `s-orphan` tags nothing.
    let document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("AB", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
          ]),
        }),
      ],
    });
    document = applyOperation(document, (doc) => {
      writeSuggestionRecordInTx(doc, liveRecord);
      writeSuggestionRecordInTx(doc, orphanRecord);
      return new Set<BlockId>([document.rootId]);
    }).document;

    const resolved = getSuggestions(document);
    const byId = new Map(resolved.map((r) => [r.id, r]));

    const live = byId.get("s1" as SuggestionId);
    expect(live).toBeDefined();
    expect(live?.kind).toBe("insertion");
    expect(live?.range).toEqual({
      start: createPosition(asBlockId("p"), 0),
      end: createPosition(asBlockId("p"), 2),
    });

    expect(byId.has("s-orphan" as SuggestionId)).toBe(false);
  });

  it("a record tagging NO item has no range and is not surfaced", () => {
    const record: SuggestionRecord = {
      id: "s-lonely" as SuggestionId,
      kind: "formatting",
      author: "carol",
      createdAt: 9,
      proposedAttrs: { bold: true },
    };
    let document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("plain")]),
        }),
      ],
    });
    document = applyOperation(document, (doc) => {
      writeSuggestionRecordInTx(doc, record);
      return new Set<BlockId>([document.rootId]);
    }).document;

    expect(resolveSuggestionRange(document, record.id)).toBeNull();
    expect(getSuggestions(document)).toEqual([]);
  });
});

// A non-null transaction origin opts a change out of undo tracking (the generic
// applyOperation hook; suggestion resolution no longer uses it — it is undoable).
const UNTRACKED_ORIGIN = Symbol("untracked");

describe("suggestions — applyOperation origin opt-out (non-null origin is not tracked)", () => {
  const ROOT = asBlockId("doc");
  const PARA = asBlockId("p");

  function freshDoc(): Document {
    return buildDocument({
      rootId: ROOT,
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
  }

  it("an op run WITH the resolve origin produces the same dirtyIds/new state as WITHOUT", () => {
    const record: SuggestionRecord = {
      id: "s-origin" as SuggestionId,
      kind: "insertion",
      author: "alice",
      createdAt: 1,
    };
    const writeFn = (doc: Y.Doc): Set<BlockId> => {
      writeSuggestionRecordInTx(doc, record);
      return new Set<BlockId>([ROOT]);
    };

    const withoutOrigin = applyOperation(freshDoc(), writeFn);
    const withOrigin = applyOperation(freshDoc(), writeFn, {
      origin: UNTRACKED_ORIGIN,
    });

    // Same dirtyIds.
    expect([...withOrigin.dirtyIds]).toEqual([...withoutOrigin.dirtyIds]);
    // Same record landed in each doc.
    expect(
      readSuggestionRecord(withOrigin.document[DOCUMENT_INTERNAL].doc, record.id),
    ).toEqual(record);
    expect(
      readSuggestionRecord(withoutOrigin.document[DOCUMENT_INTERNAL].doc, record.id),
    ).toEqual(record);
  });

  it("a write under UNTRACKED_ORIGIN is NOT tracked by History.undo", () => {
    const s0 = freshDoc();
    const history = createHistory(s0);

    // A normal tracked edit (insert "X" at offset 0) — this IS undoable.
    history.beginEntry("insert", 0);
    const typed = insertText(s0, createPosition(PARA, 0), "X", {});
    history.commit(typed, { before: null, after: null });

    // A write under the resolve origin — must NOT be tracked. Advance the
    // History's cached currentDocument (piece C) since this txn skips `commit`.
    const record: SuggestionRecord = {
      id: "s-resolve" as SuggestionId,
      kind: "deletion",
      author: "bob",
      createdAt: 5,
    };
    const resolved = applyOperation(
      typed.document,
      (doc) => {
        writeSuggestionRecordInTx(doc, record);
        return new Set<BlockId>([ROOT]);
      },
      { origin: UNTRACKED_ORIGIN },
    );
    history.advanceDocument(resolved.document);

    const docAfterResolve = resolved.document[DOCUMENT_INTERNAL].doc;
    expect(getSuggestionsMap(docAfterResolve).size).toBe(1);

    // Undo: reverts ONLY the tracked "X" insert, NOT the resolve-origin write.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const docAfterUndo = undone.document[DOCUMENT_INTERNAL].doc;
    // The suggestion record survives the undo (the resolve was non-undoable).
    expect(getSuggestionsMap(docAfterUndo).size).toBe(1);
    expect(readSuggestionRecord(docAfterUndo, record.id)).toEqual(record);
    // And there is nothing more to undo (the resolve never created an entry).
    expect(history.canUndo()).toBe(false);
  });
});

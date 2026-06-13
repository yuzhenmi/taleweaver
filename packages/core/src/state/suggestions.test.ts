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
  getBlocksMap,
  getEmbedContentsMap,
  getTemplateContentsMap,
  getTreeMaps,
} from "./yjs-doc";
import {
  writeSuggestionRecordInTx,
  readSuggestionRecord,
  buildSuggestionRangeIndex,
  resolveSuggestionRange,
  getSuggestions,
  SUGGESTION_RESOLVE_ORIGIN,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  type SuggestionId,
  type SuggestionRecord,
} from "./suggestions";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "../test-utils/state-builders";
import { asBlockId } from "./block-id";
import { applyOperation, type State } from "./state";
import { STATE_INTERNAL } from "./state-internal";
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

  it("the suggestions map is NOT one of the block-tree maps (excluded from TREE_MAP_GETTERS)", () => {
    const doc = createYDoc();
    const suggestions = getSuggestionsMap(doc);
    const treeMaps = getTreeMaps(doc);
    // The block-tree maps are exactly blocks / embedContents / templateContents.
    expect(treeMaps).toContain(getBlocksMap(doc));
    expect(treeMaps).toContain(getEmbedContentsMap(doc));
    expect(treeMaps).toContain(getTemplateContentsMap(doc));
    // The suggestions side-table must NOT be among them (mirror the comments /
    // listDefs exclusion — side-tables are not block trees).
    expect(treeMaps).not.toContain(suggestions);
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

  function freshDoc(): State {
    return buildState({
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

    const docAfterWrite = written.state[STATE_INTERNAL].doc;
    expect(getSuggestionsMap(docAfterWrite).size).toBe(1);
    expect(readSuggestionRecord(docAfterWrite, record.id)).toEqual(record);

    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const docAfterUndo = undone.state[STATE_INTERNAL].doc;
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
    const typed = insertText(written.state, createPosition(PARA, 0), "X", {});
    history.commit(typed, { before: null, after: null });

    // Undo the text edit: the suggestion record must SURVIVE.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const docAfterUndo = undone.state[STATE_INTERNAL].doc;
    expect(getSuggestionsMap(docAfterUndo).size).toBe(1);
    expect(readSuggestionRecord(docAfterUndo, record.id)).toEqual(record);
  });
});

describe("suggestions — range index + read (slice 2 piece A)", () => {
  /**
   * doc > [ p("AB" tagged s1, "C") ] — the first text item carries the
   * insertion suggestion id `s1`, the second is untagged.
   */
  function oneTaggedRun(): State {
    return buildState({
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
    const state = oneTaggedRun();
    const index = buildSuggestionRangeIndex(state);
    const range = index.get("s1" as SuggestionId);
    expect(range).toBeDefined();
    // "AB" occupies offsets [0,2); range start = offset 0, end = offset 2.
    expect(range?.start).toEqual(createPosition(asBlockId("p"), 0));
    expect(range?.end).toEqual(createPosition(asBlockId("p"), 2));
  });

  it("resolveSuggestionRange returns the single id's range, null for an unknown id", () => {
    const state = oneTaggedRun();
    const range = resolveSuggestionRange(state, "s1" as SuggestionId);
    expect(range?.start).toEqual(createPosition(asBlockId("p"), 0));
    expect(range?.end).toEqual(createPosition(asBlockId("p"), 2));
    expect(resolveSuggestionRange(state, "nope" as SuggestionId)).toBeNull();
  });

  it("indexes all three attr dimensions + a break-suggestion embed by its properties.suggestionId", () => {
    // p1: "X"(del s-del) "Y"(fmt s-fmt) [block-join-suggestion s-join] ; p2: "Z"(ins s-ins)
    const state = buildState({
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
            text("Y", { [FORMATTING_SUGGESTION_ATTR]: "s-fmt" }),
            embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: "s-join" }),
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
    const index = buildSuggestionRangeIndex(state);

    expect(index.get("s-del" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p1"), 0),
      end: createPosition(asBlockId("p1"), 1),
    });
    expect(index.get("s-fmt" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p1"), 1),
      end: createPosition(asBlockId("p1"), 2),
    });
    // The join embed sits at offset 2 (after "X","Y"), occupying [2,3).
    expect(index.get("s-join" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p1"), 2),
      end: createPosition(asBlockId("p1"), 3),
    });
    expect(index.get("s-ins" as SuggestionId)).toEqual({
      start: createPosition(asBlockId("p2"), 0),
      end: createPosition(asBlockId("p2"), 1),
    });
  });

  it("a cross-block insertion (same id on text in two blocks) spans both blocks", () => {
    // Same id `s1` tags "AB" in p1 and "CD" in p2 — the range runs from p1:0
    // to p2:2 (after the last tagged item in document order).
    const state = buildState({
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
    const range = resolveSuggestionRange(state, "s1" as SuggestionId);
    expect(range?.start).toEqual(createPosition(asBlockId("p1"), 0));
    expect(range?.end).toEqual(createPosition(asBlockId("p2"), 2));
  });

  it("MT-2: resolves a suggestion tagged in an embed (footnote) body, main-tree unaffected", () => {
    // The range index walks ALL THREE trees: a deletion suggestion tagged in a
    // footnote-body block (`embedContents`) must resolve to that body block's
    // span — pre-MT-2 the scan only visited the main tree and returned null.
    // A main-tree suggestion in the SAME doc still resolves unchanged.
    const state = buildState({
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

    const bodyRange = resolveSuggestionRange(state, "s-body" as SuggestionId);
    expect(bodyRange?.start).toEqual(createPosition(asBlockId("fnp"), 0));
    expect(bodyRange?.end).toEqual(createPosition(asBlockId("fnp"), 4));

    const mainRange = resolveSuggestionRange(state, "s-main" as SuggestionId);
    expect(mainRange?.start).toEqual(createPosition(asBlockId("p"), 0));
    expect(mainRange?.end).toEqual(createPosition(asBlockId("p"), 1));
  });

  it("getSuggestions joins records with their ranges and flags orphaned-by-absence", () => {
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
    let state = buildState({
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
    state = applyOperation(state, (doc) => {
      writeSuggestionRecordInTx(doc, liveRecord);
      writeSuggestionRecordInTx(doc, orphanRecord);
      return new Set<BlockId>([state.rootId]);
    }).state;

    const resolved = getSuggestions(state);
    const byId = new Map(resolved.map((r) => [r.id, r]));

    const live = byId.get("s1" as SuggestionId);
    expect(live).toBeDefined();
    expect(live?.orphaned).toBe(false);
    expect(live?.kind).toBe("insertion");
    expect(live?.range).toEqual({
      start: createPosition(asBlockId("p"), 0),
      end: createPosition(asBlockId("p"), 2),
    });

    const orphan = byId.get("s-orphan" as SuggestionId);
    expect(orphan).toBeDefined();
    expect(orphan?.orphaned).toBe(true);
    expect(orphan?.range).toBeNull();
    expect(orphan?.kind).toBe("deletion");
  });

  it("a record tagging NO item resolves to orphaned:true, range:null", () => {
    const record: SuggestionRecord = {
      id: "s-lonely" as SuggestionId,
      kind: "formatting",
      author: "carol",
      createdAt: 9,
      proposedAttrs: { bold: true },
    };
    let state = buildState({
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
    state = applyOperation(state, (doc) => {
      writeSuggestionRecordInTx(doc, record);
      return new Set<BlockId>([state.rootId]);
    }).state;

    expect(resolveSuggestionRange(state, record.id)).toBeNull();
    const [only] = getSuggestions(state);
    expect(only?.id).toBe("s-lonely");
    expect(only?.orphaned).toBe(true);
    expect(only?.range).toBeNull();
    expect(only?.proposedAttrs).toEqual({ bold: true });
  });
});

describe("suggestions — SUGGESTION_RESOLVE_ORIGIN non-undoable hook (slice 2 piece B)", () => {
  const ROOT = asBlockId("doc");
  const PARA = asBlockId("p");

  function freshDoc(): State {
    return buildState({
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
      origin: SUGGESTION_RESOLVE_ORIGIN,
    });

    // Same dirtyIds.
    expect([...withOrigin.dirtyIds]).toEqual([...withoutOrigin.dirtyIds]);
    // Same record landed in each doc.
    expect(
      readSuggestionRecord(withOrigin.state[STATE_INTERNAL].doc, record.id),
    ).toEqual(record);
    expect(
      readSuggestionRecord(withoutOrigin.state[STATE_INTERNAL].doc, record.id),
    ).toEqual(record);
  });

  it("a write under SUGGESTION_RESOLVE_ORIGIN is NOT tracked by History.undo", () => {
    const s0 = freshDoc();
    const history = createHistory(s0);

    // A normal tracked edit (insert "X" at offset 0) — this IS undoable.
    history.beginEntry("insert", 0);
    const typed = insertText(s0, createPosition(PARA, 0), "X", {});
    history.commit(typed, { before: null, after: null });

    // A write under the resolve origin — must NOT be tracked. Advance the
    // History's cached currentState (piece C) since this txn skips `commit`.
    const record: SuggestionRecord = {
      id: "s-resolve" as SuggestionId,
      kind: "deletion",
      author: "bob",
      createdAt: 5,
    };
    const resolved = applyOperation(
      typed.state,
      (doc) => {
        writeSuggestionRecordInTx(doc, record);
        return new Set<BlockId>([ROOT]);
      },
      { origin: SUGGESTION_RESOLVE_ORIGIN },
    );
    history.advanceState(resolved.state);

    const docAfterResolve = resolved.state[STATE_INTERNAL].doc;
    expect(getSuggestionsMap(docAfterResolve).size).toBe(1);

    // Undo: reverts ONLY the tracked "X" insert, NOT the resolve-origin write.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const docAfterUndo = undone.state[STATE_INTERNAL].doc;
    // The suggestion record survives the undo (the resolve was non-undoable).
    expect(getSuggestionsMap(docAfterUndo).size).toBe(1);
    expect(readSuggestionRecord(docAfterUndo, record.id)).toEqual(record);
    // And there is nothing more to undo (the resolve never created an entry).
    expect(history.canUndo()).toBe(false);
  });
});

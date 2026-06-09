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
  type SuggestionId,
  type SuggestionRecord,
} from "./suggestions";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
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

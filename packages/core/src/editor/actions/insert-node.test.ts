/**
 * T31 — `BlockInit` is the public input shape for INSERT_NODE.
 *
 * INSERT_NODE accepts a structured `BlockInit` whose shape mirrors `Block`
 * minus structural pointers (parent/prev/next/firstChild/lastChild — those
 * are derived by `insertBlock` from the insertion site).
 *
 * Per the block-kind classification:
 *   - inline-bearing-leaf (paragraph, heading, list-item) carries
 *     `inlineContent` directly; `children` is undefined / empty.
 *   - atomic-leaf (image, horizontal-line) carries neither.
 *   - container (document, list, table, table-row, table-cell, etc.)
 *     carries `children: BlockInit[]`; `inlineContent` is omitted.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId, State, BlockInit } from "../../state";

function lastChildOf(state: State, parentId: BlockId): BlockId {
  const parent = getBlock(state, parentId);
  if (parent === null) throw new Error(`lastChildOf: parent "${parentId}" not found`);
  const id = parent.lastChildId;
  if (id === null) throw new Error(`lastChildOf: parent "${parentId}" has no lastChild`);
  return id;
}

describe("handleInsertNode — BlockInit shape (T31)", () => {
  it("inserts an inline-bearing-leaf paragraph with inlineContent items", () => {
    const initial = createInitialEditorState(config);
    const root = getBlock(initial.state, initial.state.rootId);
    const beforeLastId = root?.lastChildId ?? null;

    const init: BlockInit = {
      type: "paragraph",
      attrs: {},
      inlineContent: {
        items: [
          {
            kind: "text",
            text: "hello",
            attrs: { bold: true },
          },
        ],
      },
    };

    const next = reduceEditor(
      initial,
      { type: "INSERT_NODE", node: init },
      config,
    );

    const newId = lastChildOf(next.state, next.state.rootId);
    expect(newId).not.toBe(beforeLastId);
    const inserted = getBlock(next.state, newId);
    expect(inserted?.type).toBe("paragraph");
    expect(inserted?.inlineContent?.items.length).toBe(1);
    const first = inserted?.inlineContent?.items[0];
    expect(first?.kind).toBe("text");
    if (first?.kind === "text") {
      expect(first.text).toBe("hello");
      expect(first.attrs).toEqual({ bold: true });
    }
  });

  it("inserts a list-item with inlineContent and block-level attrs", () => {
    const initial = createInitialEditorState(config);

    const init: BlockInit = {
      type: "list-item",
      attrs: { listType: "unordered" },
      inlineContent: {
        items: [{ kind: "text", text: "item", attrs: {} }],
      },
    };

    const next = reduceEditor(
      initial,
      { type: "INSERT_NODE", node: init },
      config,
    );

    const newId = lastChildOf(next.state, next.state.rootId);
    const inserted = getBlock(next.state, newId);
    expect(inserted?.type).toBe("list-item");
    expect(inserted?.attrs).toEqual({ listType: "unordered" });
    expect(inserted?.inlineContent?.items.length).toBe(1);
  });

  it("inserts an atomic-leaf image with no inlineContent", () => {
    const initial = createInitialEditorState(config);

    const init: BlockInit = {
      type: "image",
      attrs: { src: "x.png" },
    };

    const next = reduceEditor(
      initial,
      { type: "INSERT_NODE", node: init },
      config,
    );

    const newId = lastChildOf(next.state, next.state.rootId);
    const inserted = getBlock(next.state, newId);
    expect(inserted?.type).toBe("image");
    expect(inserted?.attrs).toEqual({ src: "x.png" });
    expect(inserted?.inlineContent).toBeNull();
    expect(inserted?.firstChildId).toBeNull();
  });

  it("inserts a container with recursive children (table with table-row child)", () => {
    const initial = createInitialEditorState(config);

    const init: BlockInit = {
      type: "table",
      children: [
        {
          type: "table-row",
          children: [
            {
              type: "table-cell",
              children: [
                {
                  type: "paragraph",
                  inlineContent: { items: [{ kind: "text", text: "a", attrs: {} }] },
                },
              ],
            },
          ],
        },
      ],
    };

    const next = reduceEditor(
      initial,
      { type: "INSERT_NODE", node: init },
      config,
    );

    const tableId = lastChildOf(next.state, next.state.rootId);
    const table = getBlock(next.state, tableId);
    expect(table?.type).toBe("table");
    expect(table?.inlineContent).toBeNull();

    const rowId = lastChildOf(next.state, tableId);
    const row = getBlock(next.state, rowId);
    expect(row?.type).toBe("table-row");
    expect(row?.parentId).toBe(tableId);

    const cellId = lastChildOf(next.state, rowId);
    const cell = getBlock(next.state, cellId);
    expect(cell?.type).toBe("table-cell");

    const paraId = lastChildOf(next.state, cellId);
    const para = getBlock(next.state, paraId);
    expect(para?.type).toBe("paragraph");
    expect(para?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });
  });

  it("throws when an inline-bearing-leaf BlockInit carries children", () => {
    const initial = createInitialEditorState(config);

    const init: BlockInit = {
      type: "paragraph",
      inlineContent: { items: [] },
      // Wrong shape: inline-bearing-leaves don't have block children.
      children: [{ type: "paragraph", inlineContent: { items: [] } }],
    };

    expect(() =>
      reduceEditor(initial, { type: "INSERT_NODE", node: init }, config),
    ).toThrow();
  });

  it("throws when an atomic-leaf BlockInit carries inlineContent or children", () => {
    const initial = createInitialEditorState(config);

    const initWithInline: BlockInit = {
      type: "image",
      inlineContent: { items: [{ kind: "text", text: "x", attrs: {} }] },
    };
    expect(() =>
      reduceEditor(
        initial,
        { type: "INSERT_NODE", node: initWithInline },
        config,
      ),
    ).toThrow();

    const initWithChildren: BlockInit = {
      type: "image",
      children: [{ type: "paragraph", inlineContent: { items: [] } }],
    };
    expect(() =>
      reduceEditor(
        initial,
        { type: "INSERT_NODE", node: initWithChildren },
        config,
      ),
    ).toThrow();
  });
});

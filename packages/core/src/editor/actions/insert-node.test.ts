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
import { finalSectionOf } from "../../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import {
  config,
  createEditor
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId, Document, BlockInit } from "../../state";

function lastChildOf(document: Document, parentId: BlockId): BlockId {
  const parent = getBlock(document, parentId);
  if (parent === null) throw new Error(`lastChildOf: parent "${parentId}" not found`);
  const id = parent.lastChildId;
  if (id === null) throw new Error(`lastChildOf: parent "${parentId}" has no lastChild`);
  return id;
}

describe("handleInsertNode — BlockInit shape (T31)", () => {
  it("inserts an inline-bearing-leaf paragraph with inlineContent items", () => {
    const initial = createEditor(config);
    const root = getBlock(initial.document, finalSectionOf(initial.document)); // the root holds sections
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

    initial.dispatch({ type: "INSERT_NODE", node: init });

    const newId = lastChildOf(initial.document, finalSectionOf(initial.document));
    expect(newId).not.toBe(beforeLastId);
    const inserted = getBlock(initial.document, newId);
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
    const initial = createEditor(config);

    const init: BlockInit = {
      type: "list-item",
      attrs: { listType: "unordered" },
      inlineContent: {
        items: [{ kind: "text", text: "item", attrs: {} }],
      },
    };

    initial.dispatch({ type: "INSERT_NODE", node: init });

    const newId = lastChildOf(initial.document, finalSectionOf(initial.document));
    const inserted = getBlock(initial.document, newId);
    expect(inserted?.type).toBe("list-item");
    expect(inserted?.attrs).toEqual({ listType: "unordered" });
    expect(inserted?.inlineContent?.items.length).toBe(1);
  });

  it("inserts an atomic-leaf image with no inlineContent", () => {
    const initial = createEditor(config);

    const init: BlockInit = {
      type: "image",
      attrs: { src: "x.png" },
    };

    initial.dispatch({ type: "INSERT_NODE", node: init });

    // Invariant I: a paragraph always follows an object, so the image is
    // the block before the body's last (empty) paragraph.
    const trailing = getBlock(initial.document, lastChildOf(initial.document, finalSectionOf(initial.document)));
    expect(trailing?.type).toBe("paragraph");
    const newId = trailing?.prevSiblingId as BlockId;
    const inserted = getBlock(initial.document, newId);
    expect(inserted?.type).toBe("image");
    expect(inserted?.attrs).toEqual({ src: "x.png" });
    expect(inserted?.inlineContent).toBeNull();
    expect(inserted?.firstChildId).toBeNull();
  });

  it("inserts a container with recursive children (table with table-row child)", () => {
    const initial = createEditor(config);

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

    initial.dispatch({ type: "INSERT_NODE", node: init });

    // A paragraph always follows a table (invariant I).
    const tableId = getBlock(initial.document, lastChildOf(initial.document, finalSectionOf(initial.document)))?.prevSiblingId as BlockId;
    const table = getBlock(initial.document, tableId);
    expect(table?.type).toBe("table");
    expect(table?.inlineContent).toBeNull();

    const rowId = lastChildOf(initial.document, tableId);
    const row = getBlock(initial.document, rowId);
    expect(row?.type).toBe("table-row");
    expect(row?.parentId).toBe(tableId);

    const cellId = lastChildOf(initial.document, rowId);
    const cell = getBlock(initial.document, cellId);
    expect(cell?.type).toBe("table-cell");

    const paraId = lastChildOf(initial.document, cellId);
    const para = getBlock(initial.document, paraId);
    expect(para?.type).toBe("paragraph");
    expect(para?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "a" });
  });

  it("throws when an inline-bearing-leaf BlockInit carries children", () => {
    const initial = createEditor(config);

    const init: BlockInit = {
      type: "paragraph",
      inlineContent: { items: [] },
      // Wrong shape: inline-bearing-leaves don't have block children.
      children: [{ type: "paragraph", inlineContent: { items: [] } }],
    };

    expect(() =>
      { initial.dispatch({ type: "INSERT_NODE", node: init }); return initial; },
    ).toThrow();
  });

  it("throws when an atomic-leaf BlockInit carries inlineContent or children", () => {
    const initial = createEditor(config);

    const initWithInline: BlockInit = {
      type: "image",
      inlineContent: { items: [{ kind: "text", text: "x", attrs: {} }] },
    };
    expect(() =>
      { initial.dispatch({ type: "INSERT_NODE", node: initWithInline }); return initial; },
    ).toThrow();

    const initWithChildren: BlockInit = {
      type: "image",
      children: [{ type: "paragraph", inlineContent: { items: [] } }],
    };
    expect(() =>
      { initial.dispatch({ type: "INSERT_NODE", node: initWithChildren }); return initial; },
    ).toThrow();
  });
});

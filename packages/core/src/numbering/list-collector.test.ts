import { describe, it, expect } from "vitest";
import { collectListEvents, listCounterRenumberedBlocks } from "./list-collector";
import { buildState, buildBlock } from "../test-utils/state-builders";
import type { BlockId } from "../state";
import type { CounterValue } from "./types";

function flatDoc(children: Array<{ id: string; type: string; attrs?: Record<string, unknown> }>) {
  const blocks = [
    buildBlock({
      id: "root",
      type: "doc",
      firstChildId: children[0]?.id ?? null,
      lastChildId: children[children.length - 1]?.id ?? null,
    }),
  ];
  children.forEach((c, i) => {
    blocks.push(
      buildBlock({
        id: c.id,
        type: c.type,
        attrs: c.attrs,
        parentId: "root",
        prevSiblingId: i > 0 ? children[i - 1].id : null,
        nextSiblingId: i < children.length - 1 ? children[i + 1].id : null,
        inlineContent: { items: [] },
      }),
    );
  });
  return buildState({ rootId: "root", blocks });
}

describe("collectListEvents", () => {
  it("emits one event per list-item with listId scope + listLevel", () => {
    const state = flatDoc([
      { id: "i1", type: "list-item", attrs: { listId: "L1", listLevel: 0 } },
      { id: "i2", type: "list-item", attrs: { listId: "L1", listLevel: 0 } },
    ]);
    const events = collectListEvents(state);
    expect(events.map((e) => e.blockId)).toEqual(["i1", "i2"]);
    expect(events[0].scopeKey).toBe("L1");
    expect(events[0].level).toBe(0);
    expect(events[0].breakBefore).toBe(true);
    expect(events[1].breakBefore).toBe(false);
  });

  it("sets breakBefore when a non-list block intervenes", () => {
    const state = flatDoc([
      { id: "i1", type: "list-item", attrs: { listId: "L1", listLevel: 0 } },
      { id: "p1", type: "paragraph" },
      { id: "i2", type: "list-item", attrs: { listId: "L1", listLevel: 0 } },
    ]);
    const events = collectListEvents(state);
    expect(events.map((e) => e.blockId)).toEqual(["i1", "i2"]);
    expect(events[1].breakBefore).toBe(true);
  });

  it("sets breakBefore when the listId changes between adjacent items", () => {
    const state = flatDoc([
      { id: "i1", type: "list-item", attrs: { listId: "L1", listLevel: 0 } },
      { id: "i2", type: "list-item", attrs: { listId: "L2", listLevel: 0 } },
    ]);
    expect(collectListEvents(state)[1].breakBefore).toBe(true);
  });

  it("carries an override from listCounterOverride attr", () => {
    const state = flatDoc([
      { id: "i1", type: "list-item", attrs: { listId: "L1", listLevel: 0, listCounterOverride: 7 } },
    ]);
    expect(collectListEvents(state)[0].override).toBe(7);
  });
});

describe("listCounterRenumberedBlocks", () => {
  it("returns blocks whose value changed between prev and next", () => {
    const prev = new Map<BlockId, CounterValue>([
      ["a" as BlockId, { value: 1, formatted: "1" }],
      ["b" as BlockId, { value: 2, formatted: "2" }],
    ]);
    const next = new Map<BlockId, CounterValue>([
      ["a" as BlockId, { value: 1, formatted: "1" }],
      ["b" as BlockId, { value: 3, formatted: "3" }],
    ]);
    expect([...listCounterRenumberedBlocks(next, prev)]).toEqual(["b"]);
  });

  it("includes blocks that appear or disappear", () => {
    const prev = new Map<BlockId, CounterValue>([["a" as BlockId, { value: 1, formatted: "1" }]]);
    const next = new Map<BlockId, CounterValue>([["b" as BlockId, { value: 1, formatted: "1" }]]);
    expect(new Set(listCounterRenumberedBlocks(next, prev))).toEqual(new Set(["a", "b"]));
  });
});

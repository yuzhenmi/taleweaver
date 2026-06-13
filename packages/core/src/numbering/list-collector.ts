import type { BlockId, State } from "../state";
import { iterateBlocksInDocumentOrder } from "../state";
import type { CounterEvent, CounterValue } from "./types";

/**
 * Walk the BODY tree in document order and emit a CounterEvent per `list-item`.
 * `breakBefore` is true when the immediately-preceding document-order block was
 * NOT a list-item sharing this item's listId — i.e. a fresh consecutive run
 * starts here (#425). `override` comes from the optional `listCounterOverride`
 * attr (SET_LIST_RESTART). Only BODY blocks are numbered (footnote/header/footer
 * bodies are out of list scope in v1).
 *
 * Attrs are read off the frozen `ReadonlyAttrs` record (a
 * `Readonly<Record<string, unknown>>`) by string key and narrowed at the read
 * site — the same access pattern the cascade uses for custom attrs
 * (`attrs[key]` in `cascade/attr-registry.ts`).
 */
export function collectListEvents(state: State): CounterEvent[] {
  const events: CounterEvent[] = [];
  let prevListId: string | null = null;
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.type !== "list-item") {
      prevListId = null;
      continue;
    }
    const listIdRaw = block.attrs["listId"];
    const listId = typeof listIdRaw === "string" ? listIdRaw : "";
    const levelRaw = block.attrs["listLevel"];
    const level = typeof levelRaw === "number" ? levelRaw : 0;
    const overrideRaw = block.attrs["listCounterOverride"];
    const override = typeof overrideRaw === "number" ? overrideRaw : undefined;
    const breakBefore = prevListId !== listId;
    events.push({ blockId: block.id, scopeKey: listId, level, breakBefore, override });
    prevListId = listId;
  }
  return events;
}

/** Blocks whose computed number differs (value or presence) between two maps. */
export function listCounterRenumberedBlocks(
  next: ReadonlyMap<BlockId, CounterValue>,
  prev: ReadonlyMap<BlockId, CounterValue>,
): Set<BlockId> {
  const changed = new Set<BlockId>();
  for (const [id, v] of next) {
    const p = prev.get(id);
    if (p === undefined || p.value !== v.value || p.formatted !== v.formatted) changed.add(id);
  }
  for (const id of prev.keys()) {
    if (!next.has(id)) changed.add(id);
  }
  return changed;
}

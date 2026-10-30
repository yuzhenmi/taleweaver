import type { Block } from "../../../state";

/**
 * The nesting level of a `list-item` block (0–8). A missing / non-numeric /
 * non-positive `listLevel` attr is level 0 (the top of the list). Shared by the
 * LIST_INDENT/OUTDENT handler and the Enter/Backspace list-exit logic so the
 * "what level is this item" rule lives in one place.
 */
export function listLevelOf(block: Block): number {
  const raw = block.attrs.listLevel;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

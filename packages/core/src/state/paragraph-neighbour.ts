import type { Block } from "./block";
import type { BlockId } from "./block-id";
import type { Document } from "./state";
import { resolveBlock } from "./state";

/**
 * The block on the other side of a ¶ boundary of `current`: its
 * sibling, or — across a doc-root section boundary — the neighbouring section's
 * last / first block. `sectionBreak` names the section whose section-end item IS the ¶
 * between them (Backspace / Delete there removes the break in one step), else null.
 * Null at a flow's start / end (a cell, a header / footnote body, the final ¶).
 */
export interface ParagraphNeighbour {
  readonly block: Block;
  readonly sectionBreak: BlockId | null;
}

function blockOf(state: Document, id: BlockId | null): Block | null {
  return id === null ? null : (resolveBlock(state, id)?.block ?? null);
}

/** The doc-root section holding `b`, or null (`b` is in a cell / body / not top-level). */
function rootSectionOf(state: Document, b: Block): Block | null {
  const s = blockOf(state, b.parentId);
  return s !== null && s.type === "section" && s.parentId === state.rootId ? s : null;
}

/** The unit before `current`'s first caret position (Backspace at (current, 0)). */
export function blockBefore(state: Document, current: Block): ParagraphNeighbour | null {
  const prev = blockOf(state, current.prevSiblingId);
  if (prev !== null) return { block: prev, sectionBreak: null };
  const section = rootSectionOf(state, current);
  const prevSection = section === null ? null : blockOf(state, section.prevSiblingId);
  const last = prevSection === null ? null : blockOf(state, prevSection.lastChildId);
  return prevSection === null || last === null ? null : { block: last, sectionBreak: prevSection.id };
}

/** The unit after ¶`current` (Delete at (current, len)). */
export function blockAfter(state: Document, current: Block): ParagraphNeighbour | null {
  const next = blockOf(state, current.nextSiblingId);
  if (next !== null) return { block: next, sectionBreak: null };
  const section = rootSectionOf(state, current);
  const nextSection = section === null ? null : blockOf(state, section.nextSiblingId);
  const first = nextSection === null ? null : blockOf(state, nextSection.firstChildId);
  return section === null || first === null ? null : { block: first, sectionBreak: section.id };
}


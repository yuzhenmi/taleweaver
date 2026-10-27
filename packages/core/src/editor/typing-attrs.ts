import {
  resolveBlock,
  spanStart,
  mergeAttrs,
  deepValueEqual,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
} from "../state";
import type { State, Position, ReadonlyAttrs, InlineItem, TextItem } from "../state";
import type { AttrRegistry } from "../cascade/attr-registry";
import { isCollapsed } from "../cursor/selection";
import type { EditorState } from "./editor-state";

/**
 * Attrs typed text NEVER takes from its neighbours: change-tracking provenance.
 * Typed text is attributed to its own author (suggesting mode mints a fresh
 * insertion), never folded into someone else's suggestion.
 */
const NEVER_INHERITED: ReadonlySet<string> = new Set([
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
]);

const EMPTY: ReadonlyAttrs = Object.freeze({});

/**
 * The TEXT runs either side of `offset`. Embeds are skipped: typing beside an
 * inline object (image, footnote reference, field, tab, comment marker) continues
 * the surrounding text's formatting rather than taking the object's.
 */
function neighbours(
  items: ReadonlyArray<InlineItem>,
  offset: number,
): { before: TextItem | null; after: TextItem | null } {
  let before: TextItem | null = null;
  let pos = 0;
  for (const item of items) {
    if (item.kind !== "text") {
      pos += 1;
      continue;
    }
    const end = pos + item.text.length;
    if (end <= offset) before = item;
    else if (pos >= offset) return { before, after: item };
    else return { before: item, after: item }; // offset strictly inside this run
    pos = end;
  }
  return { before, after: null };
}

function itemsAt(state: State, blockId: Position["blockId"]): ReadonlyArray<InlineItem> {
  return resolveBlock(state, blockId)?.block.inlineContent?.items ?? [];
}

/**
 * The attrs text typed at a collapsed caret `pos` inherits (word-processor
 * "typing attributes"): those of the character BEFORE the caret (at block start:
 * the character after), keeping
 *   - every INCLUSIVE key (formatting), and
 *   - a NON-inclusive key (link, most host marks) only when the caret is strictly
 *     inside its range — the same value on both sides; at its edge it is dropped,
 * and never an atomic mark or change-tracking provenance.
 */
export function inheritedAttrsAt(state: State, pos: Position, registry: AttrRegistry): ReadonlyAttrs {
  const { before, after } = neighbours(itemsAt(state, pos.blockId), pos.offset);
  const base = before ?? after;
  if (base === null) return EMPTY;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base.attrs)) {
    if (NEVER_INHERITED.has(key)) continue;
    if (!registry.isInclusive(key)) {
      // At a block edge or an atomic mark: never extended.
      if (registry.isAtomic(key) || before === null || after === null) continue;
      // Between two runs: inside the mark only if the next run carries the same value.
      // (`before === after`: the caret is strictly inside one run — inside the mark.)
      if (before !== after) {
        const eq = registry.get(key)?.equals ?? deepValueEqual;
        if (!(key in after.attrs) || !eq(before.attrs[key], after.attrs[key])) continue;
      }
    }
    out[key] = base.attrs[key];
  }
  return Object.freeze(out);
}

/**
 * The attrs text typed OVER a selection takes: those of the first selected
 * character (Google Docs / Word), minus atomic marks (typing replaces the unit, it
 * does not become one) and provenance. Falls back to the caret rule when the
 * selection starts at the end of a block.
 */
function typeOverAttrs(state: State, start: Position, registry: AttrRegistry): ReadonlyAttrs {
  const { after } = neighbours(itemsAt(state, start.blockId), start.offset);
  if (after === null) return inheritedAttrsAt(state, start, registry);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after.attrs)) {
    if (NEVER_INHERITED.has(key) || registry.isAtomic(key)) continue;
    out[key] = after.attrs[key];
  }
  return Object.freeze(out);
}

/**
 * The attrs the next typed text gets: the pending `storedAttrs` (set by a format
 * command at a collapsed caret) if any, else the attrs inherited at the caret
 * (or, over a selection, those of its first character).
 */
export function getTypingAttrs(editor: EditorState, registry: AttrRegistry): ReadonlyAttrs {
  if (editor.storedAttrs !== undefined) return editor.storedAttrs;
  const { state, selection } = editor;
  return isCollapsed(selection)
    ? inheritedAttrsAt(state, selection.focus, registry)
    : typeOverAttrs(state, spanStart(state, selection), registry);
}

/**
 * A format command at a collapsed caret: record `delta` (merged over the current
 * typing attrs; `undefined` values remove) as the pending typing attrs. The
 * document is unchanged; the next typed text takes them.
 */
export function storeTypingAttrs(
  editor: EditorState,
  delta: ReadonlyAttrs,
  registry: AttrRegistry,
): EditorState {
  return { ...editor, storedAttrs: mergeAttrs(getTypingAttrs(editor, registry), delta) };
}

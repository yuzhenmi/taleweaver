import {
  resolveBlock,
  spanStart,
  mergeAttrs,
  deepValueEqual,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  isFormattingSuggestionKey,
} from "../state";
import type { Document, Position, ReadonlyAttrs, InlineItem, TextItem } from "../state";
import type { AttrRegistry } from "../cascade/attr-registry";
import { isCollapsed } from "../cursor/selection";
import { requireAttrRegistry } from "../state/mark-attrs";
import { DOCUMENT_INTERNAL } from "../state/document-internal";

/** The attr registry bound to the editor's doc (the editor binds `EditorConfig.attrRegistry`). */
const registryOf = (document: Document): AttrRegistry => requireAttrRegistry(document[DOCUMENT_INTERNAL].doc);
import type { EditorState } from "./editor-state";
import type { Edit } from "./edit";

/**
 * Attrs typed text NEVER takes from its neighbours: change-tracking provenance.
 * Typed text is attributed to its own author (suggesting mode mints a fresh
 * insertion), never folded into someone else's suggestion.
 */
const PROVENANCE_KEYS: ReadonlySet<string> = new Set([INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR]);
function neverInherited(key: string): boolean {
  return PROVENANCE_KEYS.has(key) || isFormattingSuggestionKey(key);
}

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

function itemsAt(document: Document, blockId: Position["blockId"]): ReadonlyArray<InlineItem> {
  return resolveBlock(document, blockId)?.block.inlineContent?.items ?? [];
}

/** An EMPTY paragraph's typing attrs: its ¶'s character props (`markAttrs`, inclusive keys only). */
function emptyParagraphAttrs(document: Document, blockId: Position["blockId"]): ReadonlyAttrs {
  return resolveBlock(document, blockId)?.block.markAttrs ?? EMPTY;
}

/**
 * The attrs text typed at a collapsed caret `pos` inherits (word-processor
 * "typing attributes"): those of the character BEFORE the caret (at block start:
 * the character after; in an EMPTY paragraph, its ¶'s character props — `markAttrs`), keeping
 *   - every INCLUSIVE key (formatting), and
 *   - a NON-inclusive key (link, most host marks) only when the caret is strictly
 *     inside its range — the same value on both sides; at its edge it is dropped,
 * and never an atomic mark or change-tracking provenance. Keys are judged by the attr
 * registry bound to the doc.
 */
export function inheritedAttrsAt(document: Document, pos: Position): ReadonlyAttrs {
  return inheritedWith(document, pos, registryOf(document));
}

function inheritedWith(document: Document, pos: Position, registry: AttrRegistry): ReadonlyAttrs {
  const { before, after } = neighbours(itemsAt(document, pos.blockId), pos.offset);
  const base = before ?? after;
  // No text run (an empty paragraph): Word / GDocs type with the ¶'s formatting.
  if (base === null) return emptyParagraphAttrs(document, pos.blockId);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base.attrs)) {
    if (neverInherited(key)) continue;
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
function typeOverAttrs(document: Document, start: Position, registry: AttrRegistry): ReadonlyAttrs {
  const { after } = neighbours(itemsAt(document, start.blockId), start.offset);
  if (after === null) return inheritedWith(document, start, registry);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after.attrs)) {
    if (neverInherited(key) || registry.isAtomic(key)) continue;
    out[key] = after.attrs[key];
  }
  return Object.freeze(out);
}

/**
 * The attrs the next typed text gets: the pending `storedAttrs` (set by a format
 * command at a collapsed caret) if any, else the attrs inherited at the caret
 * (or, over a selection, those of its first character).
 */
export function getTypingAttrs(editor: EditorState): ReadonlyAttrs {
  if (editor.storedAttrs !== undefined) return editor.storedAttrs;
  const { document, selection } = editor;
  return isCollapsed(selection)
    ? inheritedAttrsAt(document, selection.focus)
    : typeOverAttrs(document, spanStart(document, selection), registryOf(document));
}

/**
 * A format command at a collapsed caret: record `delta` (merged over the current
 * typing attrs; `undefined` values remove) as the pending typing attrs. The
 * document is unchanged; the next typed text takes them.
 */
export function storeTypingAttrs(editor: EditorState, delta: ReadonlyAttrs): Edit {
  return { storedAttrs: mergeAttrs(getTypingAttrs(editor), delta) };
}

/**
 * The attrs text written over `[from, to]` takes, as if typed there: at a point the
 * inherited typing attrs, over a range the first replaced character's (see
 * `getTypingAttrs`). Used by host proposals so suggested text matches its surroundings.
 */
export function replacementAttrs(document: Document, from: Position, to: Position): ReadonlyAttrs {
  return from.blockId === to.blockId && from.offset === to.offset
    ? inheritedAttrsAt(document, from)
    : typeOverAttrs(document, from, registryOf(document));
}

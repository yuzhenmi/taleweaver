import { useEffect, useState } from "react";
import {
  createPosition,
  findMatches,
  getBlock,
  type BlockId,
  type Decoration,
  type EditorState,
  type Document,
} from "@taleweaver/core";
import { mentionDecorations } from "./mentions";
/** The pointer event fields the demo reads — satisfied by BOTH backends' events
 *  (digital `DecorationPointerEvent`, print `PrintDecorationPointerEvent`). */
export interface AidPointerEvent {
  readonly type: "enter" | "leave" | "click";
  readonly decoration: Decoration;
  readonly rect: { readonly left: number; readonly bottom: number };
}

/**
 * Generic "writing aids" demo for the decoration layer. The host derives view-only
 * decorations from the document and hands them to the editor; nothing is stored in the
 * document, the undo history or the clipboard.
 *
 * - inline: keyword highlights (solid underline) and a style hint on "-ly" adverbs (wavy);
 * - widget: a word-count badge at the end of each long paragraph;
 * - block: a faint tint on paragraphs over the length threshold.
 */
const KEYWORDS = ["wolf", "grandmother", "wood"];
const LONG_PARAGRAPH_WORDS = 60;

/** Hover payload carried in `Decoration.data` (opaque to the editor). */
interface AidInfo {
  readonly message: string;
}

function isAidInfo(value: unknown): value is AidInfo {
  return typeof value === "object" && value !== null && typeof (value as { message?: unknown }).message === "string";
}

function leafIds(document: Document): BlockId[] {
  const out: BlockId[] = [];
  const walk = (id: BlockId | null): void => {
    for (let cur = id; cur !== null; ) {
      const b = getBlock(document, cur);
      if (b === null) return;
      if (b.inlineContent !== null) out.push(b.id);
      else walk(b.firstChildId);
      cur = b.nextSiblingId;
    }
  };
  walk(getBlock(document, document.rootId)?.firstChildId ?? null);
  return out;
}

export function writingAidDecorations(document: Document): Decoration[] {
  const out: Decoration[] = [];
  for (const word of KEYWORDS) {
    for (const m of findMatches(document, word, { wholeWord: true })) {
      out.push({
        kind: "inline",
        id: `keyword:${m.blockId}:${m.start}`,
        from: createPosition(m.blockId, m.start),
        to: createPosition(m.blockId, m.end),
        style: { underline: { color: "#2563eb", style: "solid" } },
        data: { message: `Keyword: "${word}"` } satisfies AidInfo,
      });
    }
  }
  for (const id of leafIds(document)) {
    const items = getBlock(document, id)?.inlineContent?.items ?? [];
    const text = items.map((i) => (i.kind === "text" ? i.text : "￼")).join("");
    for (const m of text.matchAll(/\b\w+ly\b/g)) {
      out.push({
        kind: "inline",
        id: `adverb:${id}:${m.index}`,
        from: createPosition(id, m.index),
        to: createPosition(id, m.index + m[0].length),
        style: { underline: { color: "#d97706", style: "wavy" } },
        data: { message: `Style: consider a stronger verb than "${m[0]}"` } satisfies AidInfo,
      });
    }
    const words = text.split(/\s+/).filter((w) => w !== "").length;
    if (words > LONG_PARAGRAPH_WORDS) {
      out.push({ kind: "block", id: `long:${id}`, blockId: id, style: { backgroundColor: "rgba(217,119,6,0.06)" } });
      out.push({
        kind: "widget",
        id: `count:${id}`,
        at: createPosition(id, text.length),
        text: ` ${words} words`,
        attributes: { "aria-hidden": "true" },
        class: "text-xs text-gray-400",
        data: { message: `Long paragraph: ${words} words` } satisfies AidInfo,
      });
    }
  }
  return out;
}

/**
 * Recompute the aids off the keystroke path (debounced): between recomputes the editor
 * keeps the previous set mapped through every edit, so it stays attached while typing.
 * The mention hover decorations (computed from the mark ranges) ride along, whether or
 * not the writing aids are shown.
 */
export function useWritingAids(
  enabled: boolean,
  editorState: EditorState,
  setDecorations: (decorations: readonly Decoration[], basedOn: Document) => void,
  extra: () => readonly Decoration[] = () => [],
): void {
  const document = editorState.document;
  useEffect(() => {
    // Computed against `document`; the editor maps the result through any edits made since.
    const compute = () => [
      ...(enabled ? writingAidDecorations(document) : []),
      ...mentionDecorations(document),
      ...extra(),
    ];
    const handle = window.setTimeout(() => setDecorations(compute(), document), 250);
    return () => window.clearTimeout(handle);
  }, [enabled, document, setDecorations, extra]);
}

/** A hover card anchored to the innermost hovered decoration that carries a message. */
export function WritingAidPopover({ event }: { event: AidPointerEvent | null }) {
  // Hovered decorations with a message, in enter order (overlaps nest: keyword + style hint).
  const [stack, setStack] = useState<ReadonlyArray<{ id: string; message: string; left: number; top: number }>>([]);
  useEffect(() => {
    if (event === null) return;
    const id = event.decoration.id;
    if (event.type === "leave") {
      setStack((s) => s.filter((e) => e.id !== id));
      return;
    }
    if (event.type !== "enter" || !isAidInfo(event.decoration.data)) return;
    const entry = { id, message: event.decoration.data.message, left: event.rect.left, top: event.rect.bottom + 6 };
    setStack((s) => [...s.filter((e) => e.id !== id), entry]);
  }, [event]);
  const card = stack[stack.length - 1];
  if (card === undefined) return null;
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border bg-white px-2 py-1 text-xs shadow-md"
      style={{ left: card.left, top: card.top }}
    >
      {card.message}
    </div>
  );
}

/** The demo toggle, shared by the print and digital tabs so both show the same demo. */
export function WritingAidsToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 border-b px-4 py-1 text-xs text-gray-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Writing aids (decoration layer demo: keyword underlines, wavy style hints, word-count badges on long
      paragraphs — hover them)
    </label>
  );
}

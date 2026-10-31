import {
  createDefaultAttrRegistry,
  registerMark,
  getMarkRanges,
  extractText,
  type AttrRegistry,
  type MarkDom,
  type Decoration,
  type EditorAction,
  type EditorState,
  type Document,
} from "@taleweaver/core";

/**
 * Generic "mention" demo for host inline marks (shared by the print and digital
 * tabs). A mention is a `mention` mark whose value names a record:
 *   - atomic: the caret never rests inside it; Backspace removes it whole;
 *   - non-inclusive: typing at its edges does not extend it;
 *   - kept on copy/paste inside the editor;
 *   - drawn as a chip via `toStyle` (both backends) + a DOM class (digital).
 * Hover cards come from decorations computed off `getMarkRanges`.
 */
export const MENTION = "mention";

interface MentionValue {
  readonly ref: string;
  readonly label: string;
}

function isMentionValue(value: unknown): value is MentionValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ref?: unknown }).ref === "string" &&
    typeof (value as { label?: unknown }).label === "string"
  );
}

/** The demo attribute registry: the built-ins + the `mention` mark. */
export function createDemoAttrRegistry(): AttrRegistry {
  const registry = createDefaultAttrRegistry();
  registerMark(registry, MENTION, {
    atomic: true,
    inclusive: false,
    copy: "keep",
    toStyle: () => ({ backgroundColor: "#e8f0fe", color: "#174ea6" }),
    toDom: (value): MarkDom => {
      const attributes: Record<string, string> = isMentionValue(value) ? { "data-mention-ref": value.ref } : {};
      return { class: "rounded-sm px-px", attributes };
    },
  });
  return registry;
}

/** The SET_MARK turning the selection into a mention of the selected text, or null. */
export function mentionAction(editor: EditorState): EditorAction | null {
  const { anchor, focus } = editor.selection;
  if (anchor.blockId === focus.blockId && anchor.offset === focus.offset) return null;
  const label = extractText(editor.document, editor.selection).trim();
  if (label === "" || label.includes("\n")) return null;
  const value: MentionValue = { ref: `person:${label.toLowerCase().replace(/\s+/g, "-")}`, label };
  return { type: "SET_MARK", key: MENTION, value };
}

/** Hover-only decorations over every mention (payload read by the shared popover). */
export function mentionDecorations(document: Document): Decoration[] {
  return getMarkRanges(document, MENTION).map((r, i) => ({
    kind: "inline",
    id: `mention:${i}:${r.from.blockId}:${r.from.offset}`,
    from: r.from,
    to: r.to,
    data: { message: isMentionValue(r.value) ? `Mention: ${r.value.label} (${r.value.ref})` : "Mention" },
  }));
}

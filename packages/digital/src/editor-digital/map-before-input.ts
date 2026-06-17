import {
  createSpan,
  type EditorAction,
  type Selection,
  type Span,
  type Position,
} from "@taleweaver/core";

export interface MapBeforeInputCtx {
  readonly selection: Selection;
  readonly domToPosition: (node: Node, off: number) => Position | null;
}

/** Map the first StaticRange of `getTargetRanges()` to a core Span, or null if absent/unmappable. */
function targetRangeSpan(e: InputEvent, ctx: MapBeforeInputCtx): Span | null {
  const ranges = e.getTargetRanges();
  const r = ranges[0];
  if (r === undefined) return null;
  const start = ctx.domToPosition(r.startContainer, r.startOffset);
  const end = ctx.domToPosition(r.endContainer, r.endOffset);
  if (start === null || end === null) return null;
  return createSpan(start, end);
}

/**
 * Read inserted text from dataTransfer when `e.data` is null (F9 — Safari dictation/replace).
 * Guards with a truthiness check, not `!== null`: the `dataTransfer` property is `DataTransfer | null`
 * by type but can be ABSENT (`undefined`) on synthetic/jsdom events, and `.getData()` on `undefined`
 * would throw.
 */
function insertedTextFallback(e: InputEvent): string | null {
  const dt = e.dataTransfer;
  if (dt) {
    const t = dt.getData("text/plain");
    if (t !== "") return t;
  }
  return null;
}

export function mapBeforeInput(e: InputEvent, ctx: MapBeforeInputCtx): EditorAction | null {
  switch (e.inputType) {
    case "insertText": {
      if (e.data !== null) return { type: "INSERT_TEXT", text: e.data };
      const fallback = insertedTextFallback(e);
      return fallback !== null ? { type: "INSERT_TEXT", text: fallback } : null;
    }
    case "insertReplacementText": {
      const span = targetRangeSpan(e, ctx);
      if (span === null) return null;
      return { type: "DELETE_RANGE", span };
    }
    case "insertCompositionText":
      return null; // mid-composition; compositionend handles it
    case "insertLineBreak":
    case "insertParagraph":
      return { type: "SPLIT_NODE" };
    case "insertFromPaste":
      // The controller's `paste` ClipboardEvent handler is the single paste source (it fires
      // alongside this beforeinput). Mapping here too would dispatch PASTE twice — C1. The
      // controller still preventDefaults this event to suppress the browser's native mutation.
      return null;
    case "insertFromDrop": {
      // Drop has no ClipboardEvent peer, so beforeinput owns it.
      // Truthiness guard (not `!== null`): `dataTransfer` may be absent (`undefined`) on synthetic events.
      const dt = e.dataTransfer;
      const text = dt ? dt.getData("text/plain") : "";
      return text !== "" ? { type: "PASTE", text } : null;
    }
    case "deleteContentBackward":
      return { type: "DELETE_BACKWARD" };
    case "deleteContentForward":
      return { type: "DELETE_FORWARD" };
    case "deleteWordBackward": {
      const span = targetRangeSpan(e, ctx);
      return span !== null ? { type: "DELETE_RANGE", span } : { type: "DELETE_WORD", direction: "backward" };
    }
    case "deleteWordForward": {
      const span = targetRangeSpan(e, ctx);
      return span !== null ? { type: "DELETE_RANGE", span } : { type: "DELETE_WORD", direction: "forward" };
    }
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward": {
      const span = targetRangeSpan(e, ctx);
      return span !== null ? { type: "DELETE_RANGE", span } : { type: "DELETE_BACKWARD" };
    }
    case "deleteSoftLineForward":
    case "deleteHardLineForward": {
      const span = targetRangeSpan(e, ctx);
      return span !== null ? { type: "DELETE_RANGE", span } : { type: "DELETE_FORWARD" };
    }
    case "deleteByCut":
    case "deleteByDrag":
      return { type: "DELETE_RANGE", span: ctx.selection };
    case "formatBold":
      return { type: "TOGGLE_STYLE", style: "bold" };
    case "formatItalic":
      return { type: "TOGGLE_STYLE", style: "italic" };
    case "formatUnderline":
      return { type: "TOGGLE_STYLE", style: "underline" };
    case "formatStrikeThrough":
      return { type: "TOGGLE_STYLE", style: "strikethrough" };
    case "historyUndo":
      return { type: "UNDO" };
    case "historyRedo":
      return { type: "REDO" };
    default:
      return null;
  }
}

/**
 * For `insertReplacementText`, the controller needs both the delete (returned by mapBeforeInput)
 * and the replacement insert. Expose the replacement text so the controller can dispatch the
 * follow-on INSERT_TEXT (spec C4 / F9). Returns null when not a replacement event.
 *
 * Falls back to `dataTransfer["text/plain"]` when `e.data` is null (D2): some engines deliver the
 * replacement payload only via `dataTransfer`. Without the fallback the mapped DELETE_RANGE would
 * run but the follow-on INSERT_TEXT would be skipped — text deleted, no replacement.
 */
export function replacementInsertText(e: InputEvent): string | null {
  if (e.inputType !== "insertReplacementText") return null;
  if (e.data !== null) return e.data;
  return insertedTextFallback(e);
}

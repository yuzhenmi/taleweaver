import type { EditorState } from "../editor-state";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./helpers/apply-attrs-or-suggest";
import { storeTypingAttrs } from "../typing-attrs";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";

/**
 * Set or clear a hyperlink on the current selection. Used by HL.4's
 * Cmd+K popup; can also be dispatched programmatically.
 *
 * `url`:
 *   - non-empty string → set `{ link: url }` on every text item in
 *     the selection. The cascade's `linkInterpreter` then renders
 *     each affected item as blue + underlined.
 *   - `null` or empty string → clear the link attr from every text
 *     item in the selection (passes `{ link: undefined }` to
 *     applyAttrsToRange, which `mergeAttrs` interprets as a removal).
 *
 * The cascade is responsible for visual styling; this handler only
 * mutates state. Click handling (Cmd/Ctrl-click to open the URL)
 * lives in the DOM editor controller (HL.3).
 *
 * Mirrors the toggle-style.ts shape: at a collapsed caret, REMOVING the
 * link records it in the pending typing attrs (the next typed text is not
 * linked) while setting a URL is a no-op (a link needs text); state-equality short-circuit; the selection is
 * preserved unchanged; dirtyIds threaded through to the
 * incremental render pipeline.
 */
export function handleSetLink(editor: EditorState, { url }: ActionOf<"SET_LINK">): Edit | null {
  const { config } = editor;
  const { selection } = editor;
  // Collapsed caret: removing the link stops the next typed text from being
  // linked (typing attrs); a URL needs text to target, so setting one is a no-op.
  if (isCollapsed(selection)) {
    return url === null || url.length === 0
      ? storeTypingAttrs(editor, { link: undefined })
      : null;
  }

  // Normalize empty string to a removal — UX rule: an empty URL
  // isn't a meaningful link. Per the HL.1 test note, the cascade
  // interpreter would still apply link styling for an empty string,
  // so this handler is where we reject it.
  const incoming = url !== null && url.length > 0
    ? { link: url }
    : { link: undefined };
  const result = applyAttrsOrSuggest(editor.state, selection, incoming, config);
  if (result.state === editor.state) return null;

  // An attr-only edit shifts no offsets, so the selection is unchanged — it is
  // committed and rebuilt AS-IS, preserving both endpoints and the anchor/focus
  // DIRECTION (a backward drag-selection stays backward — Google-Docs parity).
  // Normalizing via spanStart/spanEnd would silently flip a backward selection
  // to forward, so a following Shift+Arrow would extend from the wrong end.
  return { change: result };
}

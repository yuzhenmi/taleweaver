# Hyperlinks — Design Spec

> First user-facing feature on top of the cleaned-up foundation.
> Status: brainstorm. Decisions captured inline as they happen
> (durability rule).

## Goal

Support inline hyperlinks: text that, when clicked, opens a URL.
Match Google Docs behavior: paste a URL onto selected text → that
text becomes a link; click a link in the editor → opens the URL;
right-click a link → context menu with "Edit link", "Copy link",
"Remove link"; hovering a link → small tooltip with the URL.

Out of scope (separate work):
- Smart URL parsing (typing "google.com" auto-linking).
- Link previews / inline preview cards.
- Internal cross-references (`#section-id` anchors within the doc).
  Different machinery; deferred to post-P9b.

## State model

A hyperlink is an inline-level decoration on a span of text. The
state model already supports inline attributes on `TextItem`s, so
hyperlinks are a new attribute key:

```ts
text("hello", { link: "https://example.com" })
```

Selecting text and pressing Cmd+K (or pasting a URL onto a
selection) sets `link` on each text item in the range. Removing the
link clears the attr.

**No new state primitives.** The existing `applyAttrsToRange`
operation handles "set/clear an attr on a range" — used today for
bold/italic. Hyperlinks reuse it.

## Render model

The renderer expands `TextItem` with `link` attr into a styled
TextBox. The link styling (underlined, color: link-blue) is applied
via the `link` attr's interpreter — same mechanism used for bold /
italic.

A new attr interpreter:

```ts
const linkInterpreter: AttrInterpreter = {
  attr: "link",
  apply: (value, style, ctx) => ({
    ...style,
    color: typeof value === "string" ? "#1a73e8" : style.color,
    textDecoration:
      typeof value === "string"
        ? { line: "underline", color: "#1a73e8" }
        : style.textDecoration,
  }),
};
```

Registered alongside the other builtins in
`createDefaultAttrRegistry()`.

## Painter / DOM layer

The DOM painter (`@taleweaver/dom`'s canvas-renderer) already
honors `color` and `textDecoration` from `ComputedStyle`. No painter
change needed.

For interactivity (click → open URL, hover → show tooltip), the DOM
editor controller (`packages/dom/src/editor-controller.ts`)
intercepts mouse events. New handlers:

- **`mousedown` on link text + Cmd/Ctrl modifier**: open URL in new
  tab via `window.open(url, "_blank")`. Cmd/Ctrl is the standard
  modifier (Google Docs uses Cmd+Click on Mac, Ctrl+Click on
  Windows/Linux) so that plain-click can still place the cursor for
  editing.
- **`mousemove` on link text**: change cursor to pointer; show a
  small tooltip with the URL after a brief hover delay (300ms).
- **`mousedown` (right click) on link text**: show a context menu
  with "Edit link", "Copy link", "Remove link". (Context menu is a
  React component in `packages/react`.)

To know whether a click landed on link text, the hit-test result's
`Position` needs to map back to the inline item, then check the
item's `link` attr. Hit-test already returns a `Position`; the
controller does `getBlock(state, position.blockId)` →
`findItemAtOffset(block.inlineContent, position.offset)` →
`item.attrs.link`.

## React / toolbar UI

The toolbar gains a link button + popup:

- **Toolbar link button**: enabled when selection is non-collapsed.
  Click → popup with a URL input. Type URL, press Enter → apply
  `{ link: url }` to the selection.
- **Inline link tooltip** (when cursor is inside a link): floating
  pill above the link showing the URL with "Edit" / "Remove"
  buttons.
- **Keyboard shortcut**: Cmd+K (Mac) / Ctrl+K (Windows/Linux) →
  open the link popup (with the URL pre-filled if cursor is in an
  existing link).

## Editor action

A new `EditorAction` variant:

```ts
| { type: "SET_LINK"; url: string | null }
```

`url: null` removes the link. Handler:

```ts
export function handleSetLink(
  editor: EditorState,
  url: string | null,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;
  // Apply { link: url ?? undefined } to the range.
  const result = applyAttrsToRange(editor.state, selection, { link: url ?? undefined });
  if (result.state === editor.state) return editor;
  editor.history.commit(result, { before: selection, after: selection });
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}
```

The reducer adds the case; mapKeyEvent maps Cmd+K → ... actually
Cmd+K opens the popup, not directly dispatches `SET_LINK` (the URL
needs user input first). The popup component dispatches `SET_LINK`
when the user confirms.

## Paste behavior

When the user pastes plain text that looks like a URL (matches a
URL regex), and the selection is non-collapsed, Google Docs applies
the pasted URL as a link to the selected text (keeping the
selection's text content intact).

For this initial implementation, defer the smart-paste behavior:
plain paste behaves as today (replaces selection with pasted text).
A future task wraps the URL detection.

## Test plan

State module:
- `applyAttrsToRange` already tested. No new state tests.

Cascade module:
- Add a unit test for the link interpreter: link attr → color +
  textDecoration; no link attr → unchanged.

Editor module:
- New `handleSetLink` action + unit tests (collapsed → no-op;
  non-collapsed → link applied; null URL → link removed).

DOM module:
- Cmd+Click on link → window.open mocked + asserted.
- Hover → cursor change + tooltip visibility.

React module:
- Toolbar button enable/disable based on selection.
- Cmd+K opens popup, focus moves to input, Enter dispatches
  SET_LINK.

Browser smoke:
- Type some text, select it, press Cmd+K, type URL, press Enter →
  text becomes underlined + blue.
- Cmd+Click the link → new tab opens.
- Hover the link → cursor changes + tooltip appears.

## Task sequence

Each task ends with reviewer-until-clean.

### HL.1 — `link` attr interpreter

Add `linkInterpreter` to `cascade/attr-interpreters.ts` (or
wherever the builtin interpreters live). Register in
`createDefaultAttrRegistry()`. Tests asserting computedStyle for
link vs no-link.

### HL.2 — `SET_LINK` action handler

Add `EditorAction` variant + `handleSetLink` handler under
`editor/actions/`. Reducer case. Tests for collapsed / non-
collapsed / null URL.

### HL.3 — DOM controller Cmd+Click + cursor + tooltip

Intercept mousedown with Cmd/Ctrl modifier. When click lands on
link text, prevent cursor placement and open URL. On mousemove,
detect link hover and update cursor.

### HL.4 — React toolbar button + popup

Toolbar link button. Popup component with URL input. Cmd+K
shortcut.

### HL.5 — Inline link tooltip (when cursor is on link)

Floating pill above link showing URL with Edit / Remove buttons.

### HL.6 — Browser smoke + arch doc update

Full end-to-end smoke. Update 1.7-editor.md's action-table with
SET_LINK row.

## Risk table

| Risk | Likelihood | Mitigation |
|---|---|---|
| The `link` attr name collides with a future attr (e.g., internal cross-references). | Low | Cross-references would use a different namespace (e.g., `xref` / `target`) — they're internal anchors, not URLs. |
| URL validation: malicious URLs (`javascript:`, `data:`) could be set as link, opening security risk on Cmd+Click. | Medium | Validate URL at SET_LINK time — reject non-http(s) URLs by default. Allow https://, http://, mailto:, tel:. |
| Hover-tooltip popup positioning across PageBox boundaries. | Medium | Use the existing PixelPosition geometry to position the tooltip relative to the link's bounding rect. |
| Right-click context menu interactions could conflict with native browser context menu. | Low | Use `e.preventDefault()` on contextmenu event; show our own menu. |
| Copy-paste of linked text should preserve the link (clipboard format). | Medium | Initial impl: plain-text paste only (existing behavior). HL-followup task for rich-text clipboard format. |

## Status tracker

| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| HL.1 | not started | — | Link attr interpreter. |
| HL.2 | not started | — | SET_LINK action handler. |
| HL.3 | not started | — | DOM controller Cmd+Click + cursor + tooltip. |
| HL.4 | not started | — | React toolbar + popup. |
| HL.5 | not started | — | Inline link tooltip. |
| HL.6 | not started | — | Browser smoke + arch doc update. |

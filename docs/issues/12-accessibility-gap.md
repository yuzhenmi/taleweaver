# Issue 12 — No accessibility tree (Minor / Strategic)

## Summary

A canvas editor is an accessibility black hole unless explicitly
designed to expose its structure. Taleweaver paints to canvas with no
parallel DOM tree representing the document, no ARIA semantics, and no
hooks for screen readers, voice-control, browser Find, or copy-paste-
preserving-structure. The textarea receives input but is empty — assistive
tech reading the focused element learns nothing about the document.

## Where it manifests

### The DOM is opaque

`packages/dom/src/editor-controller.ts:74–98`:

```ts
container.style.position = "relative";
container.style.outline = "none";
container.style.cursor = "text";
container.style.userSelect = "none";

// textarea
textarea.style.opacity = "0";
textarea.tabIndex = 0;
container.appendChild(textarea);
```

The container has no `role`, no `aria-*`, and a 1px transparent
textarea is the only interactive element. The textarea is also kept
empty (cleared on every input event, line 637).

### Painted text is invisible to AT

Glyphs go to a `<canvas>`. Screen readers see nothing.

### No "Find in page"

The browser's Ctrl+F searches DOM text nodes. There are no DOM text
nodes containing the document — just a canvas.

### No structural copy

Copy emits plaintext only (`extractText`). No HTML payload for
preserving structure when pasted into another rich editor.

## Why it's a problem

1. **Legal/compliance.** WCAG, Section 508, EU EAA — public-facing
   editors for accessibility-mandated audiences are non-starters
   without an accessibility tree.
2. **Browser features stop working.** Find in page, translate page,
   reader mode, cursor-position-aware extensions, accessibility
   inspector — all blind.
3. **Lockout.** A canvas editor with no AT plan is unusable for
   screen-reader users.
4. **Hard to retrofit.** The closer "the engine knows where things are"
   is to one place, the easier the retrofit. Right now, the layout
   tree knows the geometry but the canvas is the *only* render output.

## Fix options

### Option A — parallel offscreen DOM tree (the standard approach)

Mirror the layout tree as a DOM tree of `<div>` elements positioned to
match the canvas, but with the actual text nodes inside, ARIA roles,
and `aria-live` regions for selection changes.

```
container
├── canvas  (or paginated canvases) — visual
└── div role="textbox" aria-multiline="true" aria-label="Document"
    ├── div role="paragraph"
    │   └── span tabindex="-1"      "Hello "
    │   └── span aria-bold="true"   "world"
    ├── div role="heading" aria-level="2"
    │   └── span                    "Section title"
    ├── div role="list" aria-label="Bulleted list"
    │   └── div role="listitem"
    │       └── span                "First item"
    ...
```

The tree is positioned absolutely to match canvas geometry; mouse
events route correctly to the canvas (transparent / pointer-events:
none on the AT layer).

Pros: comprehensive; standard pattern (Google Docs uses this).
Cons: doubles the DOM cost; complex sync logic; the very thing
contentEditable editors don't need.

### Option B — ARIA on canvas with custom AT bindings

Use `<canvas role="application" aria-activedescendant="...">` and
maintain a hidden DOM subtree of `aria-labelled` elements. Less complete
than Option A — works for screen readers but still no Find in page.

Pros: smaller DOM cost.
Cons: limited browser feature support.

### Option C — `<canvas>` with `<text>` fallback children (the WCAG pattern)

Place fallback DOM text nodes inside the `<canvas>` element. They are
not painted, but assistive tech can read them. This is the spec-blessed
pattern. Combined with `aria-live` for selection changes.

Pros: minimal extra DOM.
Cons: AT support varies; fallback children don't update with edits
unless you sync them.

**Recommendation:** Option A. It's costly but it's what real
production word-processor-grade editors do. Google Docs spent the
effort precisely because canvas + AT is hard. Plan it as a major
project milestone, not an afterthought.

## Migration plan (for Option A)

1. Add an `accessibility-tree.ts` module in `dom/`. Given a layout tree
   + state tree, it produces a virtual DOM description with ARIA roles.
2. Mount this DOM as a sibling of the canvas inside `container`,
   absolutely positioned at the same coordinates as the canvas.
3. Hook `update(editorState)` to also rebuild the AT tree.
4. Add a `setSelection` listener that updates `aria-selected` /
   `aria-activedescendant` to track focus.
5. Implement `aria-multiline`, `role="textbox"`, `aria-label` on the
   container, `aria-readonly` if not editable.
6. Component types map to ARIA roles:
   - paragraph → `paragraph`
   - heading + level → `heading` + `aria-level`
   - list (ordered) → `list` (with role enforced)
   - list-item → `listitem`
   - table / row / cell → `table` / `row` / `cell`
   - image → `img` with `alt` (needs alt-text support in the image
     component's properties — see [issue 02](02-untyped-properties-schema.md)).
7. For selection changes, expose live region updates so screen readers
   announce them.
8. For copy, also emit `text/html` carrying the structure.
9. Add tests using axe-core or a similar a11y test runner.

## Test impact

- A11y test suite using axe / pa11y / @testing-library accessibility
  matchers.
- Snapshot tests for the AT tree given a state tree.
- Browser Find should work in a real Chromium test.

## See also

- [issue 08](08-editor-controller-srp.md) — modular controller is a
  prerequisite for cleanly adding the AT tree as another module.
- [issue 02](02-untyped-properties-schema.md) — image alt text /
  table summaries belong on properties.
- [architecture/07 DOM controller](../architecture/07-dom-controller.md)

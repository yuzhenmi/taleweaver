# Issue 08 — `editor-controller.ts` does ten jobs in 790 lines (Significant)

## Summary

`createEditorController` is a single factory function that constructs and
manages the entire DOM side of the editor. It owns DOM construction,
mouse handling, keyboard handling, IME, clipboard, focus, cursor blink,
smooth scroll, scroll-parent detection, IntersectionObserver canvas
pooling, DPR, single-vs-paginated mode switching, and the paint loop.
The closure captures roughly 30 mutable variables and references.

## Where it manifests

`packages/dom/src/editor-controller.ts` — 790 lines, one function returning
`{ update, focus, destroy }`.

The corresponding test file `editor-controller.test.ts` is 1,321 lines.

Local closure state (line 51–112):

```
state, focused, cursorVisible, blinkIntervalId, scrollRafId, scrollAnimId,
isDragging, dragAnchor, isComposing, destroyed, imageCache, cursorPos,
selectionRects, pages, scrollParent, textarea, spacerDiv, singleCanvas,
singleCtx, pageSlots, activeCanvases, canvasPool, intersectionObserver
```

## Why it's a problem

1. **Single-Responsibility Principle violated.** Ten responsibilities
   mean ten reasons for the file to change.
2. **Hard to extend.** Adding touch input, accessibility tree, or
   spell-check overlay requires editing this monolith.
3. **Hard to test in isolation.** The test file is enormous because it
   has to set up DOM + dispatch + state for every concern. Smaller modules
   could be tested in isolation.
4. **Shared mutable state.** Variables like `cursorPos`, `pages`,
   `selectionRects` are recomputed in `update()` and read in
   `paint()`, `paintPages()`, `scrollCursorIntoView()`, `handleMouseDown()`.
   Refactoring is fragile because every reader/writer must move
   together.
5. **Mode switching is structural.** `syncDom` (lines 312–371) tears
   down and rebuilds DOM whenever single-vs-paginated changes; this
   logic is interleaved with non-mode concerns.

## Fix options

### Option A — split into focused modules with a thin orchestrator

```
dom/
├── editor-controller.ts        ~150 lines — orchestration + lifecycle
├── controller/
│   ├── dom-builder.ts            container chrome, textarea
│   ├── paint-loop.ts             paint() entry, blink, rAF orchestration
│   ├── canvas-pool.ts            single + paginated canvas management
│   ├── viewport-observer.ts      IntersectionObserver, scroll-parent detect
│   ├── mouse.ts                  mousedown / move / up / detail click rules
│   ├── keyboard.ts               keydown wiring (mapKeyEvent already isolated)
│   ├── ime.ts                    compositionstart / end + input
│   ├── clipboard.ts              copy / cut / paste
│   ├── focus.ts                  focus / blur, blink driver
│   ├── scroll.ts                 smoothScrollTo, scrollCursorIntoView
│   └── controller-state.ts       shared mutable bag passed by reference
```

Pros: every module has one job; testable in isolation; new concerns
get new files instead of editing the monolith.
Cons: more files; the shared mutable state object becomes the new
coupling surface (but it's explicit).

### Option B — drive everything from the controller-state via observers

Make `controllerState` a pub/sub object. Modules subscribe to changes
and react. This is what Lexical's editor does internally.

Pros: clean decoupling; new modules drop in.
Cons: heavier abstraction; harder to follow than direct calls.

### Option C — keep the monolith, add file-internal section markers

Lightweight: split the file into sections with banner comments and
move helpers to top-level functions. No structural change.

Pros: ~zero risk; enforces minor discipline.
Cons: doesn't fix the underlying SRP issue.

**Recommendation:** Option A. Each module is a few dozen lines, the
shared state object is small (10–15 fields), and testing improves
dramatically.

## Concrete plan for Option A

1. Define `ControllerState`:

   ```ts
   interface ControllerState {
     editorState: EditorState | null;
     focused: boolean;
     destroyed: boolean;
     isDragging: boolean;
     dragAnchor: Position | null;
     isComposing: boolean;
     cursorPos: PixelPosition;
     selectionRects: SelectionRect[];
     pages: LayoutBox[];
     scrollParent: HTMLElement | Window;
   }
   ```

2. Define DOM elements bundle (`textarea`, `singleCanvas`, `pageSlots`,
   `canvasPool`, etc.).

3. Each helper module exports a factory `(deps) => { handlers, dispose }`.
   `editor-controller.ts` wires them up:

   ```ts
   const state: ControllerState = ...;
   const dom = createDomBuilder(container);
   const canvasPool = createCanvasPool(container, dom.textarea);
   const paint = createPaintLoop(dom, state, options);
   const mouse = createMouseHandler(state, dispatch, ...);
   const keyboard = createKeyboardHandler(dom.textarea, dispatch);
   ...
   ```

4. The public API (`update`, `focus`, `destroy`) is a tiny adapter at
   the top.

5. Tests can target individual modules — `mouse.test.ts`, `clipboard.test.ts`,
   etc.

## Test impact

- `editor-controller.test.ts` 1,321 lines splits into ~10 focused
  test files of 100–200 lines each.
- Easier to add tests for edge cases (e.g. clipboard with no selection
  is its own file, not buried in a 1,300-line list).

## See also

- [architecture/07 DOM controller](../architecture/07-dom-controller.md)
- [issue 12](12-accessibility-gap.md) — adding an accessibility tree
  is much easier in a modular controller.

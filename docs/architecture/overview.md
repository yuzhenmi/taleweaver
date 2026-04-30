# Overview

Taleweaver is a TypeScript engine for laying out and rendering rich text
documents. It produces queryable document geometry — line breaks, page
boundaries, hit-test results, selection rectangles — on which consumers
build editing UI, collaborative editing, PDF export, and accessibility
tooling.

## Packages

The engine ships as three packages with a strict one-way dependency:

    @taleweaver/react ─► @taleweaver/dom ─► @taleweaver/core

- **`@taleweaver/core`** — the pure engine. Owns the document model, the
  multi-stage rendering pipeline, the editor reducer, and platform-agnostic
  geometry queries. Imports nothing DOM-shaped; runs in any JavaScript
  runtime.

- **`@taleweaver/dom`** — the browser-canvas host. Owns the canvas painter,
  browser input handlers, scroll/blink/cursor animation, and a default
  canvas-based text shaper. Imports `core`.

- **`@taleweaver/react`** — the React adapter. Wraps `dom`'s controller
  in a hook and a component so a React application can drop the engine
  into its tree without touching the DOM controller directly. Imports
  both `core` and `dom`.

Examples (`examples/react/`, `examples/dom/`) are reference applications
that demonstrate wiring; they are not part of the engine.

## Touchpoints between packages

Four interfaces define how the packages connect.

**State transitions.** A host (`dom`, or another consumer) submits user
actions to `core` and receives back a new document state. `core` exposes
a single reducer for this; the host is responsible for dispatching
actions in response to events. State is immutable — every action
produces a fresh state.

**Geometry queries.** A host reads geometry from `core` to translate
between pointer pixels and document positions, place cursors, and emit
selection rectangles. These are pure functions over the layout tree that
`core` cached as part of the most recent state.

**Text shaping.** `core` does not own text shaping. It defines a shaper
interface — give me positioned glyphs, cluster boundaries, break
opportunities, and font metrics for this text in this style — and
consumes shaped output throughout the layout pipeline. Hosts (or
third-party packages) implement the interface; `dom` ships a
canvas-based default.

**Editor controller.** `dom` exposes a controller that owns one HTML
container — paints into it, listens for input on it, animates the cursor,
syncs scroll. `react` instantiates one per `<EditorView>` mount and
forwards lifecycle events.

## Build & tooling

The repository is an npm workspaces monorepo.

- **Layout.** Three workspace packages under `packages/` (`core`, `dom`, `react`) plus example apps under `examples/` (`react`, `dom`). Each package has its own `package.json` and `tsconfig.json`.
- **Language.** TypeScript throughout; strict mode. `tsc` is the build tool for library packages (`packages/*/dist`); the example apps use Vite for bundling.
- **Test runner.** Vitest. Tests are colocated as `*.test.ts` next to each source file. `npm test --workspace=<pkg>` from the repo root runs one package's suite.
- **Type-checking.** `npm run build --workspace=<pkg>` runs `tsc` and emits declarations.
- **Node version.** v24.14 via nvm (pinned in `.nvmrc`).
- **File naming.** kebab-case across the codebase (`packages/core/src/cascade/cascade-pass.ts`).
- **Dependency direction enforcement.** Per-package `tsconfig.json` controls `paths` and `references` so `core` cannot import from `dom` or `react`; `dom` cannot import from `react`. `core` has no runtime dependencies on browser APIs.

## Reading order

To get a complete understanding of how the software works, read in
dependency order so each layer's surface is grounded by the time you
reach its consumer:

1. [`1-core/overview.md`](1-core/overview.md) — core's modules and the
   rendering pipeline. Defines the data structures (`StateNode`,
   `RenderNode`, `LayoutBox`, `EditorState`) and the contracts the host
   depends on.
2. [`2-dom/overview.md`](2-dom/overview.md) — dom's modules: controller,
   canvas renderer, paint cache, default text shaper.
3. [`3-react/overview.md`](3-react/overview.md) — react's modules:
   `useEditor`, `<EditorView>`.
4. [`state-of-branch.md`](state-of-branch.md) — current implementation
   status against the target architecture.

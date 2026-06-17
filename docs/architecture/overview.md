# Overview

Taleweaver is a TypeScript engine for laying out and rendering rich text
documents. It produces queryable document geometry — line breaks, page
boundaries, hit-test results, selection rectangles — on which consumers
build editing UI, collaborative editing, PDF export, and accessibility
tooling.

## Packages

The engine ships as a host-chain of packages with a strict one-way dependency,
plus a layout-tree-consuming export package and injected-capability packages:

    @taleweaver/react   ─► @taleweaver/print ─► @taleweaver/core
    @taleweaver/digital ─────────────────────► @taleweaver/core
    @taleweaver/pdf     ─► @taleweaver/print ─► @taleweaver/core
                           @taleweaver/hyphenation-en-us ─► @taleweaver/core (type-only)

- **`@taleweaver/core`** — the **headless, geometry-free** engine. Owns the
  document model, the multi-stage rendering pipeline (styled-tree producer), the
  editor reducer, the document-level text-core mechanics (UAX #14 line-break,
  UAX #9 bidi, grapheme clustering, the `TextShaper`/`TextMeasurer` interfaces,
  intrinsic-size measurement, the `mat2d` transform primitive), and the
  **geometry-free selection model** (selection, cursor-ops, object-selection,
  grapheme-stepping). It owns NO positioned geometry — no paginated box layout,
  no caret rectangles, no hit-testing. Imports no sibling `@taleweaver` package
  and nothing DOM-shaped; runs in any JavaScript runtime, and is separately
  publishable. A `dependency-cruiser` rule enforces the geometry-free boundary
  (see below).

- **`@taleweaver/print`** — the **geometric backend + browser-canvas host**.
  Owns the paginated layout engine (BFC/IFC/table-FC, fragmentation/pagination,
  the virtual-layout-tree), the geometric cursor math (hit-test, cursor-position,
  line-navigation, selection-geometry, line-bidi, the line/atomic-box indices),
  the canvas painter, browser input handlers, scroll/blink/cursor animation, a
  default canvas-based text shaper, and the **concrete Knuth-Liang hyphenation
  algorithm** (`createLiangHyphenator(languages)`, a pure trie that resolves a
  host-supplied map of per-language `PatternSet`s — see the per-language data
  packages below). Imports `core`.

- **`@taleweaver/digital`** — the **DOM-flow (browser-native) backend**. Drives
  the same `core` document model but lets the browser flow the styled tree
  instead of computing print geometry; ships NO layout engine (its dependency
  closure includes none of `print`'s geometric layout). Imports `core` only. See
  [`3-digital/overview.md`](3-digital/overview.md).

- **`@taleweaver/react`** — the React adapter. Wraps `print`'s controller
  in a hook and a component so a React application can drop the engine
  into its tree without touching the DOM controller directly. Imports
  both `core` and `print`.

- **`@taleweaver/hyphenation-<lang>`** (e.g. `@taleweaver/hyphenation-en-us`) —
  per-language hyphenation **pattern data**, one published package per language.
  Each exports a single `PatternSet` (the Knuth-Liang patterns + exceptions for
  that language, e.g. `EN_US_PATTERN_SET`). The host composes the languages it
  needs into `createLiangHyphenator({ en: EN_US_PATTERN_SET, ... })` (the
  algorithm lives in `print`) and injects the result via `LayoutConfig.hyphenator`.
  Data is split per language so a host pulls in only the dictionaries it uses and
  heavy pattern tables stay out of `core`'s and `print`'s hot path. Depends on
  `core` for the `PatternSet` type only (type-only import).

- **`@taleweaver/pdf`** — the PDF export emitter. A layout-tree consumer (peer
  of `print`'s canvas renderer, not a serializer of `State`): it walks a
  positioned `PageBox` tree and emits PDF content-stream operators. Phase (a)
  ships standard-14 text + page geometry; embedded fonts, graphics, and images
  are later whole-feature phases. Platform-agnostic and zero-dependency; the
  font program is an injected `PdfFontProvider` capability (the default is a
  standard-14 provider). Depends on `print` for the geometric layout-tree types
  it walks (`PageBox`, `LayoutBox`, `sourceBlockIdOf`, `markerOwnerKey`,
  `PdfOutlineNode`) and on `core` for the geometry-free types/helpers it reuses
  (`ComputedStyle`, `physicalBorderSides`, `isOpenableLinkUrl`). The dependency is
  one-way `pdf → print → core` (no back-edge: `print` imports no `pdf` symbol; the
  host injects `createPdfEmitter` into the controller). See
  [`5-pdf/overview.md`](./5-pdf/overview.md).

Examples (`examples/react/`, `examples/dom/`) are reference applications
that demonstrate wiring; they are not part of the engine.

### Headless boundary: `@taleweaver/core` imports no sibling package

The geometric layout engine and the geometry-dependent cursor math live in
`@taleweaver/print`, NOT in `core`. `core` is the headless, geometry-free brain;
the geometry it once held has moved into `print`:

- **moved to `print/src/layout/`** — the paginated box layout engine (BFC/IFC/
  table-FC), fragmentation/pagination, the virtual-layout-tree, used-style
  resolution, and the layout-tree node types (`LayoutBox`/`BlockBox`/`LineBox`/
  `TextRunBox`, `PageBox`).
- **moved to `print/src/cursor/`** — the geometric cursor math (hit-test,
  cursor-position, line-navigation, selection-geometry, line-bidi, line/atomic-box
  indices, suggestion/comment rects).
- **stays in `core`** — the document/text-core mechanics that need no positioned
  geometry: the text-core in `core/src/layout/` (UAX #14 line-break, UAX #9 bidi,
  grapheme clustering, the `TextShaper`/`TextMeasurer` interfaces, intrinsic-size
  measurement, `mat2d`, `dev-mode`), and the geometry-free selection model in
  `core/src/cursor/` (`selection.ts`, `cursor-ops.ts`, `grapheme-utils.ts`,
  `object-selection.ts`).

A `dependency-cruiser` rule (`packages/core/.dependency-cruiser.cjs`, run via
`npm run lint:boundaries`) is the mechanical guard: `core`'s production source
must import **no** sibling `@taleweaver` package (`print` / `digital` / `pdf` /
`react`). The rule is type-aware (`tsPreCompilationDeps` catches `import type`
couplings too, so `core`'s emitted `.d.ts` cannot reference a sibling's types),
making `core` a separately-publishable headless package. Tests / test-utils /
integration are exempt — they legitimately import `@taleweaver/print` to exercise
the relocated engine. This boundary is the foundation that lets the same `core`
brain drive both the `print` backend (computes geometry) and the `digital`
backend (the browser flows the styled tree). See
`2-print/overview.md` (the geometric engine + backend driver) and
`state-of-branch.md` for current status.

## Touchpoints between packages

Five interfaces define how the packages connect.

**State transitions.** A host (`print`, or another consumer) submits user
actions to `core` and receives back a new document state. `core` exposes
a single reducer for this; the host is responsible for dispatching
actions in response to events. State is immutable — every action
produces a fresh state.

**Geometry queries.** A host reads positioned geometry from `print` to translate
between pointer pixels and document positions, place cursors, and emit
selection rectangles. These are pure functions over the layout tree that
`print` computes from `core`'s state (`core` itself owns no positioned geometry).

**Text shaping.** `core` does not own text shaping. It defines a shaper
interface — give me positioned glyphs, cluster boundaries, break
opportunities, and font metrics for this text in this style — and
consumes shaped output throughout the layout pipeline. Hosts (or
third-party packages) implement the interface; `print` ships a
canvas-based default.

**Editor controller.** `print` exposes a controller that owns one HTML
container — paints into it, listens for input on it, animates the cursor,
syncs scroll. `react` instantiates one per `<EditorView>` mount and
forwards lifecycle events.

**Layout-tree export.** `pdf` consumes the same positioned `PageBox` tree the
canvas renderer paints, walking it to emit PDF content streams. Like the
geometry queries, it reads `print`'s final layout geometry and re-derives
nothing; its layout-tree types come from `print`, its geometry-free types from
`core`.

## Build & tooling

The repository is an npm workspaces monorepo.

- **Layout.** Workspace packages under `packages/` (`core`, `print`, `digital`, `react`, the per-language `hyphenation-<lang>` data packages, `pdf`) plus example apps under `examples/` (`react`, `dom`). Each package has its own `package.json` and `tsconfig.json`.
- **Language.** TypeScript throughout; strict mode. `tsc` is the build tool for library packages (`packages/*/dist`); the example apps use Vite for bundling.
- **Test runner.** Vitest. Tests are colocated as `*.test.ts` next to each source file. `npm test --workspace=<pkg>` from the repo root runs one package's suite.
- **Type-checking.** `npm run build --workspace=<pkg>` runs `tsc` and emits declarations.
- **Node version.** v24.14 via nvm (pinned in `.nvmrc`).
- **File naming.** kebab-case across the codebase (`packages/core/src/cascade/cascade-pass.ts`).
- **Dependency direction enforcement.** A `dependency-cruiser` rule (`packages/core/.dependency-cruiser.cjs`, `npm run lint:boundaries`) forbids `core`'s production source from importing any sibling `@taleweaver` package (`print`/`digital`/`pdf`/`react`); `print` does not import `react`. `core` has no runtime dependencies on browser APIs.
- **Headless (no-DOM-global) enforcement.** `core`'s regular `tsc` build enables the `DOM` lib for a tests-only type edge (its test scaffolding imports `@taleweaver/print`, whose barrel transitively references DOM-typed modules). A second typecheck, `npm run typecheck:headless --workspace=packages/core` (`packages/core/tsconfig.headless.json`), drops the `DOM` lib and excludes that tests-only edge, so any DOM global (`document` / `window` / `HTMLElement` / canvas types) used in `core`'s **production** source fails to typecheck. Together with the dependency-cruiser rule (which catches sibling-import creep), this guards core's headless invariant from both directions. Both checks are manual (like `lint:boundaries`) — run them before committing changes to core's production source; neither runs in the deploy CI.

## Zero-runtime-dependencies invariant

`@taleweaver/core` and `@taleweaver/print` ship with **zero** runtime npm dependencies. Their `package.json` `dependencies` block is empty; their only manifest entries are `devDependencies` (TypeScript, Vitest) and, for `print`, a `peerDependency` on `@taleweaver/core`. Bundling third-party libraries into either package is not allowed.

`@taleweaver/react` carries `peerDependencies` on `react` and `react-dom` (necessarily — it is a React adapter) plus on the two upstream Taleweaver packages. No other runtime dependencies.

Consequences for the architecture:

- **Unicode algorithms (UAX #9 / #14 / #29).** The shaper segments text into **grapheme clusters** (UAX #29) via `Intl.Segmenter` (a built-in browser/Node API, not a dependency) — each cluster is one shaper cluster, and cursor/selection/delete snap to cluster boundaries. **UAX #14 line-break is implemented** — a hand-rolled, conformant rule engine (`layout/uax14/`, passing the full `LineBreakTest.txt` conformance suite) with a vendored, committed Unicode break-property table; it feeds the shapers' break opportunities and drives the IFC wrap loop (CJK ideographs wrap, NBSP/`GL` glue holds, hyphens break). **UAX #9 bidi is implemented** (P4, in-browser smoke pending) — a hand-rolled, conformant algorithm (`layout/uax9/`, 100% on `BidiTest.txt` + `BidiCharacterTest.txt`) wired per paragraph (`resolveParagraphBidi`), reordered per line into physical/visual geometry (`reorderLineForBidi`), painted right-to-left for odd-level runs, and read by the cursor layer for RTL caret/hit-test/selection/navigation (see `1-core/1.5-editor.md` "Bidi cursor").
- **Hyphenation.** `hyphens: auto` uses an injected `Hyphenator` capability (`LayoutConfig.hyphenator`) — NOT a shaper callback. Core defines the interface + a mock + the `PatternSet` data type; the concrete Knuth-Liang algorithm (`createLiangHyphenator(languages)`) ships in `@taleweaver/print`, and per-language pattern data ships one package per language (`@taleweaver/hyphenation-en-us`, …) — each exporting a single `PatternSet`. A host composes the languages it needs (`createLiangHyphenator({ en: EN_US_PATTERN_SET, … })`) and wires the result via `LayoutConfig.hyphenator`. Heavy per-language dictionaries are not bundled into `core`/`print`; a host pulls in only the data packages it uses. With no hyphenator configured (or an empty language map), `auto` falls back to `manual` (the correct CSS UA behavior).
- **Heavier text shapers (e.g., HarfBuzz).** Layered as separate packages (`@taleweaver/shaper-harfbuzz`) that the consumer optionally installs. Such packages can have their own runtime dependencies; they implement the `TextShaper` interface and the consumer wires them in via `LayoutConfig.measurer`.
- **Embedded media, charts, equations.** Same pattern — separate optional packages plug in via custom render-fn `ComponentDefinition`s.

This invariant keeps the engine's footprint predictable and small. Consumers pay only for the features they use.

## Reading order

To get a complete understanding of how the software works, read in
dependency order so each layer's surface is grounded by the time you
reach its consumer:

1. [`1-core/overview.md`](./1-core/overview.md) — core's modules and the
   rendering pipeline. Defines the geometry-free data structures (`State` /
   `Block`, `RenderNode`, `EditorState`) and the contracts the host depends on.
2. [`2-print/overview.md`](./2-print/overview.md) — print's modules: the geometric
   layout engine + cursor (`LayoutBox`/`PageBox`), controller, canvas renderer,
   paint cache, default text shaper.
3. [`3-digital/overview.md`](./3-digital/overview.md) — digital's modules: the
   read-only DOM viewer (`renderDocumentToDom`) that flows the styled tree as
   browser-native DOM, no layout engine.
4. [`4-react/overview.md`](./4-react/overview.md) — react's modules:
   `useEditor`, `<EditorView>`.
5. [`5-pdf/overview.md`](./5-pdf/overview.md) — pdf's modules: the PDF
   object writer, coordinate transform, content-stream builder, font
   provider, page emitter, and `emitPdf` orchestration.
6. [`state-of-branch.md`](./state-of-branch.md) — current implementation
   status against the target architecture.

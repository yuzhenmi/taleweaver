# P7 — Render Module Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new render module that consumes Y.Doc-backed `State` and produces `RenderNode` trees, dispatching through a new component registry. Runs in parallel with the legacy renderer (per Path B) — legacy stays callable for the existing editor path through the P11.4 cutover.

**Architecture:** New `render(state, registry): { root: RenderNode, embedContents: ReadonlyMap<BlockId, RenderNode> }`. Walker reads `State` top-down via `getBlock` / `getEmbedContent`; for each block, runs cascade interpreters on `attrs` to compose `computedStyle`, constructs `ContainerBlockView` or `LeafBlockView` per Decision B (split discriminated union), dispatches to the new typed `ComponentDefinition` via the new `ComponentRegistry` (Decision F). For leaf blocks, expands `inlineContent.items` directly into TextBox/ElementBox RenderNodes (no `text`/`span` component dispatch per master spec line 509). Embed-content blocks (footnote bodies) render as a parallel `embedContents` map keyed by id — pagination consumes them later.

**Tech Stack:** TypeScript, Vitest, existing cascade pipeline (`attrRegistry`, `composeComputed`, `resolveLength`).

## Resolved spec questions

- **Open Q 4 (footnote rendering destination):** new renderer returns `{ root: RenderNode; embedContents: ReadonlyMap<BlockId, RenderNode> }`. Pagination (P1.C, later phase) consumes the map.
- All other open questions resolved by Decisions B / E / F.

---

## File Structure

**Renamed in P7 (Decision E `-legacy` suffix):**
- `packages/core/src/components/component-definition.ts` → `component-definition-legacy.ts`
- `packages/core/src/components/component-registry.ts` → `component-registry-legacy.ts`
- `packages/core/src/render/render.ts` → `render-legacy.ts`
- `packages/core/src/render/render.test.ts` → `render-legacy.test.ts`

**Consolidated in P7 (Decision E):**
- `packages/core/src/render/render-node-v2.ts` content moved into `render-node.ts`. `render-node-v2.ts` and `render-node-v2.test.ts` deleted; `render-node.test.ts` takes the tests.

**Created (new canonical names):**
- `packages/core/src/components/component-definition.ts` — new `ContainerComponentDefinition | LeafComponentDefinition` union per Decision B.
- `packages/core/src/components/component-registry.ts` — new constructor-injectable `ComponentRegistry` per Decision F. Includes `createComponentRegistry()` (empty) and `createDefaultComponentRegistry()` (currently empty — P8 populates with migrated components).
- `packages/core/src/render/block-view.ts` — `BlockView` types (`ContainerBlockView`, `LeafBlockView`, discriminated union) + `RenderContext` interface.
- `packages/core/src/render/render.ts` — new renderer. Returns `{ root: RenderNode, embedContents: ReadonlyMap<BlockId, RenderNode> }`.
- Test files alongside each new module.

**Modified (legacy consumer import path updates):**
- Every `components/*.ts` (legacy components — switch imports to `component-definition-legacy` + `component-registry-legacy`).
- Every legacy renderer consumer (integration tests, `editor/editor-state.ts`, `editor/actions/helpers.ts`, `layout/paginate.test.ts`, `cascade/cascade-pass.ts`, `packages/core/src/index.ts`) — switch render imports to `render-legacy` and render-node-v2 imports to `render-node`.

---

## Sub-phase ordering

Every commit goes green. Mechanical renames first; new types + new renderer second.

1. T1: Rename legacy component types (`component-definition.ts`, `component-registry.ts`) to `-legacy` suffix; update all consumers (components + render + index.ts). Single atomic commit.
2. T2: Consolidate `render-node-v2.ts` into `render-node.ts`; delete `-v2`; update consumers. Single atomic commit.
3. T3: Rename `render.ts` → `render-legacy.ts`; update all consumers. Single atomic commit.
4. T4: Add new `component-definition.ts` (Decision B types).
5. T5: Add new `component-registry.ts` (Decision F shape; empty defaults factory).
6. T6: Add `render/block-view.ts` (BlockView + RenderContext types).
7. T7: Add new `render.ts` — minimal walker + dispatch (no embed-content rendering yet).
8. T8: Extend new `render.ts` for embed-content (footnote zones).
9. T9: Final verification (build + test sweep; ≥15 tests on the new renderer).

---

## T1: Rename legacy component types to `-legacy` suffix

**Files (atomic commit, all imports updated together):**
- Rename: `packages/core/src/components/component-definition.ts` → `packages/core/src/components/component-definition-legacy.ts`
- Rename: `packages/core/src/components/component-definition.test.ts` → `packages/core/src/components/component-definition-legacy.test.ts`
- Rename: `packages/core/src/components/component-registry.ts` → `packages/core/src/components/component-registry-legacy.ts`
- Modify: every `packages/core/src/components/<name>.ts` that imports from `component-definition` or `component-registry` — switch import paths.
- Modify: `packages/core/src/render/render.ts` (legacy renderer) — switch `ComponentRegistry` import path.
- Modify: `packages/core/src/components/index.ts` — re-export from `-legacy` paths.
- Modify: `packages/core/src/index.ts` — re-export `ComponentRegistry`/`ComponentDefinition` types from `-legacy` paths under the same names (preserves the public API surface for the editor's current consumers; P8 will introduce new-shape exports).

### Steps

- [ ] **S1: Audit imports**

```bash
grep -rln "from.*component-definition\"\|from.*component-registry\"" /Users/hansyu/code/taleweaver/packages/core/src/ /Users/hansyu/code/taleweaver/packages/dom/src/ /Users/hansyu/code/taleweaver/packages/react/src/ 2>/dev/null
```

Should list all consumer files. Save this list — every one needs an import path update.

- [ ] **S2: Rename via git mv**

```bash
git mv /Users/hansyu/code/taleweaver/packages/core/src/components/component-definition.ts /Users/hansyu/code/taleweaver/packages/core/src/components/component-definition-legacy.ts
git mv /Users/hansyu/code/taleweaver/packages/core/src/components/component-definition.test.ts /Users/hansyu/code/taleweaver/packages/core/src/components/component-definition-legacy.test.ts
git mv /Users/hansyu/code/taleweaver/packages/core/src/components/component-registry.ts /Users/hansyu/code/taleweaver/packages/core/src/components/component-registry-legacy.ts
```

Note: `component-registry.test.ts` doesn't exist per `ls` audit. If a test file for the registry exists, rename it too.

- [ ] **S3: Update every consumer**

For each file in the S1 audit list, replace:
- `from "./component-definition"` → `from "./component-definition-legacy"` (within `components/` dir)
- `from "./component-registry"` → `from "./component-registry-legacy"` (within `components/` dir)
- `from "../components/component-definition"` → `from "../components/component-definition-legacy"`
- `from "../components/component-registry"` → `from "../components/component-registry-legacy"`

These edits are mechanical; use `find . -name "*.ts" -exec sed -i ...` if you trust your sed (BSD sed needs `-i ''`), or hand-edit.

- [ ] **S4: Update `components/index.ts` and `core/src/index.ts`**

In `components/index.ts`, re-export `ComponentDefinition`, `ComponentRegistry`, `createRegistry` from the `-legacy` paths.

In `core/src/index.ts`, the existing `ComponentRegistry` / `ComponentDefinition` re-exports should still point at the legacy file (which now lives at `-legacy.ts`). Verify nothing breaks; the public API surface should look identical.

- [ ] **S5: Build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -5
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean. All 1267 tests pass.

- [ ] **S6: Commit**

```bash
git add -A packages/core/src/components/ packages/core/src/render/ packages/core/src/index.ts
git commit -m "refactor(p7): rename component-definition/registry → -legacy (decision E)"
```

## Constraints

- File contents are byte-equivalent to before the rename; only the FILENAMES and import paths change.
- All tests still pass.
- NO new types defined here (T4 does that).

---

## T2: Consolidate `render-node-v2.ts` into `render-node.ts`

**Files:**
- Modify: `packages/core/src/render/render-node.ts` — replace barrel with the actual content from `render-node-v2.ts`.
- Delete: `packages/core/src/render/render-node-v2.ts`
- Delete: `packages/core/src/render/render-node-v2.test.ts`
- Move tests: `packages/core/src/render/render-node-v2.test.ts` content into `packages/core/src/render/render-node.test.ts` (preserve file via git mv if cleaner).
- Modify: every consumer of `render-node-v2` — switch imports to `render-node`.

### Steps

- [ ] **S1: Audit consumers**

```bash
grep -rln "from.*render-node-v2" /Users/hansyu/code/taleweaver/packages/core/src/ /Users/hansyu/code/taleweaver/packages/dom/src/ /Users/hansyu/code/taleweaver/packages/react/src/ 2>/dev/null
```

- [ ] **S2: Move the test file via git**

```bash
git mv /Users/hansyu/code/taleweaver/packages/core/src/render/render-node-v2.test.ts /Users/hansyu/code/taleweaver/packages/core/src/render/render-node.test.ts
```

Edit the test file's import: `from "./render-node-v2"` → `from "./render-node"`.

- [ ] **S3: Replace `render-node.ts` contents**

Open `render-node.ts`. It currently has only `export * from "./render-node-v2";`. Replace its entire contents with the contents of `render-node-v2.ts`.

```bash
cp /Users/hansyu/code/taleweaver/packages/core/src/render/render-node-v2.ts /Users/hansyu/code/taleweaver/packages/core/src/render/render-node.ts
```

Then delete `render-node-v2.ts`:

```bash
git rm /Users/hansyu/code/taleweaver/packages/core/src/render/render-node-v2.ts
```

- [ ] **S4: Update consumer imports**

For each file in S1, replace `from "../render/render-node-v2"` → `from "../render/render-node"` (and equivalents for relative paths).

- [ ] **S5: Build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -5
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean.

- [ ] **S6: Commit**

```bash
git add -A packages/core/src/render/ packages/core/src/components/ packages/core/src/cascade/ packages/core/src/layout/
git commit -m "refactor(p7): consolidate render-node-v2 into render-node (delete v2 suffix)"
```

(Stage whatever files actually changed — the commit should touch ONLY consumer-import updates and the render-node files. Don't include unrelated changes.)

## Constraints

- File contents preserved byte-for-byte (just relocated).
- All tests pass.

---

## T3: Rename `render.ts` → `render-legacy.ts`

**Files (atomic commit):**
- Rename: `packages/core/src/render/render.ts` → `packages/core/src/render/render-legacy.ts`
- Rename: `packages/core/src/render/render.test.ts` → `packages/core/src/render/render-legacy.test.ts`
- Modify: every consumer of the legacy `renderTree`/`renderTreeIncremental` — switch imports to `render-legacy`. From the earlier audit: ~14 files (integration tests, layout/paginate.test.ts, editor-state.ts, editor/actions/helpers.ts, packages/core/src/index.ts).

### Steps

- [ ] **S1: Audit consumers (already done — list the 14 files)**

```bash
grep -rln "from.*render/render\"\|from \"./render\"" /Users/hansyu/code/taleweaver/packages/core/src/ /Users/hansyu/code/taleweaver/packages/dom/src/ /Users/hansyu/code/taleweaver/packages/react/src/ 2>/dev/null | grep -v "render-node\|render-legacy"
```

- [ ] **S2: Rename via git mv**

```bash
git mv /Users/hansyu/code/taleweaver/packages/core/src/render/render.ts /Users/hansyu/code/taleweaver/packages/core/src/render/render-legacy.ts
git mv /Users/hansyu/code/taleweaver/packages/core/src/render/render.test.ts /Users/hansyu/code/taleweaver/packages/core/src/render/render-legacy.test.ts
```

- [ ] **S3: Update consumers**

For each file in S1, replace `from "../render/render"` → `from "../render/render-legacy"` (and equivalents).

- [ ] **S4: Update `core/src/index.ts` re-exports**

```typescript
// BEFORE:
export { renderTree, renderTreeIncremental } from "./render/render";

// AFTER:
export { renderTree, renderTreeIncremental } from "./render/render-legacy";
```

(The export names stay the same — preserves the public API surface.)

- [ ] **S5: Build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -5
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean.

- [ ] **S6: Commit**

```bash
git add -A packages/core/src/render/ packages/core/src/integration/ packages/core/src/layout/ packages/core/src/editor/ packages/core/src/index.ts
git commit -m "refactor(p7): rename render.ts → render-legacy.ts (decision E)"
```

## Constraints

- File contents preserved byte-for-byte.
- All tests pass.
- `core/src/index.ts` continues to export `renderTree`/`renderTreeIncremental` (just from the new path).

---

## T4: Add `render/block-view.ts` (BlockView + RenderContext types)

**Files:**
- Create: `packages/core/src/render/block-view.ts`
- Create: `packages/core/src/render/block-view.test.ts`

### Steps

- [ ] **S1: Write the failing test**

Create `packages/core/src/render/block-view.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  BlockView,
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "./block-view";
import type { BlockId } from "../state/block-id";
import type { InlineContent } from "../state/inline-content";
import type { ComputedStyle } from "../styles";

describe("block-view (types)", () => {
  it("ContainerBlockView has the documented shape", () => {
    const cs = {} as ComputedStyle; // tests only verify the shape compiles
    const view: ContainerBlockView = {
      id: "root" as BlockId,
      type: "document",
      attrs: Object.freeze({}),
      computedStyle: cs,
      kind: "container",
    };
    expect(view.kind).toBe("container");
    expect(view.id).toBe("root");
  });

  it("LeafBlockView has inlineContent and kind === 'leaf'", () => {
    const cs = {} as ComputedStyle;
    const content: InlineContent = Object.freeze({ items: Object.freeze([]) });
    const view: LeafBlockView = {
      id: "p1" as BlockId,
      type: "paragraph",
      attrs: Object.freeze({}),
      computedStyle: cs,
      kind: "leaf",
      inlineContent: content,
    };
    expect(view.kind).toBe("leaf");
    expect(view.inlineContent.items).toHaveLength(0);
  });

  it("BlockView is a discriminated union (kind narrows the shape)", () => {
    const cs = {} as ComputedStyle;
    const view: BlockView = {
      id: "root" as BlockId,
      type: "document",
      attrs: Object.freeze({}),
      computedStyle: cs,
      kind: "container",
    };
    if (view.kind === "container") {
      // type-narrows to ContainerBlockView; no inlineContent
      expect("inlineContent" in view).toBe(false);
    }
  });

  it("RenderContext provides state + view accessors", () => {
    // Compile-time shape check only.
    const ctx = null as unknown as RenderContext;
    if (ctx !== null) {
      const _v = ctx.getView("x" as BlockId);
      const _e = ctx.getEmbedContent("x" as BlockId);
      const _s = ctx.state;
    }
    expect(true).toBe(true);
  });
});
```

- [ ] **S2: Run the test (expected failure: module not found)**

```bash
npm test --workspace=packages/core -- "src/render/block-view.test" 2>&1 | tail -10
```

- [ ] **S3: Implement `packages/core/src/render/block-view.ts`**

```typescript
import type { BlockId } from "../state/block-id";
import type { ReadonlyAttrs } from "../state/attrs";
import type { InlineContent } from "../state/inline-content";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";

/**
 * Render-time view of a single block. Components receive this; the
 * renderer constructs it from the underlying State during traversal.
 *
 * Decision B (2026-05-15): push-model rendering. The renderer owns
 * traversal; components receive `childRenderNodes` (containers) or
 * `inlineRenderNodes` (leaves) pre-built. BlockView exposes only the
 * current block's own data — no `childIds`, no `parent` (cross-block
 * lookups go through `RenderContext`).
 *
 * `computedStyle` is pre-resolved by the renderer (cascade interpreters
 * + parent style + initial style). Components don't walk ancestors for
 * inherited values.
 */
export interface BlockViewBase {
  readonly id: BlockId;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly computedStyle: ComputedStyle;
}

/**
 * Container block: holds child blocks. The renderer pre-renders the
 * children and hands them to the component as `childRenderNodes`.
 */
export interface ContainerBlockView extends BlockViewBase {
  readonly kind: "container";
}

/**
 * Leaf block: holds inline content. The renderer expands inline items
 * (text runs into TextBoxes, embed items into ElementBoxes) and hands
 * them to the component as `inlineRenderNodes`.
 *
 * For atomic blocks (image, horizontal-line), `inlineContent.items` is
 * empty by convention; the component reads from `attrs` for rendering
 * inputs.
 */
export interface LeafBlockView extends BlockViewBase {
  readonly kind: "leaf";
  readonly inlineContent: InlineContent;
}

export type BlockView = ContainerBlockView | LeafBlockView;

/**
 * Render-time escape hatch for cross-block lookups (footnote-anchor →
 * footnote body via getEmbedContent; future cross-references via
 * getView). Keeps BlockView focused on "this block's data."
 *
 * `getView` returns a frozen BlockView for any id present in the main
 * tree. `getEmbedContent` does the same for embed-content blocks.
 * Both return `undefined` for unknown ids or if the block's `type`
 * isn't registered in the component registry.
 */
export interface RenderContext {
  readonly state: State;
  getView(id: BlockId): BlockView | undefined;
  getEmbedContent(id: BlockId): BlockView | undefined;
}
```

- [ ] **S4: Run tests**

```bash
npm test --workspace=packages/core -- "src/render/block-view.test" 2>&1 | tail -10
```

Expected: 4/4 pass.

- [ ] **S5: Verify build**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/render/block-view.ts packages/core/src/render/block-view.test.ts
git commit -m "feat(p7): add BlockView + RenderContext types (decision B)"
```

---

## T5: Add new `component-definition.ts` (Decision B types)

**Files:**
- Create: `packages/core/src/components/component-definition.ts`
- Create: `packages/core/src/components/component-definition.test.ts` (new — separate from `component-definition-legacy.test.ts`)

### Steps

- [ ] **S1: Write the failing test**

Create `packages/core/src/components/component-definition.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  ComponentDefinition,
  ContainerComponentDefinition,
  LeafComponentDefinition,
} from "./component-definition";
import type { RenderNode } from "../render/render-node";

describe("component-definition (new union)", () => {
  it("ContainerComponentDefinition is well-formed", () => {
    const def: ContainerComponentDefinition = {
      type: "document",
      kind: "container",
      render: (_view, _ctx, children) =>
        ({ type: "element", key: "doc", style: {}, children } as RenderNode),
    };
    expect(def.type).toBe("document");
    expect(def.kind).toBe("container");
  });

  it("LeafComponentDefinition is well-formed", () => {
    const def: LeafComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      render: (_view, _ctx, inlineChildren) =>
        ({ type: "element", key: "p", style: {}, children: inlineChildren } as RenderNode),
    };
    expect(def.type).toBe("paragraph");
    expect(def.kind).toBe("leaf");
  });

  it("ComponentDefinition is a discriminated union", () => {
    const defs: ComponentDefinition[] = [];
    defs.push({
      type: "document",
      kind: "container",
      render: (_v, _c, children) => ({ type: "element", key: "x", style: {}, children } as RenderNode),
    });
    defs.push({
      type: "paragraph",
      kind: "leaf",
      render: (_v, _c, children) => ({ type: "element", key: "x", style: {}, children } as RenderNode),
    });
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.kind)).toEqual(["container", "leaf"]);
  });
});
```

- [ ] **S2: Run test (expected failure)**

```bash
npm test --workspace=packages/core -- "src/components/component-definition.test" 2>&1 | tail -10
```

- [ ] **S3: Implement `packages/core/src/components/component-definition.ts`**

```typescript
import type {
  BlockView,
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "../render/block-view";
import type { RenderNode } from "../render/render-node";

/**
 * Component definition for a container block type. Receives a
 * ContainerBlockView, a RenderContext, and the pre-rendered children.
 *
 * Decision B (push-model rendering): the renderer walks the State,
 * dispatches by `view.type` to the right component (container or leaf),
 * and hands in already-rendered children. Components don't traverse —
 * they compose pre-rendered RenderNodes.
 */
export interface ContainerComponentDefinition {
  readonly type: string;
  readonly kind: "container";
  render(
    view: ContainerBlockView,
    context: RenderContext,
    childRenderNodes: ReadonlyArray<RenderNode>,
  ): RenderNode;
}

/**
 * Component definition for a leaf block type. Receives a LeafBlockView,
 * a RenderContext, and the pre-expanded inline items as RenderNodes
 * (TextBoxes for TextItems, ElementBoxes for EmbedItems).
 *
 * Per master spec § "Components" — `text` and `span` are NOT registered.
 * The renderer expands `view.inlineContent.items` directly into
 * `inlineRenderNodes`; leaf components receive them already built.
 */
export interface LeafComponentDefinition {
  readonly type: string;
  readonly kind: "leaf";
  render(
    view: LeafBlockView,
    context: RenderContext,
    inlineRenderNodes: ReadonlyArray<RenderNode>,
  ): RenderNode;
}

export type ComponentDefinition =
  | ContainerComponentDefinition
  | LeafComponentDefinition;

/**
 * BlockView passed to a component must match its declared kind. Helper
 * type used by the renderer's dispatch to narrow correctly.
 */
export type ViewForKind<K extends "container" | "leaf"> = K extends "container"
  ? ContainerBlockView
  : LeafBlockView;

// Re-export the underlying view types for convenience.
export type { BlockView, ContainerBlockView, LeafBlockView, RenderContext };
```

- [ ] **S4: Run tests**

```bash
npm test --workspace=packages/core -- "src/components/component-definition.test" 2>&1 | tail -10
```

Expected: 3/3 pass.

- [ ] **S5: Build verification**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/components/component-definition.ts packages/core/src/components/component-definition.test.ts
git commit -m "feat(p7): add new ComponentDefinition union (decision B)"
```

---

## T6: Add new `component-registry.ts` (Decision F shape)

**Files:**
- Create: `packages/core/src/components/component-registry.ts`
- Create: `packages/core/src/components/component-registry.test.ts`

### Steps

- [ ] **S1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  createComponentRegistry,
  createDefaultComponentRegistry,
  type ComponentRegistry,
} from "./component-registry";
import type { ComponentDefinition } from "./component-definition";
import type { RenderNode } from "../render/render-node";

describe("component-registry (new)", () => {
  it("createComponentRegistry returns an empty registry", () => {
    const reg = createComponentRegistry();
    expect(reg.has("paragraph")).toBe(false);
    expect(reg.get("paragraph")).toBeUndefined();
  });

  it("register adds a definition; get returns it", () => {
    const reg = createComponentRegistry();
    const def: ComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      render: (_v, _c, children) =>
        ({ type: "element", key: "p", style: {}, children } as RenderNode),
    };
    reg.register(def);
    expect(reg.has("paragraph")).toBe(true);
    expect(reg.get("paragraph")).toBe(def);
  });

  it("register replaces an existing definition with the same type", () => {
    const reg = createComponentRegistry();
    const a: ComponentDefinition = {
      type: "p",
      kind: "leaf",
      render: (_v, _c, c) => ({ type: "element", key: "a", style: {}, children: c } as RenderNode),
    };
    const b: ComponentDefinition = {
      type: "p",
      kind: "leaf",
      render: (_v, _c, c) => ({ type: "element", key: "b", style: {}, children: c } as RenderNode),
    };
    reg.register(a);
    reg.register(b);
    expect(reg.get("p")).toBe(b);
  });

  it("createDefaultComponentRegistry returns a registry (empty until P8 populates)", () => {
    // P7 ships the factory function with no built-in components; P8
    // adds them as it migrates each one to the new union type.
    const reg = createDefaultComponentRegistry();
    expect(reg.has("paragraph")).toBe(false); // will be true after P8
    expect(reg.has("document")).toBe(false);
  });
});
```

- [ ] **S2: Implement `packages/core/src/components/component-registry.ts`**

```typescript
import type { ComponentDefinition } from "./component-definition";

/**
 * Component registry for the new render pipeline. Constructor-injectable
 * per Decision F. Mutable via `register`; consumed by the new renderer
 * via `get` / `has`.
 *
 * Two factory functions:
 *   - createComponentRegistry(): empty registry; tests use it to isolate
 *     behavior (register only the components under test).
 *   - createDefaultComponentRegistry(): empty in P7; P8 populates it with
 *     every migrated built-in component via explicit register() calls.
 *     No side-effect imports.
 */
export interface ComponentRegistry {
  register(def: ComponentDefinition): void;
  get(type: string): ComponentDefinition | undefined;
  has(type: string): boolean;
}

class ComponentRegistryImpl implements ComponentRegistry {
  private readonly defs = new Map<string, ComponentDefinition>();

  register(def: ComponentDefinition): void {
    this.defs.set(def.type, def);
  }
  get(type: string): ComponentDefinition | undefined {
    return this.defs.get(type);
  }
  has(type: string): boolean {
    return this.defs.has(type);
  }
}

export function createComponentRegistry(): ComponentRegistry {
  return new ComponentRegistryImpl();
}

/**
 * Returns a registry pre-populated with all built-in components. In P7
 * the registry is empty (no components are yet migrated to the new
 * ComponentDefinition union). P8 migrates each built-in component and
 * adds explicit `register()` calls here.
 */
export function createDefaultComponentRegistry(): ComponentRegistry {
  return createComponentRegistry();
  // P8 will replace with:
  //   const reg = createComponentRegistry();
  //   reg.register(documentComponent);
  //   reg.register(paragraphComponent);
  //   ... etc.
  //   return reg;
}
```

- [ ] **S3: Run tests**

```bash
npm test --workspace=packages/core -- "src/components/component-registry.test" 2>&1 | tail -10
```

Expected: 4/4 pass.

- [ ] **S4: Build**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S5: Commit**

```bash
git add packages/core/src/components/component-registry.ts packages/core/src/components/component-registry.test.ts
git commit -m "feat(p7): add new ComponentRegistry with injectable factory (decision F)"
```

---

## T7: New `render.ts` — walker + dispatch + cascade integration

**Files:**
- Create: `packages/core/src/render/render.ts`
- Create: `packages/core/src/render/render.test.ts`

The new renderer:
- Takes `(state: State, registry: ComponentRegistry): RenderOutput`.
- Walks main tree from `state.rootId`. For each block:
  - Builds `BlockView` (Container or Leaf based on the registry's component kind for that type).
  - Composes `computedStyle` via cascade interpreters (using parent's computedStyle as base).
  - For containers, recurses into children, then calls the component's render with childRenderNodes.
  - For leaves, expands inline items into TextBox/ElementBox RenderNodes (no `text`/`span` dispatch), then calls render with inlineRenderNodes.
- Returns `{ root: RenderNode }` for now; embed-content handling lands in T8.
- Throws if a block type isn't registered (with the component-name context error pattern from prior phases).
- Cycle defense via a visited set during traversal.

### Steps

- [ ] **S1: Write the failing test**

Create `packages/core/src/render/render.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { render, type RenderOutput } from "./render";
import { createComponentRegistry } from "../components/component-registry";
import type {
  ContainerComponentDefinition,
  LeafComponentDefinition,
} from "../components/component-definition";
import type { RenderNode } from "./render-node";
import { createEmptyDocument } from "../state/new-initial-state";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";

const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, children) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children } as RenderNode),
};

const paragraphComponent: LeafComponentDefinition = {
  type: "paragraph",
  kind: "leaf",
  render: (view, _ctx, inlineChildren) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
};

function basicRegistry() {
  const reg = createComponentRegistry();
  reg.register(documentComponent);
  reg.register(paragraphComponent);
  return reg;
}

describe("render (new)", () => {
  it("renders an empty document", () => {
    const state = createEmptyDocument();
    const out: RenderOutput = render(state, basicRegistry());
    expect(out.root.type).toBe("element");
    expect((out.root as { children: ReadonlyArray<RenderNode> }).children).toHaveLength(1);
  });

  it("renders a single paragraph with text content", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const out = render(state, basicRegistry());
    expect(out.root.type).toBe("element");
    const docChildren = (out.root as { children: ReadonlyArray<RenderNode> }).children;
    expect(docChildren).toHaveLength(1);
    const p = docChildren[0] as { children: ReadonlyArray<RenderNode> };
    expect(p.children).toHaveLength(1);
    expect((p.children[0] as { text: string }).text).toBe("hello");
  });

  it("renders inline-mixed-attrs into separate TextBoxes", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello"),
            text("world", { bold: true }),
          ]),
        }),
      ],
    });
    const out = render(state, basicRegistry());
    const p = ((out.root as { children: ReadonlyArray<RenderNode> }).children[0]) as { children: ReadonlyArray<RenderNode> };
    expect(p.children).toHaveLength(2);
    expect((p.children[0] as { text: string }).text).toBe("hello");
    expect((p.children[1] as { text: string }).text).toBe("world");
  });

  it("throws when an unregistered block type is encountered", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "unknown-block-type", parentId: "doc" }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    // unknown-block-type is NOT registered.
    expect(() => render(state, reg)).toThrow(/unknown-block-type/);
  });

  it("renders multi-paragraph document", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("two")]) }),
      ],
    });
    const out = render(state, basicRegistry());
    const docChildren = (out.root as { children: ReadonlyArray<RenderNode> }).children;
    expect(docChildren).toHaveLength(2);
  });

  it("passes computedStyle to components (cascade integration)", () => {
    let observedStyle: { fontWeight?: string } | null = null;
    const paragraphCapture: LeafComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      render: (view, _ctx, _children) => {
        observedStyle = view.computedStyle;
        return { type: "element", key: view.id, style: {}, children: [] } as RenderNode;
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: { bold: true },
          inlineContent: inlineContent([text("x")]),
        }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(paragraphCapture);
    render(state, reg);
    expect(observedStyle).not.toBeNull();
    expect(observedStyle?.fontWeight).toBe("bold");
  });
});
```

- [ ] **S2: Run the test (expected failure: module not found)**

```bash
npm test --workspace=packages/core -- "src/render/render.test" 2>&1 | tail -20
```

- [ ] **S3: Implement `packages/core/src/render/render.ts`**

```typescript
import type { Block } from "../state/block";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { ReadonlyAttrs } from "../state/attrs";
import type { Style, ComputedStyle } from "../styles";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import { composeComputed } from "../cascade/compose";
import { attrRegistry } from "../cascade/attr-registry";
import type { ComponentRegistry } from "../components/component-registry";
import type {
  BlockView,
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "./block-view";
import type { RenderNode } from "./render-node";
import { createTextBox, createElementBox } from "./render-node";

/**
 * Output of the new renderer. `root` is the main document's RenderNode tree;
 * `embedContents` (added in T8) carries footnote bodies etc. as a parallel
 * map keyed by BlockId, consumed by pagination.
 */
export interface RenderOutput {
  readonly root: RenderNode;
  readonly embedContents: ReadonlyMap<BlockId, RenderNode>;
}

/**
 * Render a Y.Doc-backed State to a RenderNode tree.
 *
 * Decision B: push-model walker. For each block:
 *   1. Compose its computedStyle from parent + interpreters + initial.
 *   2. Build a BlockView (container or leaf) with computedStyle attached.
 *   3. Dispatch to the registered component for that type.
 *   4. Recurse into children (containers) or expand inline items (leaves)
 *      BEFORE invoking the component — components receive pre-rendered
 *      children / inline RenderNodes.
 */
export function render(state: State, registry: ComponentRegistry): RenderOutput {
  const context: RenderContext = {
    state,
    getView: (_id: BlockId) => undefined, // T8 may populate; basic walker uses internal helpers
    getEmbedContent: (_id: BlockId) => undefined,
  };
  const visited = new Set<BlockId>();
  const rootBlock = getBlock(state, state.rootId);
  if (rootBlock === null) {
    throw new Error(`render: root block "${state.rootId}" not found`);
  }
  const root = renderBlock(rootBlock, null, state, registry, context, visited);
  return Object.freeze({ root, embedContents: new Map() });
}

function renderBlock(
  block: Block,
  parentComputed: ComputedStyle | null,
  state: State,
  registry: ComponentRegistry,
  context: RenderContext,
  visited: Set<BlockId>,
): RenderNode {
  if (visited.has(block.id)) {
    throw new Error(`render: cycle detected at block "${block.id}"`);
  }
  visited.add(block.id);

  const computed = composeBlockStyle(block.attrs, parentComputed);

  const def = registry.get(block.type);
  if (def === undefined) {
    throw new Error(`render: no component registered for block type "${block.type}"`);
  }

  if (def.kind === "container") {
    const view: ContainerBlockView = Object.freeze({
      id: block.id,
      type: block.type,
      attrs: block.attrs,
      computedStyle: computed,
      kind: "container" as const,
    });
    const childRenderNodes: RenderNode[] = [];
    let childId = block.firstChildId;
    while (childId !== null) {
      const child = getBlock(state, childId);
      if (child === null) {
        throw new Error(`render: child "${childId}" of "${block.id}" not found`);
      }
      childRenderNodes.push(
        renderBlock(child, computed, state, registry, context, visited),
      );
      childId = child.nextSiblingId;
    }
    return def.render(view, context, childRenderNodes);
  }

  // Leaf: build LeafBlockView, expand inline items, dispatch.
  const inline = block.inlineContent ?? { items: [] };
  const view: LeafBlockView = Object.freeze({
    id: block.id,
    type: block.type,
    attrs: block.attrs,
    computedStyle: computed,
    kind: "leaf" as const,
    inlineContent: inline,
  });
  const inlineRenderNodes = expandInlineItems(block.id, inline, computed);
  return def.render(view, context, inlineRenderNodes);
}

/**
 * Compose computedStyle for a block: start from parent's computed style
 * (or initial), apply cascade interpreters against the block's attrs,
 * then resolve.
 */
function composeBlockStyle(
  attrs: ReadonlyAttrs,
  parentComputed: ComputedStyle | null,
): ComputedStyle {
  // 1. Collect specified-style contributions from interpreters.
  let specified: Partial<Style> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const interpreter = attrRegistry.get(key);
    if (interpreter !== undefined) {
      specified = { ...specified, ...interpreter.toStyle(value) };
    }
  }
  // 2. Compose: specified + parent computed + initial.
  const base = parentComputed ?? INITIAL_COMPUTED_STYLE;
  return composeComputed(specified, base);
}

/**
 * Expand inline content items into RenderNodes. Per master spec § text/span
 * removal: no `text` or `span` component dispatch — the renderer directly
 * emits TextBoxes for TextItems and ElementBoxes for EmbedItems.
 */
function expandInlineItems(
  blockId: BlockId,
  content: { readonly items: ReadonlyArray<unknown> },
  blockComputed: ComputedStyle,
): RenderNode[] {
  const out: RenderNode[] = [];
  let i = 0;
  for (const item of content.items) {
    const itemAny = item as {
      kind: "text" | "embed";
      text?: string;
      attrs: ReadonlyAttrs;
      embedType?: string;
      properties?: ReadonlyAttrs;
    };
    if (itemAny.kind === "text") {
      const itemStyle: Partial<Style> = composeItemSpecifiedStyle(itemAny.attrs);
      const itemComputed = composeComputed(itemStyle, blockComputed);
      out.push(
        Object.freeze({
          ...createTextBox(`${blockId}/inline/${i}`, itemStyle, itemAny.text ?? ""),
          computedStyle: itemComputed,
        }),
      );
    } else {
      // Embed: ElementBox shell with embedType + properties in metadata.
      const itemStyle: Partial<Style> = composeItemSpecifiedStyle(itemAny.attrs);
      const itemComputed = composeComputed(itemStyle, blockComputed);
      out.push(
        Object.freeze({
          ...createElementBox(`${blockId}/inline/${i}`, itemStyle, [], {
            embedType: itemAny.embedType ?? "",
            ...(itemAny.properties ?? {}),
          }),
          computedStyle: itemComputed,
        }),
      );
    }
    i++;
  }
  return out;
}

function composeItemSpecifiedStyle(attrs: ReadonlyAttrs): Partial<Style> {
  let specified: Partial<Style> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const interpreter = attrRegistry.get(key);
    if (interpreter !== undefined) {
      specified = { ...specified, ...interpreter.toStyle(value) };
    }
  }
  return specified;
}
```

- [ ] **S4: Run tests**

```bash
npm test --workspace=packages/core -- "src/render/render.test" 2>&1 | tail -15
```

Expected: all 6 tests pass.

- [ ] **S5: Full suite verification**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/render/render.ts packages/core/src/render/render.test.ts
git commit -m "feat(p7): new render() walker + cascade integration + inline expansion"
```

## Constraints

- Signature `render(state, registry): RenderOutput`.
- Cascade integration: each block's computedStyle composed from parent + interpreters + initial.
- Inline expansion: TextItems → TextBoxes, EmbedItems → ElementBoxes (no `text`/`span` component dispatch).
- Cycle defense via visited Set.
- Error messages preserve component-name context.
- NO `as any`. NO `!`. (`as` casts on inline item shapes are tolerated where the InlineItem type doesn't narrow nicely on iteration; use locally-scoped narrows.)

---

## T8: Embed-content rendering (footnote zones)

**Files:**
- Modify: `packages/core/src/render/render.ts`
- Modify: `packages/core/src/render/render.test.ts`

The walker now also enumerates `state.embedContents` blocks, rendering each as its own RenderNode tree keyed in the output's `embedContents` map. The main-document walker doesn't follow contentBlockId references into embedContents (those are rendered separately and consumed by pagination, which composes them into per-page footnote zones).

### Steps

- [ ] **S1: Write the failing tests**

Append to `render.test.ts`:

```typescript
import { getEmbedContent } from "../state/state";

describe("render — embed-content zones", () => {
  const fnBodyComponent: LeafComponentDefinition = {
    type: "fn-body",
    kind: "leaf",
    render: (view, _ctx, inlineChildren) =>
      ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
  };

  it("renders each embed-content block into its own RenderNode keyed by id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-body-1" } },
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-body-1",
          type: "fn-body",
          inlineContent: inlineContent([text("footnote text")]),
        }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnBodyComponent);
    const out = render(state, reg);
    expect(out.embedContents.size).toBe(1);
    const body = out.embedContents.get("fn-body-1" as BlockId);
    expect(body).toBeDefined();
    expect(body?.type).toBe("element");
  });

  it("main-tree walker does NOT recurse into embedContents", () => {
    // The fn-anchor embed in the main doc emits an inline ElementBox, NOT
    // a recursive walk into fn-body. Pagination merges them later.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-body-1" } },
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-body-1", type: "fn-body", inlineContent: inlineContent([text("body")]) }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnBodyComponent);
    const out = render(state, reg);
    const p = ((out.root as { children: ReadonlyArray<RenderNode> }).children[0]) as { children: ReadonlyArray<RenderNode> };
    // Single inline child: the fn-anchor ElementBox. NOT the fn-body content.
    expect(p.children).toHaveLength(1);
    expect((p.children[0] as { children: ReadonlyArray<RenderNode> }).children).toHaveLength(0);
  });

  it("renders multiple embed-content blocks in parallel", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-1" } },
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-2" } },
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "fn-body", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "fn-2", type: "fn-body", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnBodyComponent);
    const out = render(state, reg);
    expect(out.embedContents.size).toBe(2);
    expect(out.embedContents.has("fn-1" as BlockId)).toBe(true);
    expect(out.embedContents.has("fn-2" as BlockId)).toBe(true);
  });
});
```

- [ ] **S2: Run test to verify failure**

```bash
npm test --workspace=packages/core -- "src/render/render.test" 2>&1 | tail -15
```

- [ ] **S3: Extend `render()` in `render.ts`**

Update the implementation:

1. After rendering the main tree, walk `state.embedContents` (via `getEmbedContent` for each id present in the map). The renderer needs to enumerate the embed-contents map keys. Add a helper:

```typescript
import { getEmbedContent } from "../state/state";
import { getEmbedContentsMap } from "../state/yjs-doc";

// inside render():
const embedContents = new Map<BlockId, RenderNode>();
const yEmbeds = getEmbedContentsMap(state.doc);
for (const id of yEmbeds.keys()) {
  const block = getEmbedContent(state, id as BlockId);
  if (block === null) continue; // shouldn't happen since we just enumerated the map
  // Each embed-content block renders as a fresh subtree with no parent
  // computed style (uses initial). Independent cascade context.
  const visitedEmbed = new Set<BlockId>();
  embedContents.set(id as BlockId, renderBlock(block, null, state, registry, context, visitedEmbed));
}
return Object.freeze({ root, embedContents });
```

The `visited` set is reset per embed-content tree (each is a self-contained subtree).

2. Confirm the main walker does NOT follow contentBlockId references. The current implementation only recurses on `firstChildId`/`nextSiblingId`, so contentBlockId references stay inline (emitted as ElementBoxes via `expandInlineItems`). No change needed.

3. Update the RenderContext's `getView` and `getEmbedContent` to actually consult the state (currently returns undefined). They aren't load-bearing for P7's tests, but stub them properly:

```typescript
const context: RenderContext = {
  state,
  getView: (id: BlockId) => {
    // P7 stub: returns undefined. Future phases / cross-references may
    // wire this through a per-block-view cache.
    const _ = getBlock(state, id);
    return undefined;
  },
  getEmbedContent: (id: BlockId) => {
    const _ = getEmbedContent(state, id);
    return undefined;
  },
};
```

(Or just leave them as undefined-returning stubs with a clear TODO note. P10 / future cross-reference phases will wire these.)

- [ ] **S4: Run tests**

```bash
npm test --workspace=packages/core -- "src/render/render.test" 2>&1 | tail -15
```

Expected: all (9+) tests pass.

- [ ] **S5: Full suite + build**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/render/render.ts packages/core/src/render/render.test.ts
git commit -m "feat(p7): render embeds-content blocks as parallel RenderNode map"
```

---

## T9: Final verification

- [ ] **S1: Test count audit**

```bash
npm test --workspace=packages/core -- "src/render/render.test" "src/render/block-view.test" "src/components/component-definition.test" "src/components/component-registry.test" 2>&1 | tail -5
```

Should be ≥ 15 tests (T4: 4, T5: 3, T6: 4, T7: 6, T8: 3 = 20).

- [ ] **S2: Confirm spec success criteria**

- ✅ New render entry point: `render(state, registry): RenderOutput`.
- ✅ Builds on cascade pipeline (composeBlockStyle + attrRegistry).
- ✅ Dispatches via the new component registry.
- ≥ 15 tests across new render module — verified above.
- ✅ Legacy `render-legacy.ts` still compiles and works (parallel implementation; integration tests still use it).
- ✅ Browser smoke deferred: P7 is render-engine-only, no editor wiring. Legacy renderer drives the example apps unchanged. Smoke gates land at the first downstream UI consumer (P8 components rewrite + cutover at P11.4).

- [ ] **S3: Full build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean. ~1267 + ~20 new = ~1287 passing.

- [ ] **S4: Verification commit (if anything needs touch-up)**

If all green, no commit. Otherwise, fix and commit per the affected file's pattern.

## End of P7

After T9 the new render module is shipped alongside the legacy. P8 will migrate each built-in component (paragraph, document, heading, list, list-item, table family, image, horizontal-line) from the legacy `ComponentDefinition` shape to the new union — and `createDefaultComponentRegistry()` will populate them. Until then, the new renderer is exercised only by P7's tests with stub component fixtures.

The legacy renderer (`render-legacy.ts`) continues to serve the legacy editor path through P11.4. Browser smoke for the new renderer is deferred to the first downstream UI consumer phase.

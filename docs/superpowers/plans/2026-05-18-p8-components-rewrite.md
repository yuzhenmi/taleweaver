# P8 — Components Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all built-in components from the legacy `(state: StateNode, children) → RenderNode` signature to the new `ContainerComponentDefinition | LeafComponentDefinition` union (Decision B). Populate `createDefaultComponentRegistry()` with explicit `register()` calls per Decision F. Legacy components stay alive (`-legacy.ts`) for the legacy renderer through the P11.4 cutover; P15 deletes them.

**Architecture:**
- New components import from `./component-definition` (the new union, P7-shipped).
- Components return `RenderNode` (`ElementBox` or `TextBox`) with declared `style` carrying their structural defaults (e.g., paragraph's `marginBlockEnd: 0.5em`).
- `view.computedStyle` is informational — components MAY read it for structural decisions but do NOT need to encode it into the returned RenderNode. Downstream wiring (P11.4 cutover) determines how attrs-derived `view.computedStyle` and component-declared `style` flow into layout.
- 10 new components ship: 6 containers (document, list, list-item, table, table-row, table-cell) + 4 leaves (paragraph, heading, image, horizontal-line). `text` and `span` are deleted from the new pipeline per master spec; the legacy versions remain (`text-legacy.ts`, `span-legacy.ts`) until P15.

**Tech Stack:** TypeScript, Vitest. Uses the BlockView/RenderContext types shipped in P7.

## Resolved spec questions

- **Open Q 1 (registration mechanism):** resolved by Decision F (constructor-injected `ComponentRegistry`; `createDefaultComponentRegistry()` does explicit `register()` calls).
- **Open Q 2 (defaultStyle vs cascade interpreters):** components express their structural defaults via the returned RenderNode's declared `style` field (e.g., paragraph passes `{ display: "block", marginBlockEnd: { unit: "em", value: 0.5 } }` to `createElementBox`). Interpreters (in `attrRegistry`) handle per-attr deltas. No separate `defaultStyle` field on `ComponentDefinition`. This matches the legacy pattern's structural-defaults-in-output approach; the cutover phase (P11.4) decides how the new renderer's `view.computedStyle` (attrs-derived) and the component's declared `style` (structural defaults) merge into final layout-consumed values.
- **Open Q 3 (image/horizontal-line as leaf-like):** both classified as `kind: "leaf"`. Both ignore `inlineContent.items` (atomic blocks). Both pass metadata to `createElementBox` (e.g., image metadata `{ image: { src, width, height } }`).
- **Open Q 4 (list markers):** legacy `listStyleType` style attribute behavior preserved — components set `listStyleType: "decimal" | "disc"` based on the block's `attrs.listType`. The full generated-content / counters story is P9a/P9b (out of P8 scope).
- **Browser smoke deferral:** the new components are exercised only by their unit tests with stub fixtures. No editor wiring yet; legacy renderer continues to drive example apps. Browser-smoke gates land at P11.4 cutover where the new pipeline actually paints pixels.

---

## File Structure

**Renamed in P8 (Decision E `-legacy` suffix), single atomic commit:**
- `packages/core/src/components/{paragraph,document,heading,list,list-item,table,table-row,table-cell,image,horizontal-line,text,span}.ts` → corresponding `-legacy.ts`.
- Their `.test.ts` siblings renamed to `-legacy.test.ts` (those that exist).
- `packages/core/src/components/factories.ts` → `factories-legacy.ts` (and `factories.test.ts` → `factories-legacy.test.ts`). These StateNode-shaped factories are used by the legacy editor / integration tests; no new equivalent (test-utils/state-builders covers the new model).
- Updates: `components/index.ts`, `components/components.test.ts`, `render/render-legacy.test.ts`, `packages/core/src/index.ts` (if it deep-imports any component) — all import paths flipped to `-legacy`.

**Created (new canonical names, 10 components):**
- Containers (6): `document.ts`, `list.ts`, `list-item.ts`, `table.ts`, `table-row.ts`, `table-cell.ts`.
- Leaves (4): `paragraph.ts`, `heading.ts`, `image.ts`, `horizontal-line.ts`.
- Each gets a `.test.ts` sibling.

**Deleted from new pipeline (no `-new` variant; legacy versions only):**
- `text.ts` / `span.ts` — no new versions per master spec. Legacy versions live as `text-legacy.ts`, `span-legacy.ts` for the legacy registry until P15.

**Modified in P8:**
- `packages/core/src/components/component-registry.ts` — `createDefaultComponentRegistry()` populated with explicit `register()` calls for all 10 new components.

---

## Sub-phase ordering

Build-green-every-commit. Mechanical rename first, then component-by-component migrations, then final wiring + verification.

1. **T1:** Rename all 12 legacy component files + `factories.ts` to `-legacy.ts`. Update all consumers. Atomic commit.
2. **T2:** New `paragraph.ts` (leaf with inlineContent).
3. **T3:** New `document.ts` (container — root block).
4. **T4:** New `heading.ts` (leaf with inlineContent; reads `attrs.level`).
5. **T5:** New `list.ts` (container; reads `attrs.listType`).
6. **T6:** New `list-item.ts` (container; `display: list-item`).
7. **T7:** New `image.ts` (atomic leaf; reads `attrs.{src,width,height}`).
8. **T8:** New `horizontal-line.ts` (atomic leaf; hardcoded blockSize).
9. **T9:** New `table.ts` (container; reads `attrs.columnWidths`).
10. **T10:** New `table-row.ts` (container; `display: table-row`).
11. **T11:** New `table-cell.ts` (container; `display: table-cell` with hardcoded borders).
12. **T12:** Populate `createDefaultComponentRegistry()` with all 10 components. Add registry-level test asserting all 10 are registered AND `has("text") === false`, `has("span") === false` per master spec invariant. Final build + test sweep.

Tasks T2–T11 each:
- Create the new component file with the new `ComponentDefinition` shape.
- Create a `.test.ts` file with 3 tests: kind/type identity, render output structure, attr-reading (where applicable).
- Single commit per task: `feat(p8): new <name> component (Decision B <leaf|container>)`.

Total commits: 12. Total new tests: ~32 (10 × 3 + 2 registry assertions in T12).

---

## T1: Rename legacy components to `-legacy` suffix (atomic)

**Files (single commit):**
- `git mv` 12 component files + their `.test.ts` siblings (those that exist):
  - `paragraph.ts`, `document.ts`, `heading.ts`, `list.ts`, `list-item.ts`, `table.ts`, `table-row.ts`, `table-cell.ts`, `image.ts`, `horizontal-line.ts`, `text.ts`, `span.ts`.
  - Test files: confirm with `ls` before each rename. `list-item.test.ts`, `table-row.test.ts`, `table-cell.test.ts` may not exist per legacy survey.
- `git mv` `factories.ts` → `factories-legacy.ts`; `factories.test.ts` → `factories-legacy.test.ts`.
- Modify: `packages/core/src/components/index.ts` — all imports flip to `-legacy`. The `defaultComponents` constant remains exported (consumed by legacy registry callers). The `createParagraph` / etc. re-exports source from `factories-legacy`.
- Modify: `packages/core/src/components/components.test.ts` — confirm imports remain valid (most go through `./index`; those that deep-import a component file flip to `-legacy`).
- Modify: `packages/core/src/render/render-legacy.test.ts` — flip any direct component imports to `-legacy`.
- Modify: `packages/core/src/index.ts` — top-level barrel re-exports (e.g., `documentComponent`, `paragraphComponent`, factories) ALREADY route through `./components` per the index.ts read; no direct deep imports of component files at the top level. Verify with grep; if any exist, flip them. The legacy export NAMES (e.g., `paragraphComponent`, `createParagraph`, `defaultComponents`) stay the same — preserves the public API surface.

### Steps

- [ ] **S1: Audit imports**

```bash
grep -rln "from.*components/\\(document\\|paragraph\\|heading\\|list-item\\|list\\|table-cell\\|table-row\\|table\\|image\\|horizontal-line\\|text\\|span\\|factories\\)\"" /Users/hansyu/code/taleweaver/packages/core/src/ /Users/hansyu/code/taleweaver/packages/dom/src/ /Users/hansyu/code/taleweaver/packages/react/src/ 2>/dev/null | sort -u
```

Save the list. Expected: handful of files (the index barrel + the components.test.ts + a few callers).

- [ ] **S2: Check which `.test.ts` siblings exist**

```bash
for f in document paragraph heading list list-item table table-row table-cell image horizontal-line text span factories; do
  [ -f /Users/hansyu/code/taleweaver/packages/core/src/components/$f.test.ts ] && echo "EXISTS: $f.test.ts"
done
```

- [ ] **S3: Rename via git mv**

For each of the 13 source files (12 components + factories):
```bash
git mv /Users/hansyu/code/taleweaver/packages/core/src/components/<name>.ts /Users/hansyu/code/taleweaver/packages/core/src/components/<name>-legacy.ts
```

For each existing test sibling from S2:
```bash
git mv /Users/hansyu/code/taleweaver/packages/core/src/components/<name>.test.ts /Users/hansyu/code/taleweaver/packages/core/src/components/<name>-legacy.test.ts
```

- [ ] **S4: Update imports**

For each file in S1's audit, mechanically replace:
- `from "./paragraph"` → `from "./paragraph-legacy"`, etc.
- `from "../components/paragraph"` → `from "../components/paragraph-legacy"`, etc.
- Same for all 12 components + factories.

Be careful NOT to rewrite `component-definition-legacy` or `component-registry-legacy` paths (those are already correct).

Also update INTERNAL imports of the renamed files themselves. E.g., the renamed `paragraph-legacy.ts` already imports from `./component-definition-legacy` and `../render/render-node` — both unchanged paths.

- [ ] **S5: Update `components/index.ts`**

Flip all 12 component imports + re-exports + factories imports to `-legacy` paths. The exported NAMES (`paragraphComponent`, `defaultComponents`, `createParagraph`, etc.) stay unchanged — public API preserved.

- [ ] **S6: Build + test**

```bash
npm run build --workspace=packages/core 2>&1 | tail -5
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: clean. 1295 tests still pass.

- [ ] **S7: Commit**

```bash
git add -A packages/core/src/
git commit -m "refactor(p8): rename legacy components + factories → -legacy (decision E)"
```

## Constraints

- File contents byte-equivalent (pure rename).
- All 1295 tests still pass; no count change.
- `defaultComponents` and factory functions remain exported from `./components` under the same names — public API byte-equivalent.
- Build must be green at this commit (atomic).
- No `as any`, no `!`, no `as unknown as`.

---

## T2: New `paragraph.ts` (leaf)

**Files:**
- Create: `packages/core/src/components/paragraph.ts` (canonical name; legacy at `paragraph-legacy.ts`).
- Create: `packages/core/src/components/paragraph.test.ts`.

### Steps

- [ ] **S1: Write the failing test**

Create `packages/core/src/components/paragraph.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { paragraphComponent } from "./paragraph";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { RenderNode, ElementBox, TextBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";

function leafView(overrides: Partial<LeafBlockView> = {}): LeafBlockView {
  return {
    id: "p1" as BlockId,
    type: "paragraph",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
    ...overrides,
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    getView: () => { throw new Error("stub"); },
    getEmbedContent: () => { throw new Error("stub"); },
  };
}

describe("paragraphComponent (new)", () => {
  it("has type 'paragraph' and kind 'leaf'", () => {
    expect(paragraphComponent.type).toBe("paragraph");
    expect(paragraphComponent.kind).toBe("leaf");
  });

  it("renders an ElementBox with display: block and marginBlockEnd default", () => {
    const view = leafView();
    const node = paragraphComponent.render(view, stubCtx(), []);
    expect(node.type).toBe("element");
    const el = node as ElementBox;
    expect(el.key).toBe(view.id);
    expect(el.style.display).toBe("block");
    expect(el.style.marginBlockEnd).toEqual({ unit: "em", value: 0.5 });
  });

  it("passes inlineRenderNodes through as children", () => {
    const inline: ReadonlyArray<RenderNode> = [
      { type: "text", key: "p1/inline/0", style: {}, text: "hello" } as TextBox,
    ];
    const view = leafView();
    const node = paragraphComponent.render(view, stubCtx(), inline);
    const el = node as ElementBox;
    expect(el.children).toHaveLength(1);
    expect((el.children[0] as TextBox).text).toBe("hello");
  });
});
```

- [ ] **S2: Run test (expected failure: module not found)**

```bash
npm test --workspace=packages/core -- "src/components/paragraph.test" 2>&1 | tail -10
```

- [ ] **S3: Implement `packages/core/src/components/paragraph.ts`**

```typescript
import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Paragraph: a leaf block whose `inlineContent` carries text runs and
 * inline embeds. The renderer expands those items into TextBox /
 * ElementBox children before calling `render`; the component just wraps
 * them in a block-level ElementBox.
 *
 * Default structural style: `display: block` + `marginBlockEnd: 0.5em`
 * for inter-paragraph spacing. Per-instance overrides flow through
 * `view.computedStyle` (attrs-derived) and the downstream layout
 * pipeline; the component declares only its baseline.
 */
export const paragraphComponent: LeafComponentDefinition = {
  type: "paragraph",
  kind: "leaf",
  render: (view, _ctx, inlineRenderNodes) =>
    createElementBox(view.id, {
      display: "block",
      marginBlockEnd: { unit: "em", value: 0.5 },
    }, inlineRenderNodes),
};
```

- [ ] **S4: Run tests**

```bash
npm test --workspace=packages/core -- "src/components/paragraph.test" 2>&1 | tail -10
```

Expected: 3/3 pass.

- [ ] **S5: Build verification**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/components/paragraph.ts packages/core/src/components/paragraph.test.ts
git commit -m "feat(p8): new paragraph component (Decision B leaf)"
```

## Constraints

- `kind: "leaf"` — paragraph's content is inline (not child blocks).
- Default style matches legacy behavior (display: block, marginBlockEnd: 0.5em).
- No `as any`, no `!`, no `as unknown as`.

---

## T3: New `document.ts` (container)

**Files:**
- Create: `packages/core/src/components/document.ts`.
- Create: `packages/core/src/components/document.test.ts`.

### Steps

- [ ] **S1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { documentComponent } from "./document";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox, RenderNode } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";

function containerView(overrides: Partial<ContainerBlockView> = {}): ContainerBlockView {
  return {
    id: "doc" as BlockId,
    type: "document",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "container",
    ...overrides,
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    getView: () => { throw new Error("stub"); },
    getEmbedContent: () => { throw new Error("stub"); },
  };
}

describe("documentComponent (new)", () => {
  it("has type 'document' and kind 'container'", () => {
    expect(documentComponent.type).toBe("document");
    expect(documentComponent.kind).toBe("container");
  });

  it("renders an ElementBox with display: block at the root", () => {
    const view = containerView();
    const node = documentComponent.render(view, stubCtx(), []);
    expect(node.type).toBe("element");
    const el = node as ElementBox;
    expect(el.key).toBe(view.id);
    expect(el.style.display).toBe("block");
  });

  it("passes childRenderNodes through unchanged", () => {
    const child: ElementBox = { type: "element", key: "p1", style: {}, children: [] };
    const node = documentComponent.render(containerView(), stubCtx(), [child]);
    const el = node as ElementBox;
    expect(el.children).toHaveLength(1);
    expect(el.children[0]).toBe(child);
  });
});
```

- [ ] **S2: Run test (expected failure)**

```bash
npm test --workspace=packages/core -- "src/components/document.test" 2>&1 | tail -10
```

- [ ] **S3: Implement**

```typescript
import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Document: the root container block. Holds child blocks (paragraphs,
 * lists, tables, etc.). The renderer pre-renders all children; this
 * component wraps them in a single block-level ElementBox.
 */
export const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "block" }, childRenderNodes),
};
```

- [ ] **S4: Run tests**

```bash
npm test --workspace=packages/core -- "src/components/document.test" 2>&1 | tail -10
```

- [ ] **S5: Build**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/components/document.ts packages/core/src/components/document.test.ts
git commit -m "feat(p8): new document component (Decision B container)"
```

---

## T4: New `heading.ts` (leaf with level)

**Files:**
- Create: `packages/core/src/components/heading.ts`.
- Create: `packages/core/src/components/heading.test.ts`.

Heading is a leaf carrying inline content. Reads `attrs.level` (1–6) to set fontSize.

### Steps

- [ ] **S1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { headingComponent, HEADING_FONT_SIZES } from "./heading";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";
import type { ReadonlyAttrs } from "../state/attrs";

function leafView(attrs: ReadonlyAttrs = {}): LeafBlockView {
  return {
    id: "h1" as BlockId,
    type: "heading",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return {
    state: {} as State,
    getView: () => { throw new Error("stub"); },
    getEmbedContent: () => { throw new Error("stub"); },
  };
}

describe("headingComponent (new)", () => {
  it("has type 'heading' and kind 'leaf'", () => {
    expect(headingComponent.type).toBe("heading");
    expect(headingComponent.kind).toBe("leaf");
  });

  it("renders an ElementBox with bold font weight and level-derived font size", () => {
    const view = leafView({ level: 1 });
    const node = headingComponent.render(view, stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.fontWeight).toBe("bold");
    expect(el.style.fontSize).toBe(HEADING_FONT_SIZES[1]);
  });

  it("falls back to level 1 size when attrs.level is missing", () => {
    const view = leafView({});
    const node = headingComponent.render(view, stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.fontSize).toBe(HEADING_FONT_SIZES[1]);
  });
});
```

- [ ] **S2: Failing run**

```bash
npm test --workspace=packages/core -- "src/components/heading.test" 2>&1 | tail -10
```

- [ ] **S3: Implement**

```typescript
import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Heading font sizes by level (h1 — h6), in px. Matches legacy
 * `heading-legacy.ts` for byte-equivalent visual output.
 */
export const HEADING_FONT_SIZES: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, number>> = Object.freeze({
  1: 32, 2: 28, 3: 24, 4: 20, 5: 18, 6: 16,
});

function levelFromAttrs(level: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  if (level === 1 || level === 2 || level === 3 || level === 4 || level === 5 || level === 6) {
    return level;
  }
  return 1;
}

/**
 * Heading: a leaf block carrying inline content + a `level` attr (1–6).
 * Per-level fontSize is set; bold + level-relative margin defaults match
 * legacy behavior.
 */
export const headingComponent: LeafComponentDefinition = {
  type: "heading",
  kind: "leaf",
  render: (view, _ctx, inlineRenderNodes) => {
    const level = levelFromAttrs(view.attrs.level);
    return createElementBox(view.id, {
      display: "block",
      fontWeight: "bold",
      fontSize: HEADING_FONT_SIZES[level],
      marginBlockStart: { unit: "em", value: 0.67 },
      marginBlockEnd: { unit: "em", value: 0.67 },
    }, inlineRenderNodes);
  },
};
```

- [ ] **S4: Tests pass**

```bash
npm test --workspace=packages/core -- "src/components/heading.test" 2>&1 | tail -10
```

- [ ] **S5: Build**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/components/heading.ts packages/core/src/components/heading.test.ts
git commit -m "feat(p8): new heading component (Decision B leaf)"
```

---

## T5: New `list.ts` (container, reads attrs.listType)

**Files:**
- Create: `packages/core/src/components/list.ts`.
- Create: `packages/core/src/components/list.test.ts`.

Reads `attrs.listType` ("ordered" | "unordered") to set `listStyleType` ("decimal" | "disc").

### Steps

- [ ] **S1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { listComponent } from "./list";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";
import type { ReadonlyAttrs } from "../state/attrs";

function containerView(attrs: ReadonlyAttrs = {}): ContainerBlockView {
  return {
    id: "l1" as BlockId,
    type: "list",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("listComponent (new)", () => {
  it("has type 'list' and kind 'container'", () => {
    expect(listComponent.type).toBe("list");
    expect(listComponent.kind).toBe("container");
  });

  it("renders display: block with paddingInlineStart for the marker gutter", () => {
    const node = listComponent.render(containerView(), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.paddingInlineStart).toBe(30);
  });

  it("sets listStyleType: 'decimal' for ordered lists", () => {
    const node = listComponent.render(containerView({ listType: "ordered" }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.listStyleType).toBe("decimal");
  });

  it("sets listStyleType: 'disc' for unordered (default) lists", () => {
    const node = listComponent.render(containerView({ listType: "unordered" }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.listStyleType).toBe("disc");
  });

  it("defaults to 'disc' when attrs.listType is absent or unknown", () => {
    const node = listComponent.render(containerView({}), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.listStyleType).toBe("disc");
  });
});
```

- [ ] **S2: Failing run**

```bash
npm test --workspace=packages/core -- "src/components/list.test" 2>&1 | tail -10
```

- [ ] **S3: Implement**

```typescript
import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listComponent: ContainerComponentDefinition = {
  type: "list",
  kind: "container",
  render: (view, _ctx, childRenderNodes) => {
    const listStyleType: "decimal" | "disc" =
      view.attrs.listType === "ordered" ? "decimal" : "disc";
    return createElementBox(view.id, {
      display: "block",
      paddingInlineStart: 30,
      listStyleType,
    }, childRenderNodes);
  },
};
```

- [ ] **S4: Tests pass**

```bash
npm test --workspace=packages/core -- "src/components/list.test" 2>&1 | tail -10
```

- [ ] **S5: Build**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
```

- [ ] **S6: Commit**

```bash
git add packages/core/src/components/list.ts packages/core/src/components/list.test.ts
git commit -m "feat(p8): new list component (Decision B container)"
```

---

## T6: New `list-item.ts` (container)

**Files:**
- Create: `packages/core/src/components/list-item.ts`.
- Create: `packages/core/src/components/list-item.test.ts`.

### Steps

- [ ] **S1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { listItemComponent } from "./list-item";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";

function containerView(): ContainerBlockView {
  return {
    id: "li1" as BlockId,
    type: "list-item",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("listItemComponent (new)", () => {
  it("has type 'list-item' and kind 'container'", () => {
    expect(listItemComponent.type).toBe("list-item");
    expect(listItemComponent.kind).toBe("container");
  });

  it("renders display: list-item", () => {
    const node = listItemComponent.render(containerView(), stubCtx(), []);
    expect((node as ElementBox).style.display).toBe("list-item");
  });

  it("passes children through", () => {
    const child: ElementBox = { type: "element", key: "p1", style: {}, children: [] };
    const el = listItemComponent.render(containerView(), stubCtx(), [child]) as ElementBox;
    expect(el.children).toEqual([child]);
  });
});
```

- [ ] **S2: Failing run, S3: Implement**

```typescript
import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listItemComponent: ContainerComponentDefinition = {
  type: "list-item",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "list-item" }, childRenderNodes),
};
```

- [ ] **S4-S6:** tests, build, commit `feat(p8): new list-item component (Decision B container)`.

---

## T7: New `image.ts` (atomic leaf)

**Files:**
- Create: `packages/core/src/components/image.ts`.
- Create: `packages/core/src/components/image.test.ts`.

Atomic leaf: reads `attrs.{src,width,height}`. Empty children. Passes metadata `{ image: { src, width, height } }`.

### Steps

- [ ] **S1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { imageComponent } from "./image";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";
import type { ReadonlyAttrs } from "../state/attrs";

function leafView(attrs: ReadonlyAttrs = {}): LeafBlockView {
  return {
    id: "img1" as BlockId,
    type: "image",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("imageComponent (new)", () => {
  it("has type 'image' and kind 'leaf'", () => {
    expect(imageComponent.type).toBe("image");
    expect(imageComponent.kind).toBe("leaf");
  });

  it("renders block-level ElementBox with intrinsic sizing from attrs", () => {
    const node = imageComponent.render(leafView({ src: "/a.png", width: 300, height: 200 }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.inlineSize).toBe(300);
    expect(el.style.blockSize).toBe(200);
    expect(el.children).toHaveLength(0);
  });

  it("attaches image metadata", () => {
    const node = imageComponent.render(leafView({ src: "/a.png", width: 300, height: 200 }), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.metadata).toEqual({ image: { src: "/a.png", width: 300, height: 200 } });
  });

  it("ignores any inlineRenderNodes the renderer might pass", () => {
    // Image's inlineContent.items is empty by convention; even if a stray
    // inline RenderNode is passed, the component must not include it.
    const node = imageComponent.render(
      leafView({ src: "/a.png", width: 1, height: 1 }),
      stubCtx(),
      [{ type: "text", key: "x", style: {}, text: "ignored" }],
    );
    expect((node as ElementBox).children).toHaveLength(0);
  });
});
```

- [ ] **S2-S3: Implement**

```typescript
import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

function numAttr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function strAttr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Image: an atomic leaf. Reads `src`, `width`, `height` from attrs;
 * ignores inline content (none should exist on an image block).
 */
export const imageComponent: LeafComponentDefinition = {
  type: "image",
  kind: "leaf",
  render: (view, _ctx, _inlineRenderNodes) => {
    const src = strAttr(view.attrs.src, "");
    const width = numAttr(view.attrs.width, 0);
    const height = numAttr(view.attrs.height, 0);
    return createElementBox(
      view.id,
      { display: "block", inlineSize: width, blockSize: height },
      [],
      { image: { src, width, height } },
    );
  },
};
```

- [ ] **S4-S6:** tests, build, commit `feat(p8): new image component (Decision B leaf atomic)`.

---

## T8: New `horizontal-line.ts` (atomic leaf)

**Files:**
- Create: `packages/core/src/components/horizontal-line.ts`.
- Create: `packages/core/src/components/horizontal-line.test.ts`.

### Steps

- [ ] **S1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { horizontalLineComponent } from "./horizontal-line";
import type { LeafBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";

function leafView(): LeafBlockView {
  return {
    id: "hr1" as BlockId,
    type: "horizontal-line",
    attrs: Object.freeze({}),
    computedStyle: {} as ComputedStyle,
    kind: "leaf",
    inlineContent: { items: [] },
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("horizontalLineComponent (new)", () => {
  it("has type 'horizontal-line' and kind 'leaf'", () => {
    expect(horizontalLineComponent.type).toBe("horizontal-line");
    expect(horizontalLineComponent.kind).toBe("leaf");
  });

  it("renders block-level ElementBox with fixed blockSize and horizontalLine metadata", () => {
    const node = horizontalLineComponent.render(leafView(), stubCtx(), []);
    const el = node as ElementBox;
    expect(el.style.display).toBe("block");
    expect(el.style.blockSize).toBe(16);
    expect(el.metadata).toEqual({ horizontalLine: true });
    expect(el.children).toHaveLength(0);
  });
});
```

- [ ] **S2-S3: Implement**

```typescript
import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const horizontalLineComponent: LeafComponentDefinition = {
  type: "horizontal-line",
  kind: "leaf",
  render: (view, _ctx, _inlineRenderNodes) =>
    createElementBox(
      view.id,
      { display: "block", blockSize: 16 },
      [],
      { horizontalLine: true },
    ),
};
```

- [ ] **S4-S6:** tests, build, commit `feat(p8): new horizontal-line component (Decision B leaf atomic)`.

---

## T9: New `table.ts` (container, reads columnWidths)

**Files:**
- Create: `packages/core/src/components/table.ts`.
- Create: `packages/core/src/components/table.test.ts`.

### Steps

- [ ] **S1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { tableComponent } from "./table";
import type { ContainerBlockView, RenderContext } from "../render/block-view";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import type { ComputedStyle } from "../styles";
import type { ReadonlyAttrs } from "../state/attrs";

function containerView(attrs: ReadonlyAttrs = {}): ContainerBlockView {
  return {
    id: "t1" as BlockId,
    type: "table",
    attrs: Object.freeze(attrs),
    computedStyle: {} as ComputedStyle,
    kind: "container",
  };
}

function stubCtx(): RenderContext {
  return { state: {} as State, getView: () => { throw new Error("stub"); }, getEmbedContent: () => { throw new Error("stub"); } };
}

describe("tableComponent (new)", () => {
  it("has type 'table' and kind 'container'", () => {
    expect(tableComponent.type).toBe("table");
    expect(tableComponent.kind).toBe("container");
  });

  it("renders display: table", () => {
    expect((tableComponent.render(containerView(), stubCtx(), []) as ElementBox).style.display).toBe("table");
  });

  it("passes columnWidths attr into metadata when present", () => {
    const node = tableComponent.render(containerView({ columnWidths: [0.5, 0.3, 0.2] }), stubCtx(), []);
    expect((node as ElementBox).metadata).toEqual({ columnWidths: [0.5, 0.3, 0.2] });
  });

  it("omits metadata when columnWidths is absent", () => {
    const node = tableComponent.render(containerView({}), stubCtx(), []);
    expect((node as ElementBox).metadata).toBeUndefined();
  });
});
```

- [ ] **S2-S3: Implement**

```typescript
import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

function isNumberArray(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

export const tableComponent: ContainerComponentDefinition = {
  type: "table",
  kind: "container",
  render: (view, _ctx, childRenderNodes) => {
    const cw = view.attrs.columnWidths;
    const metadata = isNumberArray(cw) ? { columnWidths: cw } : undefined;
    return createElementBox(
      view.id,
      { display: "table" },
      childRenderNodes,
      metadata,
    );
  },
};
```

- [ ] **S4-S6:** tests, build, commit `feat(p8): new table component (Decision B container)`.

---

## T10: New `table-row.ts` (container)

**Files:**
- Create: `packages/core/src/components/table-row.ts`.
- Create: `packages/core/src/components/table-row.test.ts`.

### Steps

- [ ] **S1: Failing test, S2-S3: Implement**

```typescript
import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const tableRowComponent: ContainerComponentDefinition = {
  type: "table-row",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "table-row" }, childRenderNodes),
};
```

Test asserts `type === "table-row"`, `kind === "container"`, `display === "table-row"`, children pass-through. ~3 tests.

- [ ] **S4-S6:** tests, build, commit `feat(p8): new table-row component (Decision B container)`.

---

## T11: New `table-cell.ts` (container with hardcoded borders/padding)

**Files:**
- Create: `packages/core/src/components/table-cell.ts`.
- Create: `packages/core/src/components/table-cell.test.ts`.

### Steps

- [ ] **S1: Failing test, S2-S3: Implement**

```typescript
import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Table cell: hardcoded 1px solid border + 4/8px padding match legacy
 * behavior. Per-cell border overrides via attrs are P12+ work (table
 * styles cleanup).
 */
export const tableCellComponent: ContainerComponentDefinition = {
  type: "table-cell",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, {
      display: "table-cell",
      borderBlockStartWidth: 1,
      borderBlockEndWidth: 1,
      borderInlineStartWidth: 1,
      borderInlineEndWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockEndStyle: "solid",
      borderInlineStartStyle: "solid",
      borderInlineEndStyle: "solid",
      borderBlockStartColor: "#dadce0",
      borderBlockEndColor: "#dadce0",
      borderInlineStartColor: "#dadce0",
      borderInlineEndColor: "#dadce0",
      paddingBlockStart: 4,
      paddingBlockEnd: 4,
      paddingInlineStart: 8,
      paddingInlineEnd: 8,
    }, childRenderNodes),
};
```

Test asserts type/kind, display: table-cell, presence of borders and padding. ~3 tests.

- [ ] **S4-S6:** tests, build, commit `feat(p8): new table-cell component (Decision B container)`.

---

## T12: Wire all components into `createDefaultComponentRegistry()` + final verification

**Files:**
- Modify: `packages/core/src/components/component-registry.ts` — populate `createDefaultComponentRegistry()` with explicit `register()` calls for all 10 components.
- Modify: `packages/core/src/components/component-registry.test.ts` — add tests asserting all 10 are registered AND `has("text") === false`, `has("span") === false`.

### Steps

- [ ] **S1: Update failing test in `component-registry.test.ts`**

Modify the existing test `"createDefaultComponentRegistry returns a registry (empty until P8 populates)"` to flip its expectations now that P8 has landed. Replace with:

```typescript
it("createDefaultComponentRegistry registers all 10 built-in components", () => {
  const reg = createDefaultComponentRegistry();
  // Containers (6)
  expect(reg.has("document")).toBe(true);
  expect(reg.has("list")).toBe(true);
  expect(reg.has("list-item")).toBe(true);
  expect(reg.has("table")).toBe(true);
  expect(reg.has("table-row")).toBe(true);
  expect(reg.has("table-cell")).toBe(true);
  // Leaves (4)
  expect(reg.has("paragraph")).toBe(true);
  expect(reg.has("heading")).toBe(true);
  expect(reg.has("image")).toBe(true);
  expect(reg.has("horizontal-line")).toBe(true);
});

it("createDefaultComponentRegistry does NOT register text or span (master spec invariant)", () => {
  const reg = createDefaultComponentRegistry();
  expect(reg.has("text")).toBe(false);
  expect(reg.has("span")).toBe(false);
});

it("registered definitions have the correct kind discriminant", () => {
  const reg = createDefaultComponentRegistry();
  expect(reg.get("document")?.kind).toBe("container");
  expect(reg.get("list")?.kind).toBe("container");
  expect(reg.get("list-item")?.kind).toBe("container");
  expect(reg.get("table")?.kind).toBe("container");
  expect(reg.get("table-row")?.kind).toBe("container");
  expect(reg.get("table-cell")?.kind).toBe("container");
  expect(reg.get("paragraph")?.kind).toBe("leaf");
  expect(reg.get("heading")?.kind).toBe("leaf");
  expect(reg.get("image")?.kind).toBe("leaf");
  expect(reg.get("horizontal-line")?.kind).toBe("leaf");
});
```

This replaces the old test that expected an empty registry. Net: +2 tests (was 1 test asserting empty; now 3 tests asserting populated state).

- [ ] **S2: Run tests (expected failure — registry is still empty)**

```bash
npm test --workspace=packages/core -- "src/components/component-registry.test" 2>&1 | tail -10
```

- [ ] **S3: Update `createDefaultComponentRegistry`**

Replace the placeholder body in `packages/core/src/components/component-registry.ts`:

```typescript
import type { ComponentDefinition } from "./component-definition";
import { documentComponent } from "./document";
import { paragraphComponent } from "./paragraph";
import { headingComponent } from "./heading";
import { listComponent } from "./list";
import { listItemComponent } from "./list-item";
import { tableComponent } from "./table";
import { tableRowComponent } from "./table-row";
import { tableCellComponent } from "./table-cell";
import { imageComponent } from "./image";
import { horizontalLineComponent } from "./horizontal-line";

// ... existing interface + ComponentRegistryImpl + createComponentRegistry ...

/**
 * Returns a registry pre-populated with all 10 built-in components.
 * Per Decision F: explicit register() calls, no side-effect imports.
 *
 * `text` and `span` are deliberately NOT registered — per master spec,
 * `componentRegistry.has("text") === false`, `has("span") === false`
 * for the new pipeline. The renderer expands inline items directly.
 */
export function createDefaultComponentRegistry(): ComponentRegistry {
  const reg = createComponentRegistry();
  // Containers
  reg.register(documentComponent);
  reg.register(listComponent);
  reg.register(listItemComponent);
  reg.register(tableComponent);
  reg.register(tableRowComponent);
  reg.register(tableCellComponent);
  // Leaves
  reg.register(paragraphComponent);
  reg.register(headingComponent);
  reg.register(imageComponent);
  reg.register(horizontalLineComponent);
  return reg;
}
```

- [ ] **S4: Run tests**

```bash
npm test --workspace=packages/core -- "src/components/component-registry.test" 2>&1 | tail -10
```

Expected: all 3 new + 3 existing = 6 tests in this file pass.

- [ ] **S5: Full build + test sweep**

```bash
npm run build --workspace=packages/core 2>&1 | tail -3
npm test --workspace=packages/core 2>&1 | tail -5
```

Expected: ~1295 + (T2-T11 component tests: ~30 = 3 per × 10) + (T12 net: +2) ≈ 1327 passing, 4 skipped. Build green.

- [ ] **S6: Confirm spec invariants**

```bash
grep -n "has(\"text\")" packages/core/src/components/component-registry.test.ts
grep -n "has(\"span\")" packages/core/src/components/component-registry.test.ts
```

Both should hit the new test asserting `false`.

- [ ] **S7: Commit**

```bash
git add packages/core/src/components/component-registry.ts packages/core/src/components/component-registry.test.ts
git commit -m "feat(p8): wire 10 built-in components into createDefaultComponentRegistry"
```

## Constraints

- All 10 built-in components registered explicitly. No side-effect imports.
- `has("text") === false` and `has("span") === false` — master spec invariant.
- Build green; test sweep green.
- The legacy registry (`component-registry-legacy.ts`) is untouched — it still registers all 12 legacy components (including text-legacy and span-legacy) for the legacy renderer's use.

---

## End of P8

After T12 the new pipeline is feature-complete for built-in components:
- `createDefaultComponentRegistry()` returns a populated registry.
- The new `render(state, componentRegistry, attrRegistry)` can now render any document with built-in block types end-to-end (paragraph + text-bearing inline content; document containers; tables, lists, headings, images, horizontal lines).
- Legacy renderer + legacy components + legacy registry continue to drive the editor and example apps unchanged.

**P11.4 cutover (later):** the editor's `EditorConfig` gains the optional `componentRegistry?: ComponentRegistry` field (Decision F point 4); the renderer is swapped to call the new `render(...)`; cascade-pass either runs on the new renderer's output or is replaced by composing the component-declared `style` with `view.computedStyle` directly inside the renderer. That decision lives in the P11.4 plan, not here.

**Browser smoke deferral:** the new components are exercised by their unit tests but have no UI pipeline yet. Browser-smoke gates land at P11.4.

**P15:** delete all `*-legacy.ts` component files, `factories-legacy.ts`, `text-legacy.ts`, `span-legacy.ts`, `component-registry-legacy.ts`, `component-definition-legacy.ts`. The legacy export names (`paragraphComponent`, `defaultComponents`, factory functions) come off the public API.

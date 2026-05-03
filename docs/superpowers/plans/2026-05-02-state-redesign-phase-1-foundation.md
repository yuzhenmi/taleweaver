# State module redesign — Phase 1: foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the additive Layer 1 of the new state module — `PersistentMap`, `BlockId` + `IdAllocator`, `ReadonlyAttrs` + `attrsEqual`, `InlineContent` (text and embed items), `Position` / `Span`, `Block`, `State`, `createEmptyDocument`, plus a deterministic test builder DSL — without modifying any consumer of the existing state module. Build remains green throughout this phase. Subsequent phases (Layer 2 utilities, Layer 3 operations, then consumer migration) will follow.

**Architecture:** Per the design spec at `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. The state module becomes a `PersistentMap<BlockId, Block>` keyed by branded UUID-style block ids; each block holds doubly-linked-list child pointers; leaf blocks carry `inlineContent` as a flat array of styled `TextItem` / `EmbedItem` items; positions are `{ blockId, offset }` with offset measured in UTF-16 code units. This phase only adds the new types and primitives — old `state-node.ts`, `position.ts` (old shape), etc. remain untouched and consumers continue using them. Phase 2 starts the breaking-change cutover.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces. Test runner: `npm test --workspace=packages/core`. Type checker: `npm run build --workspace=packages/core`.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` (read before starting; this plan implements its "Layered API surface > Layer 1" plus the persistent-map wrapper and test builders).

**Per-phase scope notes:**
- New files added at top-level paths in `packages/core/src/state/` with a `block-` or new-name prefix where they would collide with existing files. **Specifically: this phase adds `block-position.ts` instead of `position.ts`** to avoid colliding with the existing `state/position.ts`. Phase 14 (cleanup) renames `block-position.ts` → `position.ts` after the old `position.ts` is deleted.
- All other new file names in this phase do not collide with existing files (`persistent-map.ts`, `block-id.ts`, `attrs.ts`, `inline-content.ts`, `block.ts`, `state.ts`, `attr-registry.ts`).
- `initial-state.ts` exists in the old code (creates `StateNode` empty document). This phase adds a NEW `new-initial-state.ts` (later renamed in cleanup). The old one stays for now.
- Test builder DSL goes into a new file `packages/core/src/test-utils/state-builders.ts`.
- Per CLAUDE.md: TDD throughout. Write tests first, see them fail, implement minimum to pass, commit.
- Per memory `feedback_no_auto_commit.md`: commit on user's behalf at the end of each task.
- Type safety: no non-null assertions (`!`); use proper narrowing.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/state/persistent-map.ts` | Wrapper around `Map<BlockId, Block>` exposing immutable `set`/`delete`/`get`/`has`/iteration. Hides implementation; Phase 1 uses plain Map cloned per edit. |
| `packages/core/src/state/persistent-map.test.ts` | Unit tests for persistent-map. |
| `packages/core/src/state/block-id.ts` | `BlockId` branded type, `IdAllocator` interface, `productionAllocator` (uses `crypto.randomUUID()`), `createTestAllocator(prefix)` (deterministic counter). |
| `packages/core/src/state/block-id.test.ts` | Unit tests for ID allocators and branded-type type-level checks. |
| `packages/core/src/state/attrs.ts` | `ReadonlyAttrs` type alias, `deepValueEqual`, `attrsEqual` (uses interpreter registry's optional `equals`). |
| `packages/core/src/state/attrs.test.ts` | Unit tests for `deepValueEqual` and `attrsEqual`. |
| `packages/core/src/state/inline-content.ts` | `InlineContent`, `InlineItem`, `TextItem`, `EmbedItem` types plus access helpers (`inlineContentLength`, `findItemAtOffset`, `iterateItemsInRange`). |
| `packages/core/src/state/inline-content.test.ts` | Unit tests for inline content access helpers. |
| `packages/core/src/state/block-position.ts` | `Position`, `Span` types, `createPosition`, `createSpan`, `positionsEqual`, `comparePositions` (within-block compare only; cross-block compare lives in Layer 2 / Phase 2). Will be renamed to `position.ts` in Phase 14 cleanup. |
| `packages/core/src/state/block-position.test.ts` | Unit tests for position construction and within-block compare. |
| `packages/core/src/state/block.ts` | `Block` interface plus `createBlock` factory (takes id, type, attrs, optional links, optional `inlineContent`). |
| `packages/core/src/state/block.test.ts` | Unit tests for `createBlock` and immutability. |
| `packages/core/src/state/state.ts` | `State` interface plus a thin factory (`createState({ rootId, blocks })`). Includes `Operation` and `OperationResult` type definitions referenced by Layer 3 (Phase 2) — we add the type now so Layer 1 consumers can type-check helper signatures that produce results. |
| `packages/core/src/state/state.test.ts` | Unit tests for `createState`. |
| `packages/core/src/state/new-initial-state.ts` | `createEmptyDocument(allocator: IdAllocator): State` — produces a state with one empty paragraph. (Renamed to `initial-state.ts` in Phase 14.) |
| `packages/core/src/state/new-initial-state.test.ts` | Unit tests for `createEmptyDocument`. |
| `packages/core/src/test-utils/state-builders.ts` | Deterministic test DSL: `buildBlock(...)`, `buildState(rootBuilder)`, `buildInline(...items)`, `text(t, attrs?)`, `embed(type, properties?)`. Uses an injected `createTestAllocator` for deterministic IDs. |
| `packages/core/src/test-utils/state-builders.test.ts` | Unit tests for the builder DSL — verify constructed blocks/state are well-formed. |

**Modified:** none (Phase 1 is purely additive).

**Deleted:** none (Phase 2 begins the breaking-change cutover).

---

## Task 1: persistent-map.ts — empty map

**Files:**
- Create: `packages/core/src/state/persistent-map.ts`
- Test: `packages/core/src/state/persistent-map.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/persistent-map.test.ts
import { describe, it, expect } from "vitest";
import { createPersistentMap } from "./persistent-map";

describe("persistent-map", () => {
  it("creates an empty map", () => {
    const m = createPersistentMap<string, number>();
    expect(m.size).toBe(0);
    expect(m.has("a")).toBe(false);
    expect(m.get("a")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- persistent-map`
Expected: FAIL — module `./persistent-map` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/persistent-map.ts

/**
 * Immutable map abstraction. Phase 1 implementation: plain Map cloned per
 * edit. Hides implementation so we can swap to a HAMT later if benchmarks
 * demand without touching consumers.
 */
export interface PersistentMap<K, V> {
  readonly size: number;
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): PersistentMap<K, V>;
  delete(key: K): PersistentMap<K, V>;
  entries(): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
}

export function createPersistentMap<K, V>(initial?: Iterable<[K, V]>): PersistentMap<K, V> {
  const inner = new Map<K, V>(initial);
  return wrap(inner);
}

function wrap<K, V>(inner: ReadonlyMap<K, V>): PersistentMap<K, V> {
  return {
    get size() { return inner.size; },
    has: (k) => inner.has(k),
    get: (k) => inner.get(k),
    set(k, v) {
      const next = new Map(inner);
      next.set(k, v);
      return wrap(next);
    },
    delete(k) {
      if (!inner.has(k)) return wrap(inner);
      const next = new Map(inner);
      next.delete(k);
      return wrap(next);
    },
    entries: () => inner.entries(),
    keys: () => inner.keys(),
    values: () => inner.values(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- persistent-map`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/persistent-map.ts packages/core/src/state/persistent-map.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add PersistentMap wrapper around plain Map

Phase 1 of state-model redesign. Implements the spec's
PersistentMap<BlockId, Block> abstraction as a plain Map cloned
per edit, hidden behind an interface so we can swap to a HAMT
later without touching consumers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: persistent-map.ts — set, get, structural sharing

**Files:**
- Modify: `packages/core/src/state/persistent-map.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/state/persistent-map.test.ts`:

```typescript
  it("set returns a new map with the value set, original unchanged", () => {
    const m1 = createPersistentMap<string, number>();
    const m2 = m1.set("a", 1);
    expect(m1.has("a")).toBe(false);
    expect(m1.size).toBe(0);
    expect(m2.has("a")).toBe(true);
    expect(m2.get("a")).toBe(1);
    expect(m2.size).toBe(1);
  });

  it("set on existing key replaces the value", () => {
    const m = createPersistentMap<string, number>().set("a", 1).set("a", 2);
    expect(m.get("a")).toBe(2);
    expect(m.size).toBe(1);
  });

  it("get returns undefined for missing keys", () => {
    const m = createPersistentMap<string, number>().set("a", 1);
    expect(m.get("missing")).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- persistent-map`
Expected: PASS (4 tests). The `set`/`get` implementation from Task 1 already covers this.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/state/persistent-map.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover PersistentMap set/get and immutability

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: persistent-map.ts — delete, has, iteration

**Files:**
- Modify: `packages/core/src/state/persistent-map.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
  it("delete returns a new map without the key, original unchanged", () => {
    const m1 = createPersistentMap<string, number>().set("a", 1).set("b", 2);
    const m2 = m1.delete("a");
    expect(m1.has("a")).toBe(true);
    expect(m1.size).toBe(2);
    expect(m2.has("a")).toBe(false);
    expect(m2.has("b")).toBe(true);
    expect(m2.size).toBe(1);
  });

  it("delete on missing key returns an equivalent map (no-op semantics)", () => {
    const m = createPersistentMap<string, number>().set("a", 1);
    const m2 = m.delete("missing");
    expect(m2.size).toBe(1);
    expect(m2.get("a")).toBe(1);
  });

  it("entries / keys / values iterate the contents", () => {
    const m = createPersistentMap<string, number>().set("a", 1).set("b", 2);
    expect([...m.keys()].sort()).toEqual(["a", "b"]);
    expect([...m.values()].sort()).toEqual([1, 2]);
    expect([...m.entries()].sort()).toEqual([["a", 1], ["b", 2]]);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- persistent-map`
Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/state/persistent-map.test.ts
git commit -m "$(cat <<'EOF'
test(state): cover PersistentMap delete and iteration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: block-id.ts — BlockId branded type and productionAllocator

**Files:**
- Create: `packages/core/src/state/block-id.ts`
- Test: `packages/core/src/state/block-id.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/block-id.test.ts
import { describe, it, expect } from "vitest";
import { productionAllocator, type BlockId } from "./block-id";

describe("productionAllocator", () => {
  it("produces unique ids on repeated calls", () => {
    const a = productionAllocator.allocate();
    const b = productionAllocator.allocate();
    expect(a).not.toBe(b);
  });

  it("produces ids matching the UUID v4 shape", () => {
    const id: BlockId = productionAllocator.allocate();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- block-id`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/block-id.ts

/**
 * Branded string identifying a block. Brand prevents passing arbitrary
 * strings where BlockIds are expected.
 */
export type BlockId = string & { readonly __brand: "BlockId" };

/**
 * Allocates BlockIds. Production uses crypto.randomUUID(); tests inject
 * a deterministic counter-based allocator via createTestAllocator.
 */
export interface IdAllocator {
  allocate(): BlockId;
}

export const productionAllocator: IdAllocator = {
  allocate: () => crypto.randomUUID() as BlockId,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- block-id`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-id.ts packages/core/src/state/block-id.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add BlockId branded type and productionAllocator

UUID v4 in production via crypto.randomUUID(); branded string type
enforces type safety against accidentally passing arbitrary strings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: block-id.ts — createTestAllocator (deterministic)

**Files:**
- Modify: `packages/core/src/state/block-id.ts`
- Modify: `packages/core/src/state/block-id.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `block-id.test.ts`:

```typescript
import { createTestAllocator } from "./block-id";

describe("createTestAllocator", () => {
  it("produces deterministic, sequential ids with default prefix", () => {
    const a = createTestAllocator();
    expect(a.allocate()).toBe("blk-0");
    expect(a.allocate()).toBe("blk-1");
    expect(a.allocate()).toBe("blk-2");
  });

  it("uses a custom prefix when provided", () => {
    const a = createTestAllocator("para");
    expect(a.allocate()).toBe("para-0");
    expect(a.allocate()).toBe("para-1");
  });

  it("each allocator has its own counter", () => {
    const a = createTestAllocator();
    const b = createTestAllocator();
    a.allocate();
    a.allocate();
    expect(b.allocate()).toBe("blk-0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-id`
Expected: FAIL — `createTestAllocator` not exported.

- [ ] **Step 3: Add the function to `block-id.ts`**

Append to `block-id.ts`:

```typescript
/**
 * Creates a deterministic allocator for tests.
 * Each call to allocate() returns `${prefix}-${n}` where n increments from 0.
 */
export function createTestAllocator(prefix = "blk"): IdAllocator {
  let n = 0;
  return { allocate: () => `${prefix}-${n++}` as BlockId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-id`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-id.ts packages/core/src/state/block-id.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add createTestAllocator for deterministic test IDs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: attrs.ts — ReadonlyAttrs type and deepValueEqual

**Files:**
- Create: `packages/core/src/state/attrs.ts`
- Test: `packages/core/src/state/attrs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/attrs.test.ts
import { describe, it, expect } from "vitest";
import { deepValueEqual } from "./attrs";

describe("deepValueEqual", () => {
  it("compares primitives", () => {
    expect(deepValueEqual(1, 1)).toBe(true);
    expect(deepValueEqual("a", "a")).toBe(true);
    expect(deepValueEqual(true, true)).toBe(true);
    expect(deepValueEqual(1, 2)).toBe(false);
    expect(deepValueEqual("a", "b")).toBe(false);
    expect(deepValueEqual(null, null)).toBe(true);
    expect(deepValueEqual(undefined, undefined)).toBe(true);
    expect(deepValueEqual(null, undefined)).toBe(false);
  });

  it("compares objects by value, recursively", () => {
    expect(deepValueEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepValueEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepValueEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepValueEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepValueEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("compares arrays by element", () => {
    expect(deepValueEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepValueEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(deepValueEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it("returns false when comparing object to array", () => {
    expect(deepValueEqual({}, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- attrs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/attrs.ts

/**
 * Open-schema attribute bag. Used at every level of the state tree:
 * - Block.attrs (block-level attributes)
 * - TextItem.attrs (inline text styles)
 * - EmbedItem.attrs (attributes that wrap an embed, e.g. link or comment-range)
 *
 * Plugins register interpreters per attribute key with the cascade module
 * to translate these open-schema values into closed-schema ComputedStyle.
 */
export type ReadonlyAttrs = Readonly<Record<string, unknown>>;

/**
 * Default deep value equality for attribute comparison and run merging.
 * Compares primitives by ===, objects by recursive key/value walk, arrays
 * by element-wise compare. Returns false when types differ (object vs array).
 */
export function deepValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;

  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepValueEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in bRec)) return false;
    if (!deepValueEqual(aRec[k], bRec[k])) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- attrs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/attrs.ts packages/core/src/state/attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add ReadonlyAttrs type and deepValueEqual helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: attrs.ts — attrsEqual

**Files:**
- Modify: `packages/core/src/state/attrs.ts`
- Modify: `packages/core/src/state/attrs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `attrs.test.ts`:

```typescript
import { attrsEqual, type ReadonlyAttrs } from "./attrs";

describe("attrsEqual", () => {
  it("returns true for identical attribute bags", () => {
    const a: ReadonlyAttrs = { bold: true, fontSize: 12 };
    const b: ReadonlyAttrs = { bold: true, fontSize: 12 };
    expect(attrsEqual(a, b)).toBe(true);
  });

  it("returns false when key sets differ", () => {
    expect(attrsEqual({ bold: true }, { bold: true, italic: true })).toBe(false);
  });

  it("returns false when a value differs", () => {
    expect(attrsEqual({ bold: true }, { bold: false })).toBe(false);
  });

  it("returns true for two empty attribute bags", () => {
    expect(attrsEqual({}, {})).toBe(true);
  });

  it("compares object-valued attributes recursively", () => {
    expect(attrsEqual({ comment: { id: "c1" } }, { comment: { id: "c1" } })).toBe(true);
    expect(attrsEqual({ comment: { id: "c1" } }, { comment: { id: "c2" } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- attrs`
Expected: FAIL — `attrsEqual` not exported.

- [ ] **Step 3: Add the function to `attrs.ts`**

Append to `attrs.ts`:

```typescript
/**
 * Compare two attribute bags for equality. Defaults to deep value equality
 * for each attribute. Phase 2 will extend this to consult an interpreter
 * registry for opt-in custom equality per attribute key (rare; for cases like
 * a `comment` attribute whose `timestamp` field shouldn't affect compare).
 */
export function attrsEqual(a: ReadonlyAttrs, b: ReadonlyAttrs): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    if (!deepValueEqual(a[k], b[k])) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- attrs`
Expected: PASS (9 tests total in `attrs.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/attrs.ts packages/core/src/state/attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add attrsEqual using deep value equality

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: inline-content.ts — types

**Files:**
- Create: `packages/core/src/state/inline-content.ts`
- Test: `packages/core/src/state/inline-content.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/inline-content.test.ts
import { describe, it, expect } from "vitest";
import {
  createTextItem,
  createEmbedItem,
  createInlineContent,
  type TextItem,
  type EmbedItem,
} from "./inline-content";

describe("inline content factories", () => {
  it("createTextItem produces a frozen text item", () => {
    const t: TextItem = createTextItem("hello", { bold: true });
    expect(t.kind).toBe("text");
    expect(t.text).toBe("hello");
    expect(t.attrs).toEqual({ bold: true });
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.attrs)).toBe(true);
  });

  it("createTextItem defaults attrs to empty bag", () => {
    const t = createTextItem("hi");
    expect(t.attrs).toEqual({});
  });

  it("createEmbedItem produces a frozen embed item", () => {
    const e: EmbedItem = createEmbedItem("image", { src: "u" }, { link: "http://x" });
    expect(e.kind).toBe("embed");
    expect(e.embedType).toBe("image");
    expect(e.properties).toEqual({ src: "u" });
    expect(e.attrs).toEqual({ link: "http://x" });
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("createInlineContent produces a frozen container", () => {
    const c = createInlineContent([createTextItem("a"), createTextItem("b")]);
    expect(c.items).toHaveLength(2);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- inline-content`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/inline-content.ts
import type { ReadonlyAttrs } from "./attrs";

/**
 * Inline content of a leaf block: an ordered sequence of styled text runs
 * and inline embed items. Adjacent text items with equal attrs should be
 * merged in a normalize pass after every Layer-3 operation (Phase 2).
 */
export interface InlineContent {
  readonly items: ReadonlyArray<InlineItem>;
}

export type InlineItem = TextItem | EmbedItem;

/** A run of styled text. `text` is in UTF-16 code units. */
export interface TextItem {
  readonly kind: "text";
  readonly text: string;
  readonly attrs: ReadonlyAttrs;
}

/**
 * An inline embed (image, mention, equation, footnote-anchor, hard-break, etc.).
 * Counts as exactly one cursor position. `properties` carries primitive embed
 * data inline, OR a contentBlockId reference for substantial-content embeds
 * (footnote anchors). `attrs` carries attributes that *wrap* the embed
 * (e.g., link, comment-range).
 */
export interface EmbedItem {
  readonly kind: "embed";
  readonly embedType: string;
  readonly attrs: ReadonlyAttrs;
  readonly properties: Readonly<Record<string, unknown>>;
}

const EMPTY_ATTRS: ReadonlyAttrs = Object.freeze({});

export function createTextItem(text: string, attrs: ReadonlyAttrs = EMPTY_ATTRS): TextItem {
  return Object.freeze({
    kind: "text",
    text,
    attrs: attrs === EMPTY_ATTRS ? attrs : Object.freeze({ ...attrs }),
  });
}

export function createEmbedItem(
  embedType: string,
  properties: Readonly<Record<string, unknown>> = {},
  attrs: ReadonlyAttrs = EMPTY_ATTRS,
): EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType,
    attrs: attrs === EMPTY_ATTRS ? attrs : Object.freeze({ ...attrs }),
    properties: Object.freeze({ ...properties }),
  });
}

export function createInlineContent(items: ReadonlyArray<InlineItem>): InlineContent {
  return Object.freeze({ items: Object.freeze([...items]) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- inline-content`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/inline-content.ts packages/core/src/state/inline-content.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add InlineContent / TextItem / EmbedItem types and factories

Adjacent-text-item merging on edit will be added in Phase 2 alongside
the Layer 3 operations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: inline-content.ts — inlineContentLength

**Files:**
- Modify: `packages/core/src/state/inline-content.ts`
- Modify: `packages/core/src/state/inline-content.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `inline-content.test.ts`:

```typescript
import { inlineContentLength } from "./inline-content";

describe("inlineContentLength", () => {
  it("returns 0 for empty content", () => {
    expect(inlineContentLength(createInlineContent([]))).toBe(0);
  });

  it("sums text lengths in UTF-16 code units", () => {
    const c = createInlineContent([createTextItem("hello"), createTextItem(" world")]);
    expect(inlineContentLength(c)).toBe(11);
  });

  it("counts each embed item as exactly 1", () => {
    const c = createInlineContent([
      createTextItem("a"),
      createEmbedItem("image"),
      createTextItem("b"),
      createEmbedItem("mention"),
    ]);
    expect(inlineContentLength(c)).toBe(4); // 1 + 1 + 1 + 1
  });

  it("counts non-BMP characters as their UTF-16 code-unit length", () => {
    // 😀 is U+1F600, which is two UTF-16 code units (surrogate pair)
    const c = createInlineContent([createTextItem("a😀b")]);
    expect(inlineContentLength(c)).toBe(4); // "a" + surrogate-high + surrogate-low + "b"
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- inline-content`
Expected: FAIL — `inlineContentLength` not exported.

- [ ] **Step 3: Add the function to `inline-content.ts`**

Append:

```typescript
/**
 * Total length of inline content, in Position.offset units.
 * Each text item contributes text.length (UTF-16 code units).
 * Each embed item contributes 1 (single cursor position).
 */
export function inlineContentLength(content: InlineContent): number {
  let total = 0;
  for (const item of content.items) {
    total += item.kind === "text" ? item.text.length : 1;
  }
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- inline-content`
Expected: PASS (8 tests in `inline-content.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/inline-content.ts packages/core/src/state/inline-content.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add inlineContentLength

Embeds count as 1 cursor position each; text contributes UTF-16
code-unit length per the offset-units design decision.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: inline-content.ts — findItemAtOffset

**Files:**
- Modify: `packages/core/src/state/inline-content.ts`
- Modify: `packages/core/src/state/inline-content.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `inline-content.test.ts`:

```typescript
import { findItemAtOffset } from "./inline-content";

describe("findItemAtOffset", () => {
  const content = createInlineContent([
    createTextItem("hello"),       // offsets 0..5
    createEmbedItem("image"),       // offset 5 (1 unit)
    createTextItem("world"),        // offsets 6..11
  ]);

  it("returns the text item containing offset 0", () => {
    expect(findItemAtOffset(content, 0)).toEqual({ itemIndex: 0, withinItem: 0 });
  });

  it("returns the text item with the offset position within it", () => {
    expect(findItemAtOffset(content, 3)).toEqual({ itemIndex: 0, withinItem: 3 });
  });

  it("returns the embed item when offset lands on the embed", () => {
    expect(findItemAtOffset(content, 5)).toEqual({ itemIndex: 1, withinItem: 0 });
  });

  it("returns the next text item when offset is past the embed", () => {
    expect(findItemAtOffset(content, 6)).toEqual({ itemIndex: 2, withinItem: 0 });
  });

  it("returns end-of-block when offset equals total length", () => {
    expect(findItemAtOffset(content, 11)).toEqual({ itemIndex: 3, withinItem: 0 });
  });

  it("returns end-of-block for empty content at offset 0", () => {
    const empty = createInlineContent([]);
    expect(findItemAtOffset(empty, 0)).toEqual({ itemIndex: 0, withinItem: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- inline-content`
Expected: FAIL — `findItemAtOffset` not exported.

- [ ] **Step 3: Add the function**

Append to `inline-content.ts`:

```typescript
/**
 * Locate the inline item containing `offset`. `withinItem` is the offset
 * into that item (0 for embed items, char-offset for text items).
 *
 * Returns `{ itemIndex: items.length, withinItem: 0 }` when offset equals
 * the total inline-content length (end-of-block).
 *
 * Behavior at item boundaries: when `offset` exactly equals the start of
 * an item (i.e., the cumulative length up to but not including item N),
 * returns `{ itemIndex: N, withinItem: 0 }`.
 */
export function findItemAtOffset(
  content: InlineContent,
  offset: number,
): { itemIndex: number; withinItem: number } {
  let cursor = 0;
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i];
    const itemLen = item.kind === "text" ? item.text.length : 1;
    if (offset < cursor + itemLen) {
      return { itemIndex: i, withinItem: offset - cursor };
    }
    cursor += itemLen;
  }
  return { itemIndex: content.items.length, withinItem: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- inline-content`
Expected: PASS (14 tests in `inline-content.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/inline-content.ts packages/core/src/state/inline-content.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add findItemAtOffset

Per the spec: text items contribute their text.length to the offset
count; embed items contribute exactly 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: block-position.ts — Position type and createPosition

**Files:**
- Create: `packages/core/src/state/block-position.ts`
- Test: `packages/core/src/state/block-position.test.ts`

> Note: this file will be renamed to `position.ts` in Phase 14 cleanup, after the old `state/position.ts` is deleted.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/block-position.test.ts
import { describe, it, expect } from "vitest";
import { createPosition, type Position } from "./block-position";
import type { BlockId } from "./block-id";

describe("createPosition", () => {
  it("constructs a frozen position", () => {
    const p: Position = createPosition("blk-0" as BlockId, 5);
    expect(p.blockId).toBe("blk-0");
    expect(p.offset).toBe(5);
    expect(Object.isFrozen(p)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- block-position`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/block-position.ts
import type { BlockId } from "./block-id";

/**
 * A position in the document: a block identifier plus a UTF-16 code-unit
 * offset within that block's inline content. Stable across edits to other
 * parts of the document (the blockId names a specific block; offsets only
 * change when the named block itself is edited).
 */
export interface Position {
  readonly blockId: BlockId;
  readonly offset: number;
}

export function createPosition(blockId: BlockId, offset: number): Position {
  return Object.freeze({ blockId, offset });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- block-position`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-position.ts packages/core/src/state/block-position.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add Position type (id-based) under block-position.ts

Temporary filename to avoid colliding with existing state/position.ts;
will be renamed to position.ts in the Phase 14 cleanup once the old
file is deleted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: block-position.ts — Span type, createSpan, positionsEqual

**Files:**
- Modify: `packages/core/src/state/block-position.ts`
- Modify: `packages/core/src/state/block-position.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `block-position.test.ts`:

```typescript
import { createSpan, positionsEqual, type Span } from "./block-position";

describe("createSpan", () => {
  it("constructs a frozen span from anchor and focus", () => {
    const a = createPosition("blk-0" as BlockId, 0);
    const b = createPosition("blk-0" as BlockId, 5);
    const s: Span = createSpan(a, b);
    expect(s.anchor).toBe(a);
    expect(s.focus).toBe(b);
    expect(Object.isFrozen(s)).toBe(true);
  });
});

describe("positionsEqual", () => {
  it("returns true for positions with equal blockId and offset", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 5);
    expect(positionsEqual(a, b)).toBe(true);
  });

  it("returns false when blockId differs", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-1" as BlockId, 5);
    expect(positionsEqual(a, b)).toBe(false);
  });

  it("returns false when offset differs", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 6);
    expect(positionsEqual(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-position`
Expected: FAIL — `Span`, `createSpan`, `positionsEqual` not exported.

- [ ] **Step 3: Add the types and functions to `block-position.ts`**

Append:

```typescript
/**
 * A span / selection range. anchor is where the selection started;
 * focus is the current end. anchor and focus must be in the same
 * selection context (validated at the action-handler level, not here).
 */
export interface Span {
  readonly anchor: Position;
  readonly focus: Position;
}

export function createSpan(anchor: Position, focus: Position): Span {
  return Object.freeze({ anchor, focus });
}

/** True iff a and b have the same blockId and offset. */
export function positionsEqual(a: Position, b: Position): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-position`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-position.ts packages/core/src/state/block-position.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add Span type and positionsEqual

Cross-block compare (compareBlocksInDocOrder via LCA walk) lives in
block-compare.ts as a Layer 2 utility, added in Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: block-position.ts — comparePositions (within-block only)

**Files:**
- Modify: `packages/core/src/state/block-position.ts`
- Modify: `packages/core/src/state/block-position.test.ts`

> Note: this is the within-block compare. Cross-block compare requires walking the block tree (LCA) and lives in Layer 2's `block-compare.ts` (Phase 2).

- [ ] **Step 1: Write the failing tests**

Append to `block-position.test.ts`:

```typescript
import { comparePositionsWithinBlock } from "./block-position";

describe("comparePositionsWithinBlock", () => {
  it("returns negative when a.offset < b.offset (same block)", () => {
    const a = createPosition("blk-0" as BlockId, 1);
    const b = createPosition("blk-0" as BlockId, 5);
    expect(comparePositionsWithinBlock(a, b)).toBeLessThan(0);
  });

  it("returns positive when a.offset > b.offset (same block)", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 1);
    expect(comparePositionsWithinBlock(a, b)).toBeGreaterThan(0);
  });

  it("returns 0 when positions are equal (same block)", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-0" as BlockId, 5);
    expect(comparePositionsWithinBlock(a, b)).toBe(0);
  });

  it("throws when blockIds differ", () => {
    const a = createPosition("blk-0" as BlockId, 5);
    const b = createPosition("blk-1" as BlockId, 5);
    expect(() => comparePositionsWithinBlock(a, b)).toThrow(/different blocks/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- block-position`
Expected: FAIL — `comparePositionsWithinBlock` not exported.

- [ ] **Step 3: Add the function**

Append to `block-position.ts`:

```typescript
/**
 * Compare two positions in the same block. Returns negative/zero/positive
 * by offset. Throws if blockIds differ — cross-block compare requires
 * walking the block tree and lives in `block-compare.ts` (Layer 2 utility,
 * added in Phase 2).
 */
export function comparePositionsWithinBlock(a: Position, b: Position): number {
  if (a.blockId !== b.blockId) {
    throw new Error(
      `comparePositionsWithinBlock called on positions in different blocks (` +
      `${a.blockId} vs ${b.blockId}); use compareBlocksInDocOrder for cross-block compare`,
    );
  }
  return a.offset - b.offset;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- block-position`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block-position.ts packages/core/src/state/block-position.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add comparePositionsWithinBlock

Within-block compare only; cross-block compare lives in Layer 2's
block-compare.ts (Phase 2) where the LCA walk has access to the State
to traverse parent/child links.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: block.ts — Block interface and createBlock factory

**Files:**
- Create: `packages/core/src/state/block.ts`
- Test: `packages/core/src/state/block.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/block.test.ts
import { describe, it, expect } from "vitest";
import { createBlock, type Block } from "./block";
import { createInlineContent, createTextItem } from "./inline-content";
import type { BlockId } from "./block-id";

describe("createBlock", () => {
  it("constructs a frozen container block (no inlineContent)", () => {
    const b: Block = createBlock({
      id: "doc-0" as BlockId,
      type: "document",
      attrs: {},
    });
    expect(b.id).toBe("doc-0");
    expect(b.type).toBe("document");
    expect(b.attrs).toEqual({});
    expect(b.parentId).toBeNull();
    expect(b.prevSiblingId).toBeNull();
    expect(b.nextSiblingId).toBeNull();
    expect(b.firstChildId).toBeNull();
    expect(b.lastChildId).toBeNull();
    expect(b.inlineContent).toBeNull();
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b.attrs)).toBe(true);
  });

  it("constructs a frozen leaf block with inline content", () => {
    const content = createInlineContent([createTextItem("hello")]);
    const b: Block = createBlock({
      id: "para-0" as BlockId,
      type: "paragraph",
      attrs: { textAlign: "left" },
      inlineContent: content,
    });
    expect(b.inlineContent).toBe(content);
    expect(b.attrs).toEqual({ textAlign: "left" });
    expect(Object.isFrozen(b)).toBe(true);
  });

  it("accepts and stores link pointers", () => {
    const b = createBlock({
      id: "para-1" as BlockId,
      type: "paragraph",
      attrs: {},
      parentId: "doc-0" as BlockId,
      prevSiblingId: "para-0" as BlockId,
      nextSiblingId: "para-2" as BlockId,
    });
    expect(b.parentId).toBe("doc-0");
    expect(b.prevSiblingId).toBe("para-0");
    expect(b.nextSiblingId).toBe("para-2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- "src/state/block.test"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/block.ts
import type { ReadonlyAttrs } from "./attrs";
import type { BlockId } from "./block-id";
import type { InlineContent } from "./inline-content";

/**
 * A single block in the document tree.
 *
 * - Container blocks (section, list, table, table-row, etc.) hold child
 *   blocks via the firstChildId/lastChildId linked list and have no
 *   inlineContent of their own.
 * - Leaf blocks (paragraph, list-item, heading, table-cell, etc.) carry
 *   inlineContent (text runs + embed items) and have no children.
 *
 * All sibling/child links are by id; resolving them requires the parent
 * State.blocks map.
 */
export interface Block {
  readonly id: BlockId;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly parentId: BlockId | null;
  readonly prevSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
  readonly firstChildId: BlockId | null;
  readonly lastChildId: BlockId | null;
  readonly inlineContent: InlineContent | null;
}

export interface CreateBlockArgs {
  id: BlockId;
  type: string;
  attrs?: ReadonlyAttrs;
  parentId?: BlockId | null;
  prevSiblingId?: BlockId | null;
  nextSiblingId?: BlockId | null;
  firstChildId?: BlockId | null;
  lastChildId?: BlockId | null;
  inlineContent?: InlineContent | null;
}

export function createBlock(args: CreateBlockArgs): Block {
  return Object.freeze({
    id: args.id,
    type: args.type,
    attrs: Object.freeze({ ...(args.attrs ?? {}) }),
    parentId: args.parentId ?? null,
    prevSiblingId: args.prevSiblingId ?? null,
    nextSiblingId: args.nextSiblingId ?? null,
    firstChildId: args.firstChildId ?? null,
    lastChildId: args.lastChildId ?? null,
    inlineContent: args.inlineContent ?? null,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- "src/state/block.test"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/block.ts packages/core/src/state/block.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add Block interface and createBlock factory

Frozen, immutable. Doubly-linked-list child pointers per the spec;
container vs leaf shape distinguished by inlineContent presence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: state.ts — State interface, createState, OperationResult type

**Files:**
- Create: `packages/core/src/state/state.ts`
- Test: `packages/core/src/state/state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/state.test.ts
import { describe, it, expect } from "vitest";
import { createState, type State } from "./state";
import { createBlock } from "./block";
import { createPersistentMap } from "./persistent-map";
import type { BlockId } from "./block-id";

describe("createState", () => {
  it("constructs a frozen State with the given root and blocks", () => {
    const root = createBlock({ id: "doc-0" as BlockId, type: "document" });
    const blocks = createPersistentMap<BlockId, ReturnType<typeof createBlock>>([
      ["doc-0" as BlockId, root],
    ]);
    const s: State = createState({ rootId: "doc-0" as BlockId, blocks });
    expect(s.rootId).toBe("doc-0");
    expect(s.blocks.get("doc-0" as BlockId)).toBe(root);
    expect(Object.isFrozen(s)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- "src/state/state.test"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/state.ts
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import type { PersistentMap } from "./persistent-map";

/**
 * The full document state. blocks holds the main document tree (reachable
 * from rootId via parent/child links). Embed-referenced sub-trees (footnote
 * bodies) live in a separate map added in a later phase.
 */
export interface State {
  readonly rootId: BlockId;
  readonly blocks: PersistentMap<BlockId, Block>;
}

export function createState(args: {
  rootId: BlockId;
  blocks: PersistentMap<BlockId, Block>;
}): State {
  return Object.freeze({
    rootId: args.rootId,
    blocks: args.blocks,
  });
}

/**
 * Result of every Layer 3 state-mutating operation. The dirtyIds set is
 * produced at write-time by the operation itself, not via post-hoc tree
 * comparison. The rendering pipeline consumes dirtyIds directly to know
 * which blocks need re-rendering.
 */
export interface OperationResult {
  readonly state: State;
  readonly dirtyIds: ReadonlySet<BlockId>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- "src/state/state.test"`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/state.ts packages/core/src/state/state.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add State container and OperationResult types

OperationResult is referenced by Layer 3 operations (Phase 2);
defined here so Layer 1 consumers can type-check signatures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: new-initial-state.ts — createEmptyDocument

**Files:**
- Create: `packages/core/src/state/new-initial-state.ts`
- Test: `packages/core/src/state/new-initial-state.test.ts`

> Note: file is temporarily named `new-initial-state.ts` to avoid colliding with the existing `state/initial-state.ts`. Phase 14 cleanup renames it to `initial-state.ts` after the old file is deleted.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/state/new-initial-state.test.ts
import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "./new-initial-state";
import { createTestAllocator } from "./block-id";

describe("createEmptyDocument", () => {
  it("produces a document with one empty paragraph", () => {
    const allocator = createTestAllocator();
    const state = createEmptyDocument(allocator);

    // Two blocks were allocated: the document and the paragraph.
    expect([...state.blocks.keys()].sort()).toEqual(["blk-0", "blk-1"]);

    const root = state.blocks.get(state.rootId);
    expect(root).toBeDefined();
    if (!root) return;
    expect(root.type).toBe("document");
    expect(root.parentId).toBeNull();
    expect(root.firstChildId).toBe("blk-1");
    expect(root.lastChildId).toBe("blk-1");

    const para = state.blocks.get("blk-1" as Parameters<typeof state.blocks.get>[0]);
    expect(para).toBeDefined();
    if (!para) return;
    expect(para.type).toBe("paragraph");
    expect(para.parentId).toBe(root.id);
    expect(para.prevSiblingId).toBeNull();
    expect(para.nextSiblingId).toBeNull();
    expect(para.inlineContent).toEqual({ items: [] });
  });

  it("uses fresh ids for each call (deterministic with the test allocator)", () => {
    const a1 = createTestAllocator();
    const a2 = createTestAllocator();
    const s1 = createEmptyDocument(a1);
    const s2 = createEmptyDocument(a2);
    expect(s1.rootId).toBe(s2.rootId); // both start at blk-0 with their own counters
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- new-initial-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/state/new-initial-state.ts
import type { IdAllocator } from "./block-id";
import { createBlock } from "./block";
import { createInlineContent } from "./inline-content";
import { createPersistentMap } from "./persistent-map";
import { createState, type State } from "./state";

/**
 * Build the minimum valid document: a document root with a single empty
 * paragraph child. Both blocks have fresh ids from the allocator.
 */
export function createEmptyDocument(allocator: IdAllocator): State {
  const docId = allocator.allocate();
  const paraId = allocator.allocate();

  const para = createBlock({
    id: paraId,
    type: "paragraph",
    parentId: docId,
    inlineContent: createInlineContent([]),
  });

  const doc = createBlock({
    id: docId,
    type: "document",
    firstChildId: paraId,
    lastChildId: paraId,
  });

  const blocks = createPersistentMap([
    [docId, doc] as const,
    [paraId, para] as const,
  ]);

  return createState({ rootId: docId, blocks });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- new-initial-state`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/new-initial-state.ts packages/core/src/state/new-initial-state.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add createEmptyDocument factory under new-initial-state.ts

Produces a State with a document root containing one empty paragraph.
Will be renamed to initial-state.ts in Phase 14 cleanup once the old
file is deleted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: test-utils/state-builders.ts — text() and embed() helpers

**Files:**
- Create: `packages/core/src/test-utils/state-builders.ts`
- Test: `packages/core/src/test-utils/state-builders.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/test-utils/state-builders.test.ts
import { describe, it, expect } from "vitest";
import { text, embed } from "./state-builders";

describe("text helper", () => {
  it("produces a TextItem with the given string and attrs", () => {
    const t = text("hello", { bold: true });
    expect(t.kind).toBe("text");
    expect(t.text).toBe("hello");
    expect(t.attrs).toEqual({ bold: true });
  });

  it("defaults attrs to empty bag", () => {
    const t = text("hi");
    expect(t.attrs).toEqual({});
  });
});

describe("embed helper", () => {
  it("produces an EmbedItem with the given type, properties, and attrs", () => {
    const e = embed("image", { src: "u" }, { link: "http://x" });
    expect(e.kind).toBe("embed");
    expect(e.embedType).toBe("image");
    expect(e.properties).toEqual({ src: "u" });
    expect(e.attrs).toEqual({ link: "http://x" });
  });

  it("defaults properties and attrs to empty", () => {
    const e = embed("hard-break");
    expect(e.properties).toEqual({});
    expect(e.attrs).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- state-builders`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/test-utils/state-builders.ts
import { createTextItem, createEmbedItem } from "../state/inline-content";
import type { TextItem, EmbedItem } from "../state/inline-content";
import type { ReadonlyAttrs } from "../state/attrs";

/**
 * Convenience wrappers around createTextItem / createEmbedItem for use in
 * tests. Identical behavior; shorter call sites.
 */
export function text(content: string, attrs?: ReadonlyAttrs): TextItem {
  return createTextItem(content, attrs);
}

export function embed(
  embedType: string,
  properties?: Readonly<Record<string, unknown>>,
  attrs?: ReadonlyAttrs,
): EmbedItem {
  return createEmbedItem(embedType, properties, attrs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- state-builders`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/test-utils/state-builders.ts packages/core/src/test-utils/state-builders.test.ts
git commit -m "$(cat <<'EOF'
feat(test-utils): add text() and embed() inline-item helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: test-utils/state-builders.ts — buildBlock and buildState

**Files:**
- Modify: `packages/core/src/test-utils/state-builders.ts`
- Modify: `packages/core/src/test-utils/state-builders.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `state-builders.test.ts`:

```typescript
import { buildBlock, buildState } from "./state-builders";
import { createTestAllocator } from "../state/block-id";
import { createInlineContent } from "../state/inline-content";

describe("buildBlock", () => {
  it("produces a leaf block with given id, type, attrs, and inline content", () => {
    const b = buildBlock({
      id: "para-0",
      type: "paragraph",
      attrs: { textAlign: "left" },
      inlineContent: createInlineContent([text("hello")]),
    });
    expect(b.id).toBe("para-0");
    expect(b.type).toBe("paragraph");
    expect(b.attrs).toEqual({ textAlign: "left" });
    expect(b.inlineContent?.items).toHaveLength(1);
  });

  it("produces a container block with children", () => {
    const b = buildBlock({
      id: "doc-0",
      type: "document",
      firstChildId: "para-0",
      lastChildId: "para-1",
    });
    expect(b.firstChildId).toBe("para-0");
    expect(b.lastChildId).toBe("para-1");
    expect(b.inlineContent).toBeNull();
  });
});

describe("buildState", () => {
  it("produces a state with the given root and blocks", () => {
    const allocator = createTestAllocator();
    const docId = allocator.allocate();
    const paraId = allocator.allocate();
    const doc = buildBlock({
      id: docId,
      type: "document",
      firstChildId: paraId,
      lastChildId: paraId,
    });
    const para = buildBlock({
      id: paraId,
      type: "paragraph",
      parentId: docId,
      inlineContent: createInlineContent([text("hello")]),
    });
    const s = buildState({ rootId: docId, blocks: [doc, para] });
    expect(s.rootId).toBe(docId);
    expect(s.blocks.size).toBe(2);
    expect(s.blocks.get(docId)?.type).toBe("document");
    expect(s.blocks.get(paraId)?.type).toBe("paragraph");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- state-builders`
Expected: FAIL — `buildBlock` and `buildState` not exported.

- [ ] **Step 3: Add the helpers**

Append to `state-builders.ts`:

```typescript
import { createBlock, type Block, type CreateBlockArgs } from "../state/block";
import { createPersistentMap } from "../state/persistent-map";
import { createState, type State } from "../state/state";
import type { BlockId } from "../state/block-id";

/**
 * Convenience wrapper around createBlock. Accepts plain string ids
 * (cast to BlockId) so test code reads naturally.
 */
export function buildBlock(args: {
  id: string;
  type: string;
  attrs?: Record<string, unknown>;
  parentId?: string | null;
  prevSiblingId?: string | null;
  nextSiblingId?: string | null;
  firstChildId?: string | null;
  lastChildId?: string | null;
  inlineContent?: import("../state/inline-content").InlineContent | null;
}): Block {
  const opts: CreateBlockArgs = {
    id: args.id as BlockId,
    type: args.type,
    attrs: args.attrs,
    parentId: (args.parentId ?? null) as BlockId | null,
    prevSiblingId: (args.prevSiblingId ?? null) as BlockId | null,
    nextSiblingId: (args.nextSiblingId ?? null) as BlockId | null,
    firstChildId: (args.firstChildId ?? null) as BlockId | null,
    lastChildId: (args.lastChildId ?? null) as BlockId | null,
    inlineContent: args.inlineContent,
  };
  return createBlock(opts);
}

/**
 * Convenience wrapper that constructs a State from a list of blocks plus
 * a root id. Tests pass blocks in any order; the helper builds the
 * persistent map.
 */
export function buildState(args: { rootId: string; blocks: ReadonlyArray<Block> }): State {
  const entries = args.blocks.map((b) => [b.id, b] as const);
  return createState({
    rootId: args.rootId as BlockId,
    blocks: createPersistentMap(entries),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- state-builders`
Expected: PASS (8 tests in `state-builders.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/test-utils/state-builders.ts packages/core/src/test-utils/state-builders.test.ts
git commit -m "$(cat <<'EOF'
feat(test-utils): add buildBlock and buildState helpers

Plain-string id args make test code read naturally (no need to cast
literals to BlockId at every call site).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Verify the whole package still builds and all tests pass

This is the green-build checkpoint for Phase 1. We added 9 new files (plus their tests); we changed nothing existing. The build and full test suite should still pass.

- [ ] **Step 1: Run the full type checker**

Run: `npm run build --workspace=packages/core`
Expected: PASS (no TypeScript errors).

If it fails, fix errors before continuing. Likely issues:
- Missing `crypto.randomUUID` types in older `@types/node`. Check `tsconfig.json` `lib` settings include `"DOM"` or `"Node22"+`.
- Branded-type assignability issues. Use `as BlockId` casts at allocator boundaries; never use raw strings as BlockIds in production code.

- [ ] **Step 2: Run the full test suite**

Run: `npm test --workspace=packages/core`
Expected: PASS — all existing tests still green AND all new tests added by this phase pass.

If existing tests fail, that means we accidentally modified something we shouldn't have. Phase 1 is purely additive; nothing existing should break. Investigate before continuing.

- [ ] **Step 3: Verify the new exports are not yet wired into the public API**

Run: `grep -E "(persistent-map|block-id|attrs|inline-content|block-position|^export.*\bBlock\b|^export.*\bState\b|new-initial-state)" packages/core/src/index.ts`
Expected: empty output. The new types are not exported from the public API yet — that wiring lands in Phase 14 (cleanup) once the old types are removed.

- [ ] **Step 4: Commit a marker (optional, skip if no changes)**

If everything passed without modifications, skip commit. If you needed to fix a tsconfig or similar, commit those changes:

```bash
git status
# If only the deliberate Phase 1 files have changed, no commit needed.
# If something else changed (e.g., tsconfig.json), commit it with:
git add <fixed files>
git commit -m "$(cat <<'EOF'
chore(state): green-build checkpoint after Phase 1 foundation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Phase 1 retrospective + Phase 2 prep

This is a checkpoint task — no code changes, no commits. The goal is to verify Phase 1 landed correctly and capture anything for Phase 2.

- [ ] **Step 1: Verify the file inventory matches the plan**

Run: `ls packages/core/src/state/*.ts | sort`
Expected to see (among the existing files) these new ones:
- `attrs.ts`, `attrs.test.ts`
- `block-id.ts`, `block-id.test.ts`
- `block-position.ts`, `block-position.test.ts`
- `block.ts`, `block.test.ts`
- `inline-content.ts`, `inline-content.test.ts`
- `new-initial-state.ts`, `new-initial-state.test.ts`
- `persistent-map.ts`, `persistent-map.test.ts`
- `state.ts`, `state.test.ts`

Run: `ls packages/core/src/test-utils/*.ts | sort`
Expected to see (among existing): `state-builders.ts`, `state-builders.test.ts`.

- [ ] **Step 2: Verify the existing state files are untouched**

Run: `git log --oneline -- packages/core/src/state/state-node.ts packages/core/src/state/position.ts packages/core/src/state/initial-state.ts | head -5`
Expected: no commits since Phase 1 began. Phase 1 did not modify any existing state file.

- [ ] **Step 3: Verify the spec's "Definition of done" file inventory is on track for Phase 1**

Open `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` and read the "Definition of done > File inventory" section. The Phase 1 deliverables are:
- ✅ `persistent-map.ts`
- ✅ `block-id.ts`
- ✅ `attrs.ts`
- ✅ `inline-content.ts`
- ✅ `block.ts`
- ✅ `state.ts`
- ✅ Position type (in `block-position.ts`, to be renamed in Phase 14)
- ✅ Initial-state factory (in `new-initial-state.ts`, to be renamed in Phase 14)

Phase 2 will add: `block-traversal.ts`, `block-compare.ts`, `span-iteration.ts`, `extract-text.ts` (Layer 2), then `operations.ts`, `insert-text.ts`, `delete-range.ts`, `split-block.ts`, `merge-blocks.ts`, `apply-attrs.ts` (Layer 3). After Phase 2, we begin breaking-change cutover (delete old state files, migrate consumers).

- [ ] **Step 4: Surface anything Phase 2 should account for**

Add notes to the spec's "Open questions" section if the implementation uncovered anything that should inform Phase 2's design. Examples to look for:
- Did any test fixture pattern emerge that should be added to `state-builders.ts` before Phase 2?
- Did TypeScript strict-mode flag any type-safety issues that suggest tightening the types?
- Are there any helpers you wrote inline (e.g., a frozen-deep-equal) that should be promoted to a shared utility?

If yes, edit the spec to capture them; commit the edit:

```bash
git add docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md
git commit -m "$(cat <<'EOF'
docs(spec): notes from Phase 1 implementation for Phase 2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no notes, skip the commit. Phase 1 is complete; the next plan (Phase 2: Layer 2 utilities) can be written when ready.

---

## Self-review

Quick checklist run after writing this plan:

**Spec coverage** (Phase 1 scope only — Layer 1 + persistent-map + test-utils):
- ✅ `persistent-map.ts` — Tasks 1-3
- ✅ `block-id.ts` (BlockId branded, IdAllocator, productionAllocator, createTestAllocator) — Tasks 4-5
- ✅ `attrs.ts` (ReadonlyAttrs, deepValueEqual, attrsEqual) — Tasks 6-7
- ✅ `inline-content.ts` (types + inlineContentLength + findItemAtOffset) — Tasks 8-10
- ✅ `block-position.ts` (Position, Span, positionsEqual, comparePositionsWithinBlock) — Tasks 11-13
- ✅ `block.ts` (Block + createBlock) — Task 14
- ✅ `state.ts` (State + createState + OperationResult) — Task 15
- ✅ `new-initial-state.ts` (createEmptyDocument) — Task 16
- ✅ `test-utils/state-builders.ts` (text, embed, buildBlock, buildState) — Tasks 17-18
- ✅ Green-build checkpoint — Task 19
- ✅ Retrospective — Task 20

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" patterns. Each step has actual code or commands.

**Type consistency:** `BlockId`, `IdAllocator`, `Block`, `State`, `InlineContent`, `TextItem`, `EmbedItem`, `Position`, `Span`, `OperationResult` are referenced consistently across tasks. Function signatures (`createBlock(args)`, `createState({rootId, blocks})`, `createEmptyDocument(allocator)`, `text(content, attrs?)`, `embed(type, properties?, attrs?)`) are stable.

**Out of scope for this plan (deferred to subsequent phases):**
- Layer 2 utilities: `nextBlockInDocOrder`, `prevBlockInDocOrder`, `ancestorChain`, `compareBlocksInDocOrder`, `iterateSpan`, `iterateBlocksInSpan`, `extractText`, `findItemAtOffset` cross-block variants. → Phase 2.
- Layer 3 operations: `insertText`, `deleteRange`, `splitBlockAtPosition`, `mergeAdjacentBlocks`, `applyAttrsToRange`, etc. → Phase 2.
- Cascade attribute-interpreter pipeline. → Phase 3.
- Render module rewrite, components rewrite, editor migration. → Phases 4-6.
- Cursor adaptation, layout/styles cleanup, integration tests. → Phases 7-9.
- Performance benchmarks, documentation updates, final greening. → Phases 10-11.

The Phase 1 plan above produces ~9 new source files + tests, ~20 commits, and leaves the build green. Estimated execution time: 1-2 days for a developer following the plan.

# State module redesign — Phase 3: cascade attribute-interpreter pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the **cascade attribute-interpreter pipeline** — the architectural piece that translates open-schema state attributes (`Block.attrs`, `TextItem.attrs`, `EmbedItem.attrs`) into closed-schema `ComputedStyle` contributions via per-attribute-key registered interpreters. This is the bridge between the open extensible attribute schema (Phase 1's `attrs.ts`) and the existing closed `ComputedStyle` consumed by layout. Phase 3 is purely additive — no existing files modified, build remains green throughout. The new registry and built-in interpreters are ready to be wired by the render-module rewrite in a subsequent phase.

**Architecture:** Per the design spec at `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`, "Cascade attribute-interpreter pipeline" section. The registry is a singleton-style `AttrRegistry` exposing `register`, `get`, `applyAll`. Built-in interpreters cover the standard text styles (bold, italic, underline, fontFamily, fontSize, color, backgroundColor, etc.). Plugins register interpreters for new attributes (highlight, comment-range, change-tracking marks) without touching core types. The cascade pass calls `applyAll(attrs, ctx)` to get a `Partial<ComputedStyle>` contribution to merge into the node's resolved style.

**Tech Stack:** TypeScript 5.7, vitest 3.0, npm workspaces. Test runner: `npm test --workspace=packages/core`. Type checker: `npm run build --workspace=packages/core`.

**Spec reference:** `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md`. This plan implements the "Cascade attribute-interpreter pipeline" section (lines describing `AttrInterpreter`, `AttrRegistry`, the `attrKey → toComputedStyle` mapping, and the built-in registrations).

**Phase 1 + 2 status (assumed complete):**
- Phase 1 ended at commit `4230343` — Layer 1 types in `packages/core/src/state/{persistent-map, block-id, attrs, inline-content, block-position, block, state, new-initial-state}.ts` plus `test-utils/state-builders.ts`.
- Phase 2 ended at commit `b27bffa` (with hardening) — Layer 2 utilities in `packages/core/src/state/{block-traversal, block-compare, span-iteration, new-extract-text}.ts`.
- Build green; 960 tests passing + 4 skipped.

**Per-phase scope notes:**

- New files at top-level paths in `packages/core/src/cascade/`. Specifically: this phase adds `attr-registry.ts` and `builtin-attrs.ts`, both new files with no name collisions.
- The existing `cascade/cascade-pass.ts` is the OLD pipeline (consumes render trees with closed `Style` field). Phase 3 does NOT modify it. The render module rewrite in a later phase will produce render trees that carry open `attrs`, at which point a new cascade pass (or a modified version of the existing one) will use the registry. Phase 3 just lays the foundation.
- No existing files modified. Build remains green throughout.
- Per CLAUDE.md: TDD throughout. Write tests first, see them fail, implement, see them pass, commit.
- Per memory `feedback_no_auto_commit.md`: commit on user's behalf at the end of each task.
- Type safety: no non-null assertions (`!`); use proper narrowing.

**Note on current `Style` and `ComputedStyle` types:** The existing `packages/core/src/styles/` module defines `Style` (declarable) and `ComputedStyle` (post-cascade). `Style` is closed-schema. The interpreter pipeline produces `Partial<ComputedStyle>` contributions that merge into the cascade's running result. Phase 3 imports `ComputedStyle` (to use as the contribution type) but does NOT modify the styles module.

---

## File structure (this phase)

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/cascade/attr-registry.ts` | `AttrInterpreter` interface, `AttrRegistry` class with `register` / `get` / `has` / `applyAll`, default singleton instance `attrRegistry`. |
| `packages/core/src/cascade/attr-registry.test.ts` | Unit tests for registry CRUD, applyAll merging semantics, and equality opt-in. |
| `packages/core/src/cascade/builtin-attrs.ts` | Built-in interpreters for the standard text styles: bold, italic, underline, fontFamily, fontSize, color, backgroundColor. Plus `registerBuiltinAttrs(registry)` convenience that registers all of them. |
| `packages/core/src/cascade/builtin-attrs.test.ts` | Unit tests for each built-in interpreter's `toComputedStyle` output. |

**Modified:** none (Phase 3 is purely additive).

**Deleted:** none.

---

## Task 1: attr-registry.ts — AttrInterpreter interface

**Files:**
- Create: `packages/core/src/cascade/attr-registry.ts`
- Test: `packages/core/src/cascade/attr-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/cascade/attr-registry.test.ts
import { describe, it, expect } from "vitest";
import type { AttrInterpreter } from "./attr-registry";

describe("AttrInterpreter type", () => {
  it("can be implemented with the minimal required fields", () => {
    const i: AttrInterpreter = {
      attrKey: "bold",
      toComputedStyle: (value) => (value ? { fontWeight: "bold" } : {}),
    };
    expect(i.attrKey).toBe("bold");
    expect(i.toComputedStyle(true)).toEqual({ fontWeight: "bold" });
    expect(i.toComputedStyle(false)).toEqual({});
  });

  it("can include an optional equals function", () => {
    const i: AttrInterpreter = {
      attrKey: "comment",
      toComputedStyle: () => ({}),
      equals: (a, b) => (a as { id: string }).id === (b as { id: string }).id,
    };
    expect(i.equals?.({ id: "c1", timestamp: 1 }, { id: "c1", timestamp: 2 })).toBe(true);
    expect(i.equals?.({ id: "c1" }, { id: "c2" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/cascade/attr-registry.ts
import type { ComputedStyle } from "../styles";

/**
 * An interpreter for one attribute key. Translates the open-schema
 * attribute value into a Partial<ComputedStyle> contribution.
 *
 * `equals` is optional: when present, it overrides default deep value
 * equality for run-merging compares (used by the inline-content normalizer
 * to decide if two adjacent text items have equivalent attrs). Most
 * interpreters don't need this; rare cases (e.g. a `comment` attribute
 * whose `timestamp` field shouldn't affect compare) can opt in.
 */
export interface AttrInterpreter {
  readonly attrKey: string;
  toComputedStyle(value: unknown, ctx?: CascadeContext): Partial<ComputedStyle>;
  equals?(a: unknown, b: unknown): boolean;
}

/**
 * Cascade context — passed to interpreters that need information about
 * the surrounding cascade state (parent style for inheritance, etc.).
 * Phase 3 defines the type but doesn't yet populate it; later phases
 * extend it as cascade integration progresses.
 */
export interface CascadeContext {
  readonly parentComputedStyle?: ComputedStyle;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/attr-registry.ts packages/core/src/cascade/attr-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add AttrInterpreter and CascadeContext interfaces

Phase 3 of state-model redesign. AttrInterpreter is the per-attribute-key
contract used to translate open-schema attribute values into closed-schema
ComputedStyle contributions. The optional equals() field lets interpreters
opt into custom equality (rare; for cases like comment attributes whose
timestamp shouldn't affect compare).

CascadeContext is the structure passed to interpreters that need
information about the surrounding cascade state (parent style for
inheritance). Defined now; populated by later phases as the cascade
integration progresses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Context

**Working directory:** `/Users/hansyu/code/taleweaver/`
**Branch:** `feature/dom-architecture-redesign` (commit directly here, no branch switching).

**Where this fits:** Phase 3 task 1 of 9. The state module's open-schema attributes (Phase 1's `attrs.ts`) need a translation layer to produce closed-schema `ComputedStyle` consumed by layout. This task defines the interpreter type. Tasks 2-4 add the registry. Tasks 5-8 add built-in interpreters. Task 9 is verification + retrospective.

**Important:** Phase 3 is purely additive. Modify only the two listed files. Do NOT modify the existing `cascade/cascade-pass.ts` or any file in `styles/`.

**Conventions:** TDD; HEREDOC commit message verbatim; auto-commit on user's behalf; vitest 3.0; no non-null assertions.

---

## Task 2: attr-registry.ts — AttrRegistry class with register/get/has

**Files:**
- Modify: `packages/core/src/cascade/attr-registry.ts`
- Modify: `packages/core/src/cascade/attr-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `attr-registry.test.ts`:

```typescript
import { AttrRegistry } from "./attr-registry";

describe("AttrRegistry", () => {
  it("starts empty", () => {
    const r = new AttrRegistry();
    expect(r.has("bold")).toBe(false);
    expect(r.get("bold")).toBeUndefined();
  });

  it("registers and retrieves an interpreter", () => {
    const r = new AttrRegistry();
    const i: AttrInterpreter = {
      attrKey: "bold",
      toComputedStyle: (v) => (v ? { fontWeight: "bold" } : {}),
    };
    r.register(i);
    expect(r.has("bold")).toBe(true);
    expect(r.get("bold")).toBe(i);
  });

  it("re-registering the same key replaces the previous interpreter", () => {
    const r = new AttrRegistry();
    const i1: AttrInterpreter = { attrKey: "bold", toComputedStyle: () => ({}) };
    const i2: AttrInterpreter = { attrKey: "bold", toComputedStyle: () => ({ fontWeight: "bold" }) };
    r.register(i1);
    r.register(i2);
    expect(r.get("bold")).toBe(i2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: FAIL — `AttrRegistry` not exported.

- [ ] **Step 3: Add the class**

Append to `attr-registry.ts`:

```typescript
/**
 * Registry of attribute interpreters, keyed by attrKey. Production code
 * uses the default singleton instance `attrRegistry`; tests can construct
 * their own instances to avoid global-state bleed.
 *
 * Re-registering the same key replaces the previous interpreter (the
 * built-in `bold` can be overridden by a plugin's stronger version).
 */
export class AttrRegistry {
  private readonly interpreters = new Map<string, AttrInterpreter>();

  register(interpreter: AttrInterpreter): void {
    this.interpreters.set(interpreter.attrKey, interpreter);
  }

  has(attrKey: string): boolean {
    return this.interpreters.has(attrKey);
  }

  get(attrKey: string): AttrInterpreter | undefined {
    return this.interpreters.get(attrKey);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: PASS (5 tests in `attr-registry.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/attr-registry.ts packages/core/src/cascade/attr-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add AttrRegistry class with register/has/get

Re-registering the same key replaces the previous interpreter
(plugins can override built-ins). Singleton instance and applyAll
operation come in Tasks 3-4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: attr-registry.ts — applyAll merging

**Files:**
- Modify: `packages/core/src/cascade/attr-registry.ts`
- Modify: `packages/core/src/cascade/attr-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `attr-registry.test.ts`:

```typescript
import type { ReadonlyAttrs } from "../state/attrs";

describe("AttrRegistry.applyAll", () => {
  it("returns an empty contribution when attrs is empty", () => {
    const r = new AttrRegistry();
    expect(r.applyAll({})).toEqual({});
  });

  it("ignores attrs that have no registered interpreter", () => {
    const r = new AttrRegistry();
    const attrs: ReadonlyAttrs = { unknownKey: "value" };
    expect(r.applyAll(attrs)).toEqual({});
  });

  it("invokes the interpreter for each registered attr key and merges contributions", () => {
    const r = new AttrRegistry();
    r.register({ attrKey: "bold", toComputedStyle: (v) => (v ? { fontWeight: "bold" } : {}) });
    r.register({ attrKey: "italic", toComputedStyle: (v) => (v ? { fontStyle: "italic" } : {}) });

    const attrs: ReadonlyAttrs = { bold: true, italic: true };
    expect(r.applyAll(attrs)).toEqual({ fontWeight: "bold", fontStyle: "italic" });
  });

  it("later contributions override earlier ones for the same ComputedStyle property", () => {
    const r = new AttrRegistry();
    r.register({ attrKey: "link", toComputedStyle: () => ({ color: "blue" }) });
    r.register({ attrKey: "visitedLink", toComputedStyle: () => ({ color: "purple" }) });

    // Iteration order matches Map insertion order; visitedLink registered last,
    // so its contribution overrides.
    const attrs: ReadonlyAttrs = { link: true, visitedLink: true };
    expect(r.applyAll(attrs)).toEqual({ color: "purple" });
  });

  it("passes the cascade context through to interpreters when provided", () => {
    const r = new AttrRegistry();
    r.register({
      attrKey: "inheritedColor",
      toComputedStyle: (_value, ctx) => ({ color: ctx?.parentComputedStyle?.color ?? "black" }),
    });
    expect(r.applyAll({ inheritedColor: true })).toEqual({ color: "black" });
    expect(
      r.applyAll(
        { inheritedColor: true },
        { parentComputedStyle: { color: "red" } as never },
      ),
    ).toEqual({ color: "red" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: FAIL — `AttrRegistry` instance has no `applyAll` method.

- [ ] **Step 3: Add the method**

Add to `AttrRegistry` class in `attr-registry.ts` (extend the class body — do NOT replace the existing `register`/`has`/`get` methods):

```typescript
  /**
   * Run all registered interpreters whose attrKey matches a key in `attrs`.
   * Merge contributions into a single Partial<ComputedStyle>. Later
   * contributions override earlier ones for the same ComputedStyle property
   * (per the registry's iteration order, which is registration order).
   */
  applyAll(attrs: import("../state/attrs").ReadonlyAttrs, ctx?: CascadeContext): Partial<ComputedStyle> {
    const out: Partial<ComputedStyle> = {};
    for (const [key, interpreter] of this.interpreters) {
      if (!(key in attrs)) continue;
      const contribution = interpreter.toComputedStyle(attrs[key], ctx);
      Object.assign(out, contribution);
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: PASS (10 tests in `attr-registry.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/attr-registry.ts packages/core/src/cascade/attr-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add AttrRegistry.applyAll merging

Walks the registry's interpreters, runs each whose key appears in attrs,
merges contributions into a single Partial<ComputedStyle>. Later
contributions override earlier ones for the same property — matches
registration order via Map iteration semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: attr-registry.ts — default singleton instance

**Files:**
- Modify: `packages/core/src/cascade/attr-registry.ts`
- Modify: `packages/core/src/cascade/attr-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `attr-registry.test.ts`:

```typescript
import { attrRegistry } from "./attr-registry";

describe("default attrRegistry singleton", () => {
  it("exists and is an AttrRegistry instance", () => {
    expect(attrRegistry).toBeInstanceOf(AttrRegistry);
  });

  it("starts empty (built-ins are registered separately)", () => {
    // The singleton is shared across the test suite; in this isolated
    // test we just verify it's a valid empty registry. Built-in
    // registration is tested in builtin-attrs.test.ts.
    expect(typeof attrRegistry.register).toBe("function");
    expect(typeof attrRegistry.applyAll).toBe("function");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: FAIL — `attrRegistry` not exported.

- [ ] **Step 3: Add the singleton**

Append to `attr-registry.ts`:

```typescript
/**
 * Default registry instance. Production code registers built-in
 * interpreters here on import (see `builtin-attrs.ts`); plugins can
 * register additional interpreters at runtime. Tests that need
 * isolation should construct their own `new AttrRegistry()`.
 */
export const attrRegistry = new AttrRegistry();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- attr-registry`
Expected: PASS (12 tests in `attr-registry.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/attr-registry.ts packages/core/src/cascade/attr-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add default attrRegistry singleton

Production code uses this instance; built-in interpreters are
registered against it on import (Task 8). Tests that need isolation
should construct their own new AttrRegistry().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: builtin-attrs.ts — bold, italic, underline interpreters

**Files:**
- Create: `packages/core/src/cascade/builtin-attrs.ts`
- Test: `packages/core/src/cascade/builtin-attrs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/cascade/builtin-attrs.test.ts
import { describe, it, expect } from "vitest";
import { boldInterpreter, italicInterpreter, underlineInterpreter } from "./builtin-attrs";

describe("boldInterpreter", () => {
  it("contributes fontWeight: bold for truthy values", () => {
    expect(boldInterpreter.attrKey).toBe("bold");
    expect(boldInterpreter.toComputedStyle(true)).toEqual({ fontWeight: "bold" });
  });

  it("contributes nothing for falsy values", () => {
    expect(boldInterpreter.toComputedStyle(false)).toEqual({});
    expect(boldInterpreter.toComputedStyle(undefined)).toEqual({});
    expect(boldInterpreter.toComputedStyle(null)).toEqual({});
  });
});

describe("italicInterpreter", () => {
  it("contributes fontStyle: italic for truthy values", () => {
    expect(italicInterpreter.attrKey).toBe("italic");
    expect(italicInterpreter.toComputedStyle(true)).toEqual({ fontStyle: "italic" });
  });

  it("contributes nothing for falsy values", () => {
    expect(italicInterpreter.toComputedStyle(false)).toEqual({});
  });
});

describe("underlineInterpreter", () => {
  it("contributes textDecoration: underline for truthy values", () => {
    expect(underlineInterpreter.attrKey).toBe("underline");
    expect(underlineInterpreter.toComputedStyle(true)).toEqual({ textDecoration: "underline" });
  });

  it("contributes nothing for falsy values", () => {
    expect(underlineInterpreter.toComputedStyle(false)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/cascade/builtin-attrs.ts
import type { AttrInterpreter } from "./attr-registry";

/**
 * Built-in attribute interpreters for the standard text styles.
 *
 * Truthy / falsy convention: each boolean-valued style attribute
 * (bold, italic, underline) contributes the relevant ComputedStyle
 * property when its value is truthy, and contributes nothing when
 * falsy. This lets attrs `{ bold: true }` toggle bold and
 * `{ bold: false }` (or removing the key) un-toggle it.
 */

export const boldInterpreter: AttrInterpreter = {
  attrKey: "bold",
  toComputedStyle: (value) => (value ? { fontWeight: "bold" } : {}),
};

export const italicInterpreter: AttrInterpreter = {
  attrKey: "italic",
  toComputedStyle: (value) => (value ? { fontStyle: "italic" } : {}),
};

export const underlineInterpreter: AttrInterpreter = {
  attrKey: "underline",
  toComputedStyle: (value) => (value ? { textDecoration: "underline" } : {}),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/builtin-attrs.ts packages/core/src/cascade/builtin-attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add bold/italic/underline built-in interpreters

Each contributes the relevant ComputedStyle property when value is
truthy; nothing when falsy. Lets the open-schema attrs bag toggle
these via { bold: true } / { bold: false }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: builtin-attrs.ts — fontFamily and fontSize interpreters

**Files:**
- Modify: `packages/core/src/cascade/builtin-attrs.ts`
- Modify: `packages/core/src/cascade/builtin-attrs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `builtin-attrs.test.ts`:

```typescript
import { fontFamilyInterpreter, fontSizeInterpreter } from "./builtin-attrs";

describe("fontFamilyInterpreter", () => {
  it("contributes fontFamily: <value> when value is a string", () => {
    expect(fontFamilyInterpreter.attrKey).toBe("fontFamily");
    expect(fontFamilyInterpreter.toComputedStyle("Helvetica")).toEqual({ fontFamily: "Helvetica" });
    expect(fontFamilyInterpreter.toComputedStyle("Comic Sans MS")).toEqual({ fontFamily: "Comic Sans MS" });
  });

  it("contributes nothing for non-string values", () => {
    expect(fontFamilyInterpreter.toComputedStyle(42)).toEqual({});
    expect(fontFamilyInterpreter.toComputedStyle(undefined)).toEqual({});
    expect(fontFamilyInterpreter.toComputedStyle(null)).toEqual({});
  });
});

describe("fontSizeInterpreter", () => {
  it("contributes fontSize: <number>pt when value is a number", () => {
    expect(fontSizeInterpreter.attrKey).toBe("fontSize");
    expect(fontSizeInterpreter.toComputedStyle(12)).toEqual({ fontSize: "12pt" });
    expect(fontSizeInterpreter.toComputedStyle(14.5)).toEqual({ fontSize: "14.5pt" });
  });

  it("passes through string values as-is (e.g., for em/percent units)", () => {
    expect(fontSizeInterpreter.toComputedStyle("1.2em")).toEqual({ fontSize: "1.2em" });
    expect(fontSizeInterpreter.toComputedStyle("inherit")).toEqual({ fontSize: "inherit" });
  });

  it("contributes nothing for unsupported value types", () => {
    expect(fontSizeInterpreter.toComputedStyle(undefined)).toEqual({});
    expect(fontSizeInterpreter.toComputedStyle(null)).toEqual({});
    expect(fontSizeInterpreter.toComputedStyle({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: FAIL — `fontFamilyInterpreter` / `fontSizeInterpreter` not exported.

- [ ] **Step 3: Add the interpreters**

Append to `builtin-attrs.ts`:

```typescript
export const fontFamilyInterpreter: AttrInterpreter = {
  attrKey: "fontFamily",
  toComputedStyle: (value) => (typeof value === "string" ? { fontFamily: value } : {}),
};

export const fontSizeInterpreter: AttrInterpreter = {
  attrKey: "fontSize",
  toComputedStyle: (value) => {
    if (typeof value === "number") return { fontSize: `${value}pt` };
    if (typeof value === "string") return { fontSize: value };
    return {};
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: PASS (12 tests in `builtin-attrs.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/builtin-attrs.ts packages/core/src/cascade/builtin-attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add fontFamily and fontSize built-in interpreters

fontFamily: passes through string values; ignores other types.
fontSize: numeric values become Npt; string values pass through
verbatim (allowing em/percent/inherit units).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: builtin-attrs.ts — color and backgroundColor interpreters

**Files:**
- Modify: `packages/core/src/cascade/builtin-attrs.ts`
- Modify: `packages/core/src/cascade/builtin-attrs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `builtin-attrs.test.ts`:

```typescript
import { colorInterpreter, backgroundColorInterpreter } from "./builtin-attrs";

describe("colorInterpreter", () => {
  it("contributes color: <value> when value is a string", () => {
    expect(colorInterpreter.attrKey).toBe("color");
    expect(colorInterpreter.toComputedStyle("red")).toEqual({ color: "red" });
    expect(colorInterpreter.toComputedStyle("#abc")).toEqual({ color: "#abc" });
    expect(colorInterpreter.toComputedStyle("rgb(0, 0, 0)")).toEqual({ color: "rgb(0, 0, 0)" });
  });

  it("contributes nothing for non-string values", () => {
    expect(colorInterpreter.toComputedStyle(42)).toEqual({});
    expect(colorInterpreter.toComputedStyle(undefined)).toEqual({});
  });
});

describe("backgroundColorInterpreter", () => {
  it("contributes backgroundColor: <value> when value is a string", () => {
    expect(backgroundColorInterpreter.attrKey).toBe("backgroundColor");
    expect(backgroundColorInterpreter.toComputedStyle("yellow")).toEqual({ backgroundColor: "yellow" });
  });

  it("contributes nothing for non-string values", () => {
    expect(backgroundColorInterpreter.toComputedStyle(42)).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: FAIL — `colorInterpreter` / `backgroundColorInterpreter` not exported.

- [ ] **Step 3: Add the interpreters**

Append to `builtin-attrs.ts`:

```typescript
export const colorInterpreter: AttrInterpreter = {
  attrKey: "color",
  toComputedStyle: (value) => (typeof value === "string" ? { color: value } : {}),
};

export const backgroundColorInterpreter: AttrInterpreter = {
  attrKey: "backgroundColor",
  toComputedStyle: (value) => (typeof value === "string" ? { backgroundColor: value } : {}),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: PASS (17 tests in `builtin-attrs.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/builtin-attrs.ts packages/core/src/cascade/builtin-attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add color and backgroundColor built-in interpreters

String values pass through as-is (any CSS color syntax accepted by the
downstream cascade is fine: named, hex, rgb(), rgba(), etc.). Non-string
values contribute nothing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: builtin-attrs.ts — registerBuiltinAttrs convenience

**Files:**
- Modify: `packages/core/src/cascade/builtin-attrs.ts`
- Modify: `packages/core/src/cascade/builtin-attrs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `builtin-attrs.test.ts`:

```typescript
import { registerBuiltinAttrs } from "./builtin-attrs";
import { AttrRegistry } from "./attr-registry";

describe("registerBuiltinAttrs", () => {
  it("registers all built-in interpreters into a fresh registry", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);

    expect(r.has("bold")).toBe(true);
    expect(r.has("italic")).toBe(true);
    expect(r.has("underline")).toBe(true);
    expect(r.has("fontFamily")).toBe(true);
    expect(r.has("fontSize")).toBe(true);
    expect(r.has("color")).toBe(true);
    expect(r.has("backgroundColor")).toBe(true);
  });

  it("end-to-end: a typical inline attrs bag produces the expected ComputedStyle contribution", () => {
    const r = new AttrRegistry();
    registerBuiltinAttrs(r);
    const attrs = {
      bold: true,
      italic: true,
      fontFamily: "Helvetica",
      fontSize: 12,
      color: "blue",
    };
    expect(r.applyAll(attrs)).toEqual({
      fontWeight: "bold",
      fontStyle: "italic",
      fontFamily: "Helvetica",
      fontSize: "12pt",
      color: "blue",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: FAIL — `registerBuiltinAttrs` not exported.

- [ ] **Step 3: Add the function**

Append to `builtin-attrs.ts`:

```typescript
import type { AttrRegistry } from "./attr-registry";

/**
 * Register all built-in interpreters into the given registry. Production
 * code calls this with the singleton `attrRegistry` on bootstrap; tests
 * call it with their own AttrRegistry instances for isolation.
 *
 * Idempotent in the sense that re-registering the same key replaces the
 * previous entry — callers can safely call this multiple times.
 */
export function registerBuiltinAttrs(registry: AttrRegistry): void {
  registry.register(boldInterpreter);
  registry.register(italicInterpreter);
  registry.register(underlineInterpreter);
  registry.register(fontFamilyInterpreter);
  registry.register(fontSizeInterpreter);
  registry.register(colorInterpreter);
  registry.register(backgroundColorInterpreter);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/core -- builtin-attrs`
Expected: PASS (19 tests in `builtin-attrs.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cascade/builtin-attrs.ts packages/core/src/cascade/builtin-attrs.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): add registerBuiltinAttrs convenience

Bootstraps a registry with all 7 built-in interpreters. The default
singleton attrRegistry will receive these registrations from the
cascade module's index/init in a later phase (Phase 5+, when the
render-module rewrite wires the registry into the cascade pass).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verification + retrospective

Phase 3 added 2 new files (plus their tests); changed nothing existing. Build and full test suite should remain green.

- [ ] **Step 1: Run the full type checker**

Run: `npm run build --workspace=packages/core`
Expected: PASS (no TypeScript errors).

- [ ] **Step 2: Run the full test suite**

Run: `npm test --workspace=packages/core`
Expected: PASS — all existing tests still green AND all new tests added by this phase pass. Phase 3 adds approximately 31 new tests (12 attr-registry + 19 builtin-attrs). Total should be ~991 tests passing + 4 skipped, up from Phase 2's 960 + 4 skipped.

- [ ] **Step 3: Verify the new exports are not yet wired into the public API**

Run: `grep -E "(attr-registry|builtin-attrs)" packages/core/src/index.ts`
Expected: empty output. New cascade utilities are not exported from the public API yet — that wiring lands in Phase 5+ when the render module rewrite takes the new types end-to-end.

- [ ] **Step 4: Verify the existing cascade files are untouched**

Run: `git log --since="$(git log -1 --format=%cd b27bffa)" -- packages/core/src/cascade/cascade-pass.ts packages/core/src/cascade/compose.ts`
Expected: no commits since Phase 2 hardening (commit `b27bffa` was the last Phase 2-related commit). Phase 3 did not modify the existing cascade pass or composer.

- [ ] **Step 5: Verify the spec's "Definition of done" file inventory is on track**

Open `docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md` and read the "Definition of done > File inventory" section. The Phase 1 + 2 + 3 deliverables are now:
- ✅ Layer 1: persistent-map, block-id, attrs, inline-content, block-position (temp), block, state, new-initial-state (temp)
- ✅ Layer 2: block-traversal, block-compare, span-iteration, new-extract-text (temp)
- ✅ Cascade attribute-interpreter pipeline: attr-registry, builtin-attrs

Phase 4 (next plan, written after this lands) will add: Layer 3 state-mutating operations (insert-text, delete-range, split-block, merge-blocks, apply-attrs). After that we begin breaking-change cutover (delete old state files, migrate consumers).

- [ ] **Step 6: Surface anything Phase 4 should account for**

If anything came up during Phase 3 implementation that should inform Phase 4 design, add notes to the spec or as a Phase 3 retro commit. Examples:
- Did the `Partial<ComputedStyle>` contribution shape work as expected?
- Did any built-in interpreter need an `equals` opt-in?
- Are there missing built-in interpreters that should be added before Phase 4 lands? (Heading-level, line-height, text-align, etc. — these can also wait until needed.)

If yes, edit the spec to capture them; commit the edit:

```bash
git add docs/superpowers/specs/2026-05-02-state-model-block-tree-of-ropes-design.md
git commit -m "$(cat <<'EOF'
docs(spec): notes from Phase 3 implementation for Phase 4+

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no notes, skip the commit. Phase 3 is complete.

---

## Self-review

Quick checklist run after writing this plan:

**Spec coverage** (Phase 3 scope: cascade attribute-interpreter pipeline foundation):
- ✅ `AttrInterpreter` interface with optional `equals` — Task 1
- ✅ `AttrRegistry` class with register/has/get — Task 2
- ✅ `AttrRegistry.applyAll` with merging semantics — Task 3
- ✅ Default `attrRegistry` singleton — Task 4
- ✅ Built-in interpreters: bold/italic/underline — Task 5
- ✅ Built-in interpreters: fontFamily/fontSize — Task 6
- ✅ Built-in interpreters: color/backgroundColor — Task 7
- ✅ `registerBuiltinAttrs` convenience — Task 8
- ✅ Verification + retrospective — Task 9

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" patterns. Each step has actual code or commands.

**Type consistency:** `AttrInterpreter`, `AttrRegistry`, `CascadeContext`, `ReadonlyAttrs`, `ComputedStyle` are referenced consistently across tasks. Function signatures (`register(interpreter)`, `applyAll(attrs, ctx?)`, `registerBuiltinAttrs(registry)`) are stable.

**Out of scope for this plan (deferred):**
- Wiring `attrRegistry` to the existing `cascade/cascade-pass.ts`. → Phase 5+ (render module rewrite, when the render tree carries `attrs` instead of `style`).
- Auto-registration of built-in interpreters at module import time. The plan deliberately leaves the singleton empty so test isolation is easy; production bootstrap (likely a `cascade/init.ts` or similar) lands in Phase 5+ alongside the cascade rewrite.
- Block-level interpreters (e.g., `headingLevel` → fontSize/fontWeight/marginTop). Not in scope yet because the cascade pass for block-level attrs isn't wired. Phase 5+ will determine which block-level interpreters to add as part of the render module rewrite.
- Layer 3 state-mutating operations: `insert-text.ts`, `delete-range.ts`, `split-block.ts`, `merge-blocks.ts`, `apply-attrs.ts`. → Phase 4.

The Phase 3 plan above produces 2 new source files + tests, ~9 commits, and leaves the build green. Estimated execution time: half a day (each interpreter is a one-line function; the registry is straightforward).

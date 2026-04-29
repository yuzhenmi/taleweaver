# Plan 3.A — Follow-ups, Hacks, and Deferred Cleanups

> Living record of every shortcut, stub, plan deviation, and code smell taken
> during Plan 3.A execution. Companion to
> `2026-04-27-plan-1-followups.md`. Each entry has a tracking ID so we can
> pick them off systematically — but **none should block Plan 3.B-J progress**
> unless explicitly flagged as architecturally significant.

**Status as of Plan 3.A completion (2026-04-29):**
- 16 commits on `feature/dom-architecture-redesign`
- All builds clean (core, dom, react, examples/react, examples/dom)
- Test suite green: 573 core / 107 dom / 10 react
- Example app dev server boots and renders documents
- **Plan 3.B's responsibility:** value resolution pipeline
  (`Style → ComputedStyle → UsedStyle`); layout-time `%`/`em` resolution;
  retire F7.6 (em-fallback hack).

---

## Categories

1. [Plan-3.A-doc bugs found during execution](#1-plan-doc-bugs)
2. [Pre-existing issues carried through](#2-pre-existing-issues-carried-through)
3. [Deferred to subsequent Plan 3.x phases](#3-deferred-to-subsequent-plan-3x-phases)
4. [Schema regressions](#4-schema-regressions)
5. [Type-safety / signature footguns](#5-type-safety--signature-footguns)
6. [Code smells](#6-code-smells)

---

## 1. Plan-doc bugs

### F3A.1 — Task 5's factory signature didn't anticipate TS optional/default-param interaction

**Plan:** Task 5 spec'd factory signatures with `metadata?: Readonly<Record<string, unknown>>` followed by `containingInlineSize: number = inlineSize`. Adding both Task 11's `containingInlineSize` (with default) AFTER the optional `metadata?` param confused TypeScript's argument-count inference: `tsc` reported "Expected 9-10 arguments, but got 11" for callers passing all positional args.
**Fix shipped:** Commit `08eadff` switched `containingInlineSize: number = inlineSize` to `containingInlineSize?: number` with `containingInlineSize ?? inlineSize` fallback inside each factory body.
**Lesson:** When mixing `?:` and `= default` in a single signature, TypeScript only counts the optional ones as omitted — default-valued params after `?:` may not be counted as optional in the arity check. Use `?:` uniformly and apply defaults inside the body.

### F3A.2 — Task 6 outer-return factory call originally used `cs.X`, not function params

**Plan said** outer-factory call should use the function's `writingMode, direction` params (the parent's = containing-block's axes). The first Task 6 implementer used `cs.writingMode, cs.direction` (THIS node's). Caught by code review and fixed in commit `90e9f73`. The plan was correct; the implementer misread.
**Lesson:** Spell out which writing-mode/direction value goes where in EVERY factory call site explicitly in future task prompts. Don't rely on "follow the spec" — show concrete code per call.

---

## 2. Pre-existing issues carried through

These predate Plan 3 (Plan 1 followups F7.x and similar). They survived the rename pass without being addressed.

### F3A.3 — `bfc.ts:~221` unreachable code
**File:** `packages/core/src/layout/bfc.ts`
**Note:** The `lengthToPx` helper has an unreachable branch (probably the percent-handling path that returns 0 unconditionally). Diagnostic warning persists. Plan 1 followup F7.x. Will likely be addressed by Plan 3.B (value resolution removes the inline lengthToPx — percentage handling moves to layout-time).

### F3A.4 — `ifc.ts:~327` unused `parentCs` parameter in `buildLineChildrenForAncestorLevel`
**File:** `packages/core/src/layout/ifc.ts`
**Note:** Function parameter declared but not consumed. Pre-Plan-3.A. Either remove or use it (the function may eventually need parentCs for nested-context decisions; keeping for now is fine).

### F3A.5 — `RenderNode` import unused in `bfc.ts` (RESOLVED in Plan 3.A)
**File:** `packages/core/src/layout/bfc.ts`
**Status:** Was Plan 1 followup F7.3. Removed in commit `90e9f73` during Task 6. Marked here for tracking.

---

## 3. Deferred to subsequent Plan 3.x phases

These were intentionally not done in 3.A — the spec scopes them to later phases.

### F3A.6 — Cluster bidi reordering at line-end (Plan 3.C)
RTL paragraphs render with paragraph blocks aligned to the right edge (Plan 3.A
ships this). But cluster-level bidi reordering — taking a logical-order line
of clusters and rearranging visually for mixed-direction text — is **not**
implemented. Hebrew/Arabic text in an RTL paragraph still renders left-to-right
within a line. Plan 3.C (TextShaper expansion) ships full bidi.

### F3A.7 — Vertical writing modes (Plan 4 or later)
The `WritingMode` type includes `"vertical-rl"` and `"vertical-lr"`, but
`logicalToPhysical` throws for them. The Style schema doesn't yet expose
those values. Activates in a later plan with the painter rotation work.

### F3A.8 — `text-align`, `hyphens`, `text-wrap` schema reservations
Schema reservations are flagged in spec §10 but **not yet added** to `Style`.
Plan 3.G (line-stable IFC) and Plan 4 (text & typography) will add the values.
Note for the implementer: the new properties should land at the same time as
their consumer code, not as bare declarations, to avoid stale type values.

### F3A.9 — `containingInlineSize` is required for correct RTL but its default hides errors

The factory signatures use `containingInlineSize?: number` with
`?? inlineSize` fallback (commit `08eadff`). This default is correct for
LTR (where `logicalToPhysical` ignores `containingInlineSize`) but **WRONG
for RTL** — the default would compute `x = inlineSize - inlineOffset - inlineSize = -inlineOffset`,
which is meaningless. All current call sites in BFC/IFC/Table FC pass the
explicit value, but the type system doesn't enforce it.

**Suggestion for Plan 3.B or later:** drop the default and make
`containingInlineSize` required. The compiler will then surface any future
call site that forgets it.

---

## 4. Schema regressions

### F3A.10 — `widows` and `orphans` dropped from Style schema
**File:** `packages/core/src/styles/style.ts`
**What:** Plan 1 had `widows`/`orphans` in the fragmentation section. Task 2's
new Style interface doesn't list them. They were silently dropped because the
plan body didn't include them.
**Why ok temporarily:** Plan 3.A doesn't fragment; nothing reads these.
**Plan 5 (pagination) MUST restore them**, possibly with a different shape.

### F3A.11 — `PAGE_MARGINS` removed from `examples/dom/src/main.ts`
**File:** `examples/dom/src/main.ts`
**What:** Task 12 removed an unused `PAGE_MARGINS` constant in commit `0cbe565`. The example app doesn't currently set page margins; restore in Plan 5 along with the EditorConfig pagination work.

### F3A.12 — `pageHeight` / `pageGap` still on the example app's controller config

**Where:** `examples/dom/src/main.ts:50-51` passes `pageHeight: PAGE_HEIGHT, pageGap: PAGE_GAP` to `createEditorController`. The DOM controller likely accepts these without using them (or with partial use). Plan 5 unifies pagination and either makes these load-bearing or drops them.

---

## 5. Type-safety / signature footguns

### F3A.13 — `lengthToPx` helper still uses `as { value: number }` cast
**Files:** `packages/core/src/layout/bfc.ts`, `ifc.ts`, `table-fc.ts`
**What:** Each FC has (or had) its own copy of:
```ts
function lengthToPx(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return 0;
  if (v && typeof v === "object" && "unit" in v && v.unit === "px") {
    return (v as { value: number }).value;
  }
  return 0;
}
```
**Plan 1 followup F5.1.** Carried through Plan 3.A. Plan 3.B (value resolution) should resolve this — once `ComputedStyle` carries lengths in canonical px form (em/rem already resolved by cascade), the layout-time `lengthToPx` helper either becomes a typed `Length → number` mapping or disappears entirely.

### F3A.14 — `cs.flooat`, `cs.clear` still typed as logical strings, but no compiler check at call sites that physical-string literals can't sneak in

For example, `cs.float === "inline-start"` is correct, but a typo like
`cs.float === "left"` would compile (since `cs.float`'s type is the union
including `"none"` etc., and a comparison to a non-union string is just
always-false but doesn't throw).
**Suggestion:** add an exhaustive switch or a typed equality helper if this
becomes a recurring footgun. Low priority.

### F3A.15 — `containingInlineSize` default is silently wrong for RTL — see F3A.9

---

## 6. Code smells

### F3A.16 — Each factory body in `layout-box-v2.ts` is ~10 lines of near-identical boilerplate

After Tasks 5 and 11, each of the 9 `createXxxBox` factory functions has the same shape: receive logical args + writingMode/direction + containingInlineSize, call `logicalToPhysical`, then `Object.freeze({ ... })` with type-specific fields.

**Could a helper reduce duplication?** Maybe — e.g., a generic `createBoxBase(...)` that returns the common fields, with each factory spreading and adding type-specific fields. But the discriminated-union pattern with `type: "block" as const` literals makes this awkward.

**Decision:** leave as-is. Plan 1's choice for the explicit, repetitive pattern was deliberate (each factory is independently readable and TS-friendly). Plan 3.A inherits this. Don't refactor unless a concrete benefit emerges (e.g., adding a 10th LayoutBox type makes the duplication painful).

### F3A.17 — Marker box positioning uses `cs.writingMode/direction` (THIS BFC's), not function params

**File:** `packages/core/src/layout/bfc.ts:141-142`

The marker is positioned in the BFC's content area, so its containing block IS THIS node. Using `cs.writingMode/cs.direction` is semantically correct. But the choice creates an asymmetry with the OUTER factory call (which uses function params for the same conceptual reason: that box's containing block is the parent). The asymmetry is harder to follow than it looks; a reader has to understand which "containing block" applies at which call site.

**Mitigation:** the plan doc spells this out (§ 10.A bullets in the spec), and the comments in the code could be clearer. Consider adding a one-line comment at each factory call site explaining which value to pass.

### F3A.18 — `physicalBorderSides` helper in `canvas-renderer.ts` is partially documented; CJK vertical-rl will need similar mapping

**File:** `packages/dom/src/canvas-renderer.ts`

The helper currently handles only `horizontal-tb` (LTR + RTL). When vertical writing modes activate (Plan 4 or later), this helper needs `vertical-rl` and `vertical-lr` cases. Easy to add but worth flagging — the helper is the single chokepoint where logical → physical for borders/padding lives.

---

## How to use this document

When starting Plan 3.B (or any later cleanup pass), pick up F3A-numbered items as small followup tasks. Most are pure-refactor, type-tightening, or schema-restoration work. Items most likely to surface as bugs in user-facing flows:

- **F3A.6** — RTL Hebrew/Arabic text renders in logical (not visual) order until Plan 3.C ships bidi.
- **F3A.10** — `widows`/`orphans` will need re-introduction with Plan 5.
- **F3A.13** — `lengthToPx` casts won't survive Plan 3.B's value-resolution pipeline; Plan 3.B should retire them entirely.

Items most likely to be raised in code review:

- **F3A.9 / F3A.15** — `containingInlineSize` default hides RTL bugs; tighten when stable.
- **F3A.16** — factory duplication in `layout-box-v2.ts` (low-priority).
- **F3A.17** — marker-box writing-mode asymmetry comments could be clearer.

When fixing these, prefer to add a one-line note linking the fix commit, so we can mark items as resolved.

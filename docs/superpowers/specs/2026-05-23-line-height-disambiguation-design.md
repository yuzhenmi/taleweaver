# Line-Height Disambiguation — Design Spec

> Spec for C-B of the cascade-module cleanup plan
> (`docs/superpowers/plans/2026-05-22-cascade-module-cleanup-plan.md`).
> Status: design needed. The original C-B task was "resolve unitless
> line-height to pixels in UsedStyle." Investigation revealed the
> deeper issue: cascade's current flatten convention makes unitless
> ratios indistinguishable from resolved px at the type level. The
> fix has design implications beyond a one-liner.

## The bug as flagged

`flattenLineHeight` in `cascade/flatten-lengths.ts` returns `number |
ComputedLength`. A unitless `lineHeight: 1.5` (meaning 1.5 × own
fontSize per CSS spec) returns the bare number `1.5`. Layout's
`used-style.ts` passes it directly to `UsedStyle.lineHeight: number`,
which the IFC then uses as a pixel height. Result: a unitless 1.5
becomes a 1.5px line, not `1.5 × fontSize` px.

This is observably wrong: a `paragraph { fontSize: 16, lineHeight: 1.5 }`
should produce 24px lines, but currently produces 1.5px lines (which
visually collapse to ~the font's intrinsic line metrics — masking the
bug in casual testing but creating layout misalignments under any
non-default line-height).

## The deeper issue

`flattenLength` (the helper `flattenLineHeight` delegates to for non-
number inputs) collapses both em and px Length objects into plain
JavaScript `number` representing px:

```ts
function flattenLength(v, fontSize) {
  if (typeof v === "number") return v;             // already-resolved px
  if (v.unit === "percent") return v;              // preserved as object
  if (v.unit === "px") return v.value;             // px → number
  return resolveLength(v as Length, fontSize);     // em → number (resolved px)
}
```

So `flattenLength({unit:"px", value:24}, 16)` returns `24`.
And `flattenLength({unit:"em", value:1.5}, 16)` also returns `24`.
And specified unitless `lineHeight: 1.5` *also* arrives as a plain
number — but it means "1.5 × fontSize", not "1.5px".

After cascade, `cs.lineHeight === 24` could mean:
- 24 px (specified as `24` or `{unit:"px",value:24}` or `{unit:"em",
  value:1.5}` at fontSize 16).
- 24 × own-fontSize (specified as the unitless number 24).

These are the same TypeScript type but semantically different. The
naive fix to layout — "multiply any number by fontSize" — collapses
into the wrong direction for px/em inputs.

## CSS spec reference

Per CSS Inline Layout (and the older CSS 2.1):

- **`<number>` value:** "The used value is this unitless `<number>`
  multiplied by the element's own computed font-size. **Negative
  numbers are illegal. The computed value is the same as the specified
  value.**"
- **`<length>` value:** "The specified length is used in the
  calculation of the line box height. As with the property
  font-size, **em values are computed relative to the font-size of
  the element itself**."
- **`<percentage>` value:** "Relative to the font size of the element
  itself. The computed value of the property is this percentage
  multiplied by the element's computed font-size."

Two distinct semantic categories at the computed-value level:
1. **Unitless ratio** — inherits as a ratio; used-value is `ratio ×
   own-fontSize` (resolved per descendant, not at the inheriting
   ancestor).
2. **Resolved length** — inherits as a resolved px length; used-value
   is the px length directly. Includes both px-specified and
   em-specified (em is resolved at cascade time against own-fontSize
   per spec).

Inheritance behaves differently for the two:
- A parent with unitless `lineHeight: 1.5` lets each descendant
  compute its own px line based on its own fontSize.
- A parent with `lineHeight: 18px` forces every descendant to use 18px
  lines regardless of their fontSize.

Document authors overwhelmingly use unitless (it's the recommended
form). Most rich-text editors don't surface a px line-height control
at all.

## Options

### Option A — Preserve px Length objects through cascade

`flattenLength` resolves em to px BUT returns a `ComputedLength` object
(`{unit:"px", value:N}`), not a bare number. `ComputedStyle`'s length-
typed fields then carry `{unit:"px"|"percent", value:N}` objects
uniformly. Unitless `lineHeight` stays as bare `number`. Layout's
used-style sees:

- `typeof cs.lineHeight === "number"` → unitless → multiply by
  own-fontSize.
- `typeof cs.lineHeight === "object"` → ComputedLength → resolve
  (px directly; percent against own-fontSize).

Cost:
- Touches `ComputedLength` type and every consumer that reads a
  length-typed field expecting a `number`. Likely a lot of layout
  code.
- The codebase's existing convention "ComputedLength after flatten is
  number-for-px" is broken for ALL length fields, not just
  lineHeight.
- Higher blast radius, but cleanest CSS-spec faithfulness.

### Option B — Tagged union for lineHeight only

Add a new type:

```ts
type ComputedLineHeight =
  | { kind: "ratio"; value: number }
  | { kind: "length"; value: number };       // px, after em resolution
```

Cascade's `flattenLineHeight` returns this tagged type. Layout's
used-style branches on `.kind`.

Cost:
- Surgical (one field only).
- Adds a new computed-style shape that doesn't follow the rest of
  the convention.
- Interpreters that produce `lineHeight` must emit the tagged shape
  (one-time change).
- Architectural inconsistency: every other length-typed field uses
  `ComputedLength`; lineHeight uses something else.

### Option C — Restrict the input vocabulary

Forbid px-specified line-height. Cascade only accepts unitless
`number` or em Length. Any em Length resolves to "still unitless
ratio" (e.g., `2em` at fontSize 16 → unitless ratio 2.0 — same as
`2`). Then `ComputedStyle.lineHeight` is always a unitless `number`
(or `ComputedLength` percent, which CSS spec also wants resolved
against own-fontSize).

Layout's used-style:
- `typeof cs.lineHeight === "number"` → multiply by own-fontSize.
- `typeof cs.lineHeight === "object"` AND `.unit === "percent"` →
  resolve percent against own-fontSize, NOT containing-block.

Cost:
- Smallest blast radius — only cascade and used-style change.
- Loses px-specified line-height as a feature (no document author
  expects this; it's a CSS form rarely used outside very rigid
  layouts).
- The "lose px line-height" trade-off may be acceptable for a word-
  processor engine — typesetters operate in pt/em/ratios, not px.
  But it's a feature restriction that should be explicit.

### Option D — Layout-side disambiguation via a per-field heuristic

Layout's used-style treats `lineHeight === N` as a unitless ratio
IFF the value satisfies some heuristic (e.g., `N < some-threshold`).
This is brittle and unprincipled — included for completeness only.
**Reject.**

## Recommendation

**Option C** for the cascade cleanup pass. Rationale:

1. **CSS-spec faithfulness on the cases that matter.** Unitless ratio
   and percent (the two forms document authors actually use) work
   correctly. The CSS-spec divergence is on px line-height —
   acceptable.
2. **Smallest blast radius.** Cascade's `flattenLineHeight` and
   layout's used-style line-height — two functions, both already
   getting touched in this plan.
3. **Forward-compatible.** If we later want px line-height support
   (Option B's tagged union), we can add it then. We're not painting
   ourselves into a corner.
4. **Matches the user's CLAUDE.md vision.** "Match Google Docs in
   feature behavior" — Google Docs doesn't expose px line-height.
   This is "what does the browser do" tempered by "what does the
   word-processor user need."

Option A (preserve ComputedLength objects across the board) is the
more principled fix but is a major refactor that should be its own
plan. C-B is sized as "small/bundled" in the cascade cleanup plan;
Option C fits that sizing.

## Decision: deferred to user

Three open questions:

### Q1 — Which option (A / B / C)?

Recommend C (rationale above).

### Q2 — If C, what happens to em line-height?

CSS spec says em line-height is a length (resolves to px against own
fontSize). Under Option C, em line-height would be silently treated
as unitless ratio (since both cascade and layout collapse it to a
number). That's a minor spec divergence on top of the C-option's px
divergence.

Sub-options:
- **C.1:** Treat em line-height as unitless ratio. `lineHeight: 1.5em`
  at fontSize 16 becomes used-value `1.5 × 16 = 24px` — accidentally
  the right answer for this case! Because `1.5em` resolves to `24px`
  under length resolution; if we re-multiply by 16, we'd get 384.
  But if we treat the post-flatten 24 as "unitless ratio 24",
  multiplying by 16 gives 384. So C.1 is wrong.
- **C.2:** Reject em line-height as unsupported input. Cascade
  interpreters refuse `lineHeight: {unit:"em",...}`. Author input is
  validated; em → throw or log warning.
- **C.3:** Special-case em line-height in cascade: convert
  `{unit:"em", value:V}` to unitless ratio `V` (matching CSS
  semantics — `1.5em` at any fontSize gives `1.5 × fontSize` px line).

Recommend C.3 — silent correct semantics; aligns with how em
specifies "multiply by own fontSize".

### Q3 — Percent line-height resolution: against containing-block (current
buggy behavior) or against own fontSize (CSS spec)?

Recommend: fix to own fontSize. Aligns with spec; the current bug is
that `resolveUsedLength` is called with `containingInlineSize` — wrong
for line-height percent.

This is a small additional fix in the same place as the unitless
fix. Bundled.

## Implementation sketch (under recommendation: C + C.3 + Q3-fix)

### Cascade: `flattenLineHeight`

```ts
function flattenLineHeight(
  v: number | ComputedLength | Length,
  fontSize: number,
): number | ComputedLength {
  // Unitless ratio: pass through.
  if (typeof v === "number") return v;
  // em: convert to unitless ratio (CSS: em line-height multiplies
  // own fontSize, equivalent to unitless ratio of the same value).
  if (v.unit === "em") return v.value;
  // px: literal pixel line-height (rare; preserve as percent-style
  // ComputedLength).
  if (v.unit === "px") {
    // Future: support px line-height. For now, treat as unsupported
    // — error in dev mode; in production, fall back to initial.
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      console.warn("px-specified lineHeight not supported; using initial ratio 1.2");
    }
    return INITIAL_COMPUTED_STYLE.lineHeight;
  }
  // percent: keep as object; used-style resolves against own fontSize.
  if (v.unit === "percent") return v;
  return INITIAL_COMPUTED_STYLE.lineHeight;
}
```

### Layout: used-style.ts

```ts
lineHeight:
  typeof cs.lineHeight === "number"
    ? cs.lineHeight * cs.fontSize                 // unitless ratio
    : cs.lineHeight.unit === "percent"
      ? (cs.lineHeight.value / 100) * cs.fontSize  // percent of own fontSize (NOT containing-block)
      : cs.lineHeight.value,                       // fallback (won't hit under C)
```

### Tests

- Unitless: `lineHeight: 1.5`, `fontSize: 16` → used 24.
- Em (treated as ratio per C.3): `lineHeight: 1.5em`, `fontSize: 16`
  → used 24.
- Percent: `lineHeight: 150%`, `fontSize: 16` → used 24.
- Inheritance: parent `lineHeight: 1.5`, child has `fontSize: 32`,
  inherits → child used 48.
- Initial: `lineHeight: ?` (initial 1.2), `fontSize: 16` → used 19.2.

## Decisions

Per user input only.

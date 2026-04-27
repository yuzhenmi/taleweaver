# Issue 03 — Inline content re-wraps the whole block on every edit (Major)

## Summary

`layoutTreeIncremental` opts out of incremental work whenever the changed
block contains inline content. Typing one character into a paragraph
re-wraps the entire paragraph from scratch. Fine for a one-line
paragraph, expensive for a 5,000-word paragraph or a long table cell.

## Where it manifests

`packages/core/src/layout/layout-engine.ts:475–482`:

```ts
const hasInlineContent = newRenderNode.children.some(
  (c) => c.type === "text" || c.type === "inline",
);

// Inline formatting contexts need full re-layout (line wrapping depends on all content)
if (hasInlineContent) {
  return layoutTree(newRenderNode, containerWidth, measurer);
}
```

The comment is honest about why: the greedy line-wrap algorithm in
`layoutInlineContent` (lines 322–404) walks all word boxes for the
block from start to end. Without further structure, it's not safe to
"start wrapping from the edited position" — the cumulative `lineY` and
line breaks depend on everything that came before.

## Why it's a problem

1. **Per-keystroke cost is O(words in block).** A paragraph with 1,000
   words allocates 1,000 word boxes and produces ~30 line boxes for every
   single character typed.
2. **Garbage and GC pressure.** Allocations for the entire block's
   layout tree are thrown away every keystroke.
3. **It's exactly the case the project markets itself on.** The README
   pitch is *"word-processor-style pagination."* Word and Google Docs do
   line-stable wrapping precisely because long-doc editing is the use
   case. Without it, Taleweaver's perf advantage over contentEditable
   editors is gone or inverted.

## Why the simple fix doesn't work

It is *almost* enough to start re-wrapping from the line containing the
edit. The problem is that line wrapping can cascade: deleting a word
might pull words backward, joining two lines and shifting subsequent
ones too. So a complete fix needs to detect when the wrap result has
"healed" — i.e. when the position of the next un-edited word matches
its old position.

## Fix options

### Option A — line-stable incremental wrap

The standard text-layout algorithm:

1. Find the line containing the edit (`editedLineIndex`).
2. Build the word-box stream from `editedLineIndex` onward.
3. Re-wrap forward, comparing each new line's first word against the
   old line's first word.
4. Stop when alignment matches (same first word, same x position) — all
   subsequent lines are unchanged and reusable, just possibly shifted in y.
5. Reposition the tail (`repositionBox`-style) without re-wrapping it.

Pros: matches Word / Chrome behaviour; large blocks stay snappy.
Cons: requires a stable identity for "where in the word stream is this
word" — the word boxes need an identity across edits (a per-word key
derived from the source text node id + intra-node offset).

### Option B — split paragraphs into "flows" of bounded size

Internally, treat a long paragraph as a list of inline-flow segments,
each capped at e.g. 5,000 chars. Re-wrap only the affected segment plus
the next until alignment is restored.

Pros: simpler than full alignment-detection; bounds worst-case work.
Cons: introduces a new concept that doesn't map to a state-tree entity;
risk of segment boundaries causing wrap artifacts.

### Option C — schedule layout work off the critical path

Run incremental layout in a microtask or `requestIdleCallback`; paint
with a stale layout tree if necessary, fixing the cursor position from
state. Keep the synchronous paint cheap.

Pros: hides latency rather than fixing it; orthogonal to A or B.
Cons: cursor jitter risk; complicates the data flow.

**Recommendation:** Option A — the rest of the code is already shaped
for it (incremental render is similarly content-keyed). The work is in
the line-wrapping algorithm itself.

## Concrete plan for Option A

1. Stabilize word identity: change `collectWordBoxes` (lines 407–432) to
   emit `{ word, key, styles, sourceTextId, sourceOffset }`. The
   `(sourceTextId, sourceOffset)` pair survives most edits.
2. Add a `wrapFromIndex(words, fromIndex, oldLines)` function that:
   - resumes wrapping at `words[fromIndex]`,
   - emits new lines,
   - on each line emission, compares its first word's identity with the
     old line that started at the same index;
   - when an emitted line matches an old line in identity *and* x of the
     first word, halts and reuses the tail.
3. In `layoutTreeIncremental`, when a block has inline content:
   - compare new and old word streams from the front, find the divergence
     point (first index where word identity differs) — call it `fromIndex`;
   - find the line containing `fromIndex`;
   - call `wrapFromIndex` with the old layout's line list.
4. If the divergence detector says "everything diverges" (e.g. style
   changed everywhere), fall back to full layout.

## Test impact

- New benchmark suite: typing into a 10k-word paragraph should be O(1)
  amortized.
- Existing tests should pass unchanged — line wrapping output is identical.
- New unit tests for the alignment detector across: insert mid-line,
  delete word, replace single character, paste paragraph break, change
  font in mid-paragraph, narrow container.

## See also

- [issue 04](04-pagination-whole-block-only.md) — pagination has a
  similar "re-do everything" pattern at the document level.
- [issue 13](13-long-document-virtualization.md) — windowed layout
  could mitigate this for offscreen blocks even before line-stable
  wrapping lands.
- [architecture/04 layout layer](../architecture/04-layout-layer.md)

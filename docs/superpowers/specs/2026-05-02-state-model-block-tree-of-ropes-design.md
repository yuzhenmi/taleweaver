# State model redesign — block tree of styled-run sequences

**Status:** design complete (2026-05-02). All ten brainstorm-stage open questions are resolved (see Decisions log). Ready for implementation planning. Note: filename `…ropes-design.md` is historical — the design does *not* use a rope; per-block inline content is a flat array of styled items.

## Why

The current state module is an immutable tree of `StateNode`s where each node holds a flat `readonly StateNode[]` of children. Edits use structural sharing: `updateAtPath` rebuilds the spine from root to the changed node by copying sibling-reference arrays at each level.

This makes per-edit cost **O(fanout-from-root)** in the worst case. For a 1000-paragraph document, every keystroke must copy ~1000 child references at the document root to produce the new immutable tree. At 10,000 paragraphs (a long Notion page or maxed-out Google Doc), the per-keystroke cost approaches the frame budget; beyond that, editing becomes visibly laggy.

The performance target is **smooth editing at Google-Docs / Notion scale**:
- **Smooth target: ≤ 10,000 blocks per document.** Per-keystroke cost should be unnoticeable (< 1 ms) at this scale.
- **Graceful degradation: ≤ 100,000 blocks per document.** Per-keystroke cost should remain sub-frame (< 16 ms).
- **Not a target: ≥ 1M blocks per document.** Neither Google Docs nor Notion supports this in a single editable surface, and designing for it would force complexity (e.g., order-maintenance tags) we don't need to pay.

The current shape cannot deliver smooth editing even at the 10k-block target. The document-root rebuild is intrinsic to "flat array of children with structural sharing." No amount of dirty tracking fixes it; the cost is paid at state-construction time, before any pipeline stage runs.

CLAUDE.md's existing line *"O(1) per keystroke and per cursor-move regardless of document size"* should be revised to reflect the recalibrated scale target. Suggested replacement: *"Smooth editing (sub-millisecond per keystroke, sub-frame per cursor-move) at Google-Docs / Notion scale (≤ 10,000 blocks per document, graceful degradation to ≤ 100,000)."*

## Decision

Redesign the state module to a **block tree of styled-run sequences** model:

- State is a `PersistentMap<BlockId, Block>` keyed by `BlockId`, plus a `rootId` pointer. At the target scale (≤ 10k blocks), the persistent-map abstraction is chosen primarily for cheap structural sharing across versions (undo/redo state snapshots hold by reference) rather than for the asymptotic update guarantee. **Implementation: plain `Map<BlockId, Block>` cloned per edit, in a `state/persistent-map.ts` wrapper that hides the implementation.** Per-edit clone at 10k entries is ~100 µs; per-snapshot memory is ~500 KB × 100 undo entries = ~50 MB, acceptable on commodity hardware. The wrapper API is identical to what a HAMT would expose, so swapping to a HAMT (or `immutable-js`) later is local — no consumer changes required.
- Each `Block` is a flat record with `parentId`, `prevSiblingId`, `nextSiblingId`, `firstChildId`, `lastChildId` — children are stored as a doubly-linked list, not an array. All neighborhood walks are O(1).
- Leaf blocks (`paragraph`, `list-item`, `heading`, `table-cell`, etc.) carry `inlineContent: InlineContent` storing the block's rich text as an array of styled inline items (text runs and embed items).
- Container blocks (`section`, `list`, `table`, `table-row`, etc.) hold child blocks via the linked-list pointers and have no `inlineContent` of their own.
- Inline styles are **attributes on text runs**, not wrapper nodes in the state. This corrects the divergence noted in the existing state-module review (`formatting.ts` currently uses `span` wrapper nodes contradicting the architecture doc's "styles attach to text" decision).
- `Position = { blockId, offset }` — stable across edits to other parts of the document.
- The `span` wrapper that appears in the rendered tree is reconstructed by the **render module** at parse time from same-attribute text runs. State stores styled runs; render produces the wrapping spans.
- **Inline content storage is a flat array of styled items (text runs + embed items), not a rope.** At the target scale (≤ 10k blocks, typical block ≤ a few hundred chars), per-block edits are O(N_block) but with tiny constants — sub-millisecond even for extreme blocks. Matches Notion's "rich text array" and Google Docs' `ParagraphElement` array shape.
- **Inline embeds (images, equations, mentions, footnote anchors, hard breaks, etc.) are first-class items in the inline sequence**, occupying one cursor position each. Primitive embeds (image, mention, equation, date, page-break) carry their data in `properties`; substantial-content embeds (footnote anchors) carry an ID in `properties` referencing a separate block in `state.blocks` whose subtree holds the body.
- **State attributes are open-schema** (any key, any value); **`ComputedStyle` (post-cascade) is closed-schema**. The cascade pass translates state attributes to `ComputedStyle` contributions via **registered attribute interpreters** (one per attribute key). Built-in interpreters cover the standard text styles; plugins register interpreters for new attributes (comments, change-tracking marks, custom annotations) without touching core types.

## Why option 4 over option 3 (flat-sequence with attributes / Google Docs model)

Option 3 (single document-wide flat character sequence, paragraph boundaries as `\n` chars with paragraph attrs, lists/sections via attribute encoding, tables as embeds) was considered and rejected. Reasoning:

- Taleweaver targets a **Notion-style block model** with rich nested structure (sections containing columns containing lists containing items containing paragraphs containing inline content with embedded tables containing more paragraphs) as a first-class concern. Option 3 expresses all of this through attribute conventions on a flat sequence; option 4 expresses it directly via the block tree.
- Modern rich-text editors that support nested structure (ProseMirror, Slate, Lexical, TipTap, BlockNote) all use the option-4 shape. Option 3 is the model used by Google Docs and Quill, which support flatter document structure.
- The component model (per-type render functions registered with the components module) maps naturally onto the block tree. With option 3, container components receive synthetic input that the render module reconstructs from sequence patterns — works, but more layers between component author and what's actually stored.
- Per-block inline storage is smaller and more ergonomic than one global sequence. Most blocks have <1000 characters; a flat array of styled items per block gives good performance without the cognitive load of "everything is positions in one giant sequence."

Option 3's advantages (single integer positions, symmetric cut/paste of arbitrary ranges, OT-friendly for collab) are real but lose to the structural-richness argument given Taleweaver's Notion-style block ambition.

## Pipeline impact

The full pipeline shape is unchanged:

```
state → render → cascade → layout → paginate
```

- **State** is the new block tree of styled-run sequences.
- **Render module** gains a parse pass: walk the block tree; for each leaf block, walk its `inlineContent.items`; emit each text item's runs as `TextBox`es and group adjacent same-attr runs into synthetic `span` `ElementBox`es; emit each embed item by dispatching its `embedType` through the components registry; produce a `RenderNode` tree of the same shape today's render module produces.
- **Components module** is structurally unchanged. Component definitions still register render functions per type. The interface adapts from `(StateNode, children) => RenderBox` to `(BlockView, children) => RenderBox` where `BlockView` exposes the block's type, attrs, parent-id, and (for leaf blocks) the parsed inline content. Synthetic grouping types like `list` (built by render from consecutive same-listId items) are dispatched through the registry just like any other type. The `text` and `span` *state-node* types are removed entirely — text becomes items inside `inlineContent`, and spans are reconstructed by render from same-attribute text-item groupings rather than existing as state nodes. (See "`BlockView` interface for components" section for the full type.)
- **Cascade, layout, paginate** are unaffected — they consume the same `RenderNode` tree as today.

The change is fully isolated to the **state module** and the **render module's parse logic**.

## Data structures

```typescript
// The state container.
interface State {
  rootId: BlockId;
  blocks: PersistentMap<BlockId, Block>;        // structural sharing across versions for cheap snapshots
}

// A single block in the tree.
interface Block {
  id: BlockId;
  type: string;                                 // "paragraph", "list-item", "section", "table", etc.
  attrs: ReadonlyAttrs;                         // open-schema attribute bag (block-level)
  parentId: BlockId | null;                     // null only on the root
  prevSiblingId: BlockId | null;
  nextSiblingId: BlockId | null;
  firstChildId: BlockId | null;                 // null for leaf blocks
  lastChildId: BlockId | null;
  inlineContent: InlineContent | null;          // non-null for leaf blocks only
}

// Inline content = sequence of styled items.
interface InlineContent {
  items: ReadonlyArray<InlineItem>;             // sorted in document order; merge adjacent text items with equal attrs
}

type InlineItem =
  | TextItem
  | EmbedItem;

interface TextItem {
  kind: "text";
  text: string;                                 // UTF-16 code units
  attrs: ReadonlyAttrs;                         // open-schema (bold, italic, link, comment-range, etc.)
}

interface EmbedItem {
  kind: "embed";
  embedType: string;                            // "image", "mention", "equation", "footnote-anchor", "hard-break", etc.
  attrs: ReadonlyAttrs;                         // attributes that wrap the embed (link, comment-range, etc.)
  properties: Readonly<Record<string, unknown>>;  // primitive embed data, OR a block-id reference for substantial content
}

// Open-schema attributes. Plugins register interpreters per key.
type ReadonlyAttrs = Readonly<Record<string, unknown>>;

// A position in the document.
interface Position {
  blockId: BlockId;
  offset: number;                               // UTF-16 code-unit offset across the block's inline items
                                                 // (text-item chars count as their length; embed-item counts as 1)
}

// A span (selection range).
interface Span {
  anchor: Position;
  focus: Position;
}
```

### Inline content offset semantics

`Position.offset` is a UTF-16 code-unit offset *across all items in the block's `inlineContent.items`*. Each text item contributes `text.length` to the offset count. Each embed item contributes exactly **1** (an embed is a single cursor position, like one character). To convert a `Position.offset` to "which item, and where within it":

```
let cursor = 0;
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const itemLen = item.kind === "text" ? item.text.length : 1;
  if (offset < cursor + itemLen) {
    return { itemIndex: i, withinItem: offset - cursor };
  }
  cursor += itemLen;
}
return { itemIndex: items.length, withinItem: 0 };  // end-of-block
```

This walk is O(N_items_in_block), trivially fast. The cursor module enforces grapheme-cluster boundaries when navigating across text-item content via `Intl.Segmenter`.

### Embed lifecycle

For embeds carrying primitive properties (image src, mention userId, equation LaTeX), nothing special — `properties` carries the data inline.

For embeds with substantial content (footnote anchors, sidenotes), `properties` carries a `contentBlockId: BlockId` referencing a separate block in `state.blocks`. The referenced block's subtree holds the body (full block-tree power: paragraphs, lists, images, even nested footnotes). **Lifecycle is managed by the action handlers**, not the data model:

- Creating a footnote anchor also creates the body block(s) and adds them to `state.blocks`.
- Deleting a footnote anchor also deletes its body block subtree.
- Copy-pasting a range that includes a footnote anchor also clones the body subtree with re-keyed IDs.
- Cross-document paste re-keys body IDs into the destination's namespace.

This matches Google Docs' `document.footnotes` referenced from inline `FootnoteReference` particles.

### Attribute schema and interpretation

State attributes are open-ended `Record<string, unknown>` at every level (block-level `Block.attrs`, inline-level `TextItem.attrs` / `EmbedItem.attrs`). Any key, any value. Plugins can introduce new attribute types without changing core types.

The cascade pass translates state attributes into `ComputedStyle` (closed schema) via **registered interpreters**, one per attribute key:

```typescript
interface AttrInterpreter {
  attrKey: string;
  toComputedStyle: (value: unknown, ctx: CascadeContext) => Partial<ComputedStyle>;
  equals?: (a: unknown, b: unknown) => boolean;   // optional; default: deep value equality
}

// Built-in interpreters registered by the standard text-style plugin:
registerAttr({
  attrKey: "bold",
  toComputedStyle: (value) => value ? { fontWeight: "bold" } : {},
});
registerAttr({
  attrKey: "fontSize",
  toComputedStyle: (value) => ({ fontSize: typeof value === "number" ? `${value}pt` : "inherit" }),
});

// A "highlight" plugin can register its own:
registerAttr({
  attrKey: "highlight",
  toComputedStyle: (value) => ({ backgroundColor: value as string }),
});
```

The cascade walks each item's `attrs`, looks up the interpreter for each key, calls it, and merges all contributions into the item's `ComputedStyle`. Multiple plugins can independently contribute to the same `ComputedStyle` property; contributions merge in registration order.

This model unifies block-level and inline-level attribute handling — same registry, same interpretation pass, just applied at different levels of the tree.

### Run merging and equality

After every edit, the inline-content normalizer walks `items[]` and merges adjacent text items with equal `attrs`. Equality defaults to **deep value equality**: two attribute objects are equal iff they have the same keys with equal values (recursively for objects/arrays). Interpreters can opt into custom equality by providing an `equals` function (rare; for cases like a `comment` attribute whose `timestamp` field shouldn't affect compare semantics).

Equality function:

```typescript
function attrsEqual(a: ReadonlyAttrs, b: ReadonlyAttrs): boolean {
  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!(k in b)) return false;
    const interpreter = registry.get(k);
    const eq = interpreter?.equals ?? deepValueEqual;
    if (!eq(a[k], b[k])) return false;
  }
  return true;
}
```

No interning of attribute objects — the simple per-key compare is fast enough at our target scale.

### ID generation

Block IDs are branded strings:

```typescript
type BlockId = string & { readonly __brand: "BlockId" };
```

The brand prevents accidentally passing arbitrary strings where `BlockId`s are expected.

State-creating operations never generate IDs directly — they go through an injectable `IdAllocator`:

```typescript
interface IdAllocator {
  allocate(): BlockId;
}

const productionAllocator: IdAllocator = {
  allocate: () => crypto.randomUUID() as BlockId,
};

function createTestAllocator(prefix = "blk"): IdAllocator {
  let n = 0;
  return { allocate: () => `${prefix}-${n++}` as BlockId };
}
```

Every state-construction site (initial-state factories, edit operations, paste handlers, normalization passes) takes an `IdAllocator` either as an argument or via the editor's context. This generalizes the existing pattern — `normalize.ts` already accepts an `allocateId: () => string` callback. The same pattern, formalized at the type level.

**Lifecycle rules (mechanical, enforced by action handlers):**

1. **Creation** → always allocate a fresh ID. Never reuse.
2. **Deletion** → drop the block from `state.blocks`. Action handlers must cascade-delete any blocks referenced by `EmbedItem.properties.contentBlockId` from the deleted subtree (the footnote-body cascade).
3. **Copy/paste** → walk the copied subtree, allocate fresh IDs, build `Map<oldId, newId>`, rewrite all `parentId` / `prevSiblingId` / `nextSiblingId` / `firstChildId` / `lastChildId` / `contentBlockId` references via the map, then insert at the destination.
4. **Cross-document paste** → same as copy/paste; the destination's `IdAllocator` produces fresh IDs in its namespace.
5. **Undo/redo** → no allocation. Restore from snapshot; IDs are preserved across versions.

### Multi-block selection

A `Span` always has its `anchor` and `focus` in the same **selection context** (main document body, OR one specific footnote body, OR one specific header, etc.). Cross-context spans are not supported; this matches Word, Google Docs, and Apple Pages. The context is determined by walking up the parent chain to find the root (either `state.rootId` or some embed-content sub-tree root). When the cursor moves into a different context (e.g., user clicks in a footnote), the selection collapses; it does not extend across contexts.

Validation of "are these two positions in the same context?" is an O(depth) ancestor walk on each, performed at the action-handler level when a selection is constructed.

Within a context, a `Span` may cross block boundaries (e.g., selecting from paragraph 3 line 2 through paragraph 7 line 4). Operations that consume such spans use these utilities (Layer 2 — see "Layered API surface" below):

- **`compareBlocksInDocOrder(state, idA, idB): number`.** Build ancestor chains from each block to the context root. Find the lowest common ancestor (LCA); compare the two child branches of the LCA by walking LCA's child linked list. Returns negative/zero/positive in document order. Worst case O(depth + LCA-fanout); at the target scale (depth 3-5, fanout typically <100), bounded by ~100 sibling-pointer hops.

- **`normalizeSpan(state, span): Span`.** If `anchor.blockId === focus.blockId`, compare offsets. Otherwise, use `compareBlocksInDocOrder` to put `anchor` before `focus` in document order.

- **`nextBlockInDocOrder(state, blockId): BlockId | null`.** Depth-first traversal: descend into `firstChildId` if any; else `nextSiblingId`; else ascend to parent's `nextSiblingId` (recursive). Each step O(1).

- **`iterateSpan(state, span): Iterable<{ block, rangeStart, rangeEnd }>`.** Yields per-leaf-block ranges in document order. Same-block: yields once with the offset range. Cross-block: yields anchor block from `anchor.offset` to end-of-block; yields each intervening leaf block fully via `nextBlockInDocOrder`; yields focus block from start-of-block to `focus.offset`.

- **`iterateBlocksInSpan(state, span): Iterable<Block>`.** Yields each block (leaf or container) overlapped by the span. Used by block-level attribute changes and structural operations that need to see containers (set page-break-before, wrap in section, etc.).

Operations layer on these utilities. Specific algorithms:

- **`extractText(state, span)`** = walk `iterateSpan`; for each block, extract the substring of `inlineContent.items` from `rangeStart` to `rangeEnd`; join with `"\n"` between blocks. Embed items are rendered as the single character `U+FFFC OBJECT REPLACEMENT CHARACTER` (matches Apple TextKit, NSAttributedString, Pango). A multi-block span ending at `focus.offset === 0` of a block produces a trailing `\n` for the empty range — this matches Word and Google Docs "select to start of next paragraph" semantics.
- **`applyAttrsToRange(state, span, attrs, allocator)`** = walk `iterateSpan`; for each block, split text items at `[rangeStart, rangeEnd)` boundaries, merge `attrs` into the items in that range, run-merge adjacent same-attr items in a post-pass.
- **`deleteRange(state, span, allocator)`** = walk `iterateSpan` collecting blocks; produce a new state where: anchor block's content is `items[0..rangeStart)` ⊕ focus block's content `items[rangeEnd..)` (merged into the anchor block); intervening blocks are removed via `state.blocks.delete(id)`; cascade-delete any embed-referenced content blocks; reconnect parents' child linked lists.
- **`computeSelectionRects(state, layoutTree, span)`** (lives in editor module, not state) = walk `iterateSpan`, ask layout module for each block's selection rect of `[rangeStart, rangeEnd)`. The editor module computes inter-block "selection bridges" separately (selection-extends-to-page-edge between adjacent blocks).
- **`isInSelection(state, span, position)`** = `compareBlocksInDocOrder(state, position, span.anchor) ≥ 0 && compareBlocksInDocOrder(state, position, span.focus) ≤ 0` (per the LCA-walk decision).

### Dirty-set contract

Every Layer 3 operation (state-mutating) returns a structured result, not just a new state:

```typescript
interface OperationResult {
  state: State;             // new state after the operation
  dirtyIds: Set<BlockId>;   // every block id whose entry in state.blocks differs from the previous state
}
```

`dirtyIds` is produced at write-time, not via post-hoc tree comparison. Every operation that calls `state.blocks.set(id, ...)` or `state.blocks.delete(id)` records `id` in `dirtyIds`. The rendering pipeline consumes `dirtyIds` directly: for each dirty id, recompute its render node; for everything else, reuse the cached render node from the previous frame.

This invariant is enforced by every Layer 3 operation. The previous `state/dirty.ts` (which discovered dirtiness post-hoc and was unused dead code) goes away; dirtiness is now a first-class output of every edit.

### Snapshot and history semantics

Undo/redo lives in a single `History` data structure that wraps state snapshots:

```typescript
interface HistoryEntry {
  state: State;
  selectionBefore: Span | null;
  selectionAfter: Span | null;
  dirtyIds: Set<BlockId>;
  timestamp: number;
}

interface History {
  undoStack: ReadonlyArray<HistoryEntry>;
  redoStack: ReadonlyArray<HistoryEntry>;
  maxDepth: number;
}
```

Snapshots are cheap because the underlying `PersistentMap<BlockId, Block>` shares structure across versions — holding a reference to an old `State` doesn't duplicate the block table. Even with the wrapper-around-plain-Map implementation, each snapshot only retains its own copy of the Map; old snapshots aren't deep-cloned.

The current code's parallel `state/history.ts` and editor-module `EditorHistory` are collapsed into one. The editor's selection-history concerns are merged into `HistoryEntry` (the `selectionBefore` / `selectionAfter` fields), so undo/redo restores both state and selection together.

### Long-paragraph behavior

A single block of, e.g., 100,000 characters is allowed (no guardrail, no warning). Edit cost is O(N_block_chars + N_items + N_runs_affected) — for the extreme case, hundreds of microseconds per keystroke. Still under the 16ms frame budget. Documented but not optimized further; no rope upgrade path planned at this stage.

## Layered API surface

The state module exposes three layers of API. Consumers depend on the appropriate layer.

**Layer 1 — types and access primitives** (the data definition itself):
- Types: `Block`, `State`, `InlineContent`, `InlineItem` (`TextItem` | `EmbedItem`), `Position`, `Span`, `BlockId`, `IdAllocator`.
- HAMT-equivalent operations: `state.blocks.get(id)`, `.set(id, block)`, `.delete(id)`, `.has(id)`, iteration.
- Direct field access on `Block`: `parentId`, `prevSiblingId`, etc.

**Layer 2 — pure utilities** (computed from Layer 1, no mutation):
- Traversal: `nextBlockInDocOrder`, `prevBlockInDocOrder`, `ancestorChain`, `firstLeafBlock`, `lastLeafBlock`.
- Comparison: `compareBlocksInDocOrder` (LCA walk), `comparePositions`.
- Iteration: `iterateSpan`, `iterateBlocksInSpan`.
- Inline content: `inlineContentLength`, `findItemAtOffset`, `extractText`.
- Context discovery: `selectionContextOf(state, blockId)` — returns the root id of the block's selection context.

**Layer 3 — state-mutating operations** (produce new state + dirty-ids):
- `insertText(state, position, text, attrs, allocator) → OperationResult`
- `deleteRange(state, span, allocator) → OperationResult`
- `replaceRange(state, span, text, attrs, allocator) → OperationResult`
- `splitBlockAtPosition(state, position, allocator) → OperationResult`
- `mergeAdjacentBlocks(state, leftId, rightId) → OperationResult`
- `applyAttrsToRange(state, span, attrs, allocator) → OperationResult`
- `setBlockAttrs(state, blockId, attrs) → OperationResult`
- `setBlockType(state, blockId, type) → OperationResult`
- `insertBlock(state, parentId, beforeSiblingId, newBlock, allocator) → OperationResult`
- `removeBlock(state, blockId) → OperationResult` (cascades to embed-referenced contents)
- `clonePastedSubtree(state, sourceState, sourceRootId, allocator) → { rootedSubtree, blockIds }` (helper for paste; rewrites IDs)

Editor action handlers compose these. Layer 3 is the audited surface — all state-mutating logic lives here, nothing else can corrupt state.

## Cascade attribute-interpreter pipeline

A piece of architectural work the redesign forces, beyond just the state module: the cascade module (`packages/core/src/cascade/`) must move from "read `node.style` as a closed schema" to "run interpreters over `block.attrs` (open schema) to produce `ComputedStyle`."

**Current cascade contract** (today): `cascadePass(renderTree, parentComputedStyle) → renderTree-with-ComputedStyle`. Each render node has a closed-schema `style: Style` field; cascade reads it directly, applies inheritance and length-flattening, produces `ComputedStyle`.

**New cascade contract**: same shape, but the input render node carries `attrs: ReadonlyAttrs` (open schema, copied from the source block / inline item). Cascade walks `attrs`, looks up an `AttrInterpreter` for each key in a registry, calls each interpreter to get its `Partial<ComputedStyle>` contribution, merges contributions in registration order, applies inheritance and length-flattening as today, and produces `ComputedStyle`.

**The registry** lives in a new module `packages/core/src/cascade/attr-registry.ts`. It exposes:

```typescript
interface AttrRegistry {
  register(interpreter: AttrInterpreter): void;
  get(attrKey: string): AttrInterpreter | undefined;
  applyAll(attrs: ReadonlyAttrs, ctx: CascadeContext): Partial<ComputedStyle>;
}
```

A standard `text-style` plugin module (or just a top-level registration file) registers built-in interpreters at module load:
- `bold` → `{ fontWeight: "bold" } | {}`
- `italic` → `{ fontStyle: "italic" } | {}`
- `underline` → `{ textDecoration: "underline" } | {}`
- `fontFamily` → `{ fontFamily: value }`
- `fontSize` → `{ fontSize: value }`
- `color` → `{ color: value }`
- `backgroundColor` → `{ backgroundColor: value }`
- `link` → `{ color: "blue", textDecoration: "underline" }` (or context-dependent)
- (Block-level) `headingLevel` → `{ fontSize: ..., fontWeight: ..., marginTop: ... }`

This unifies block-level and inline-level attribute handling — same registry, same interpretation pass at different levels.

## `BlockView` interface for components

The components module's render-function interface adapts from receiving a `StateNode` to receiving a `BlockView`:

```typescript
interface BlockView {
  id: BlockId;
  type: string;
  attrs: ReadonlyAttrs;
  parentId: BlockId | null;
  // For container blocks:
  childCount: number;                           // 0 for leaves
  // For leaf blocks: the parsed inline content, with adjacent same-attr text items already merged.
  inlineContent: InlineContent | null;
}

type ComponentRenderFn = (block: BlockView, children: RenderNode[]) => ElementBox | TextBox;
```

The render module constructs `BlockView`s from blocks before calling each component's render function. Components don't reach into `state.blocks` themselves — they receive only what they need. This is a cleaner separation than today's `(StateNode, children)` interface, which gives components access to the entire subtree.

The `text` component goes away (no `text` state-node type exists in the new model — text is items inside `inlineContent`).

The `span` component goes away as a state-node type (no `span` state-node type either — spans are reconstructed by render from same-attr text-item groupings). It may still exist as a render-only synthetic component if useful for the render module's parse pass, but it's no longer registered as something that can appear in state.

## State consumers (honest accounting)

The state module's types and utilities are imported by these places. The migration touches every one of them:

- **`packages/core/src/cursor/`** — `cursor-ops.ts`, `selection.ts`. Use `Position`, `Span`, `getNodeByPath`, `getTextContentLength`. Already has `Intl.Segmenter` for grapheme/word boundaries — that code is **ported**, not reinvented, when the cursor module adopts the new `Position`.
- **`packages/core/src/render/`** — `render.ts`. Walks the state tree to produce render nodes. Replaced by the new render module's parse pass.
- **`packages/core/src/cascade/`** — `cascade-pass.ts`. Reads `node.style`. Migrated to use the attr-interpreter registry above.
- **`packages/core/src/styles/`** — `computed-style.ts`, `used-style.ts`, `property-meta.ts`. Reference the closed `Style` type. Stay closed-schema; only their *input pathway* changes (via cascade-interpreters).
- **`packages/core/src/layout/`** — `used-style.ts`, `ifc.ts`, `bfc.ts`. Read `StateNode.style` indirectly via render nodes. After migration, layout reads `ComputedStyle` only — no direct state coupling.
- **`packages/core/src/editor/`** — 53 action handler files in `actions/`, plus `editor-state.ts`, `cursor-position.ts`, `hit-test.ts`, `line-navigation.ts`, `selection-geometry.ts`, `editor-action.ts`. All thread `StateNode` / `Position` through their signatures. The largest migration surface.
- **`packages/core/src/components/`** — every component definition (`paragraph`, `heading`, `list`, `list-item`, `text`, `span`, `table`, `image`, `horizontal-line`, etc.). Migrated to the new `BlockView` interface; `text` and `span` deleted.
- **`packages/core/src/test-utils/`** — fixture builders that hand-construct `StateNode` trees. Rewritten to construct `State` + `Block` graphs with deterministic test ID allocation.
- **`packages/core/src/integration/`** — 17 of 20 files import state types. Tests rewritten alongside the modules they integrate with.

CLAUDE.md's existing line *"O(1) per keystroke and per cursor-move regardless of document size"* is also updated as part of this migration: replace with *"Smooth editing (sub-millisecond per keystroke, sub-frame per cursor-move) at Google-Docs / Notion scale (≤ 10,000 blocks per document, graceful degradation to ≤ 100,000)."*

## Migration strategy

**Approach: feature branch with allowed-broken-intermediates.** All work happens on `feature/dom-architecture-redesign` (or a sub-branch off it). Intermediate commits may not build or pass tests. Each commit is logically coherent and reviewable on its own. The migration ends with a single greening commit where everything builds and all tests pass; that's the gate to anything downstream.

No `legacy/` subdirectory. No parallel implementations. **Each old file is deleted in the same commit that introduces its replacement** — the cleanest expression of "allowed-broken-intermediates," and avoids long-lived filename collision bookkeeping.

Public API surface (`packages/core/src/index.ts`) may be temporarily inconsistent during the migration; finalized in the cleanup step. No external consumers of `@taleweaver/core` need to be considered (confirmed by user: code is not yet used by anyone beyond the in-repo example app).

### Logical work order

Greenness is not required at each step, but order matters for tractability:

1. **Spec finalization** (this document is the artifact).
2. **Add `state/persistent-map.ts`** — the wrapper around plain `Map<BlockId, Block>`. Trivial, no dependencies on later steps.
3. **Add Layer 1 types** — `block.ts`, `state.ts`, `inline-content.ts`, `position.ts`, `block-id.ts`, `attrs.ts`. Old files (`state-node.ts`, old `position.ts`, etc.) deleted in the same commits that add their replacements. Build is broken from this commit onward until consumers catch up.
4. **Add new test-utils builders** for constructing `State` + `Block` graphs with deterministic test allocator. Old test-utils builders for `StateNode` trees deleted.
5. **Add Layer 2 utilities + tests** — `block-traversal.ts`, `block-compare.ts`, `span-iteration.ts`, `extract-text.ts` (new version).
6. **Add Layer 3 operations + tests** — `operations.ts`, `insert-text.ts`, `delete-range.ts`, `split-block.ts`, `merge-blocks.ts`, `apply-attrs.ts`. The bulk of new state-module test coverage lands here.
7. **Cascade attribute-interpreter pipeline** — `cascade/attr-registry.ts` plus registration of built-in interpreters. Update `cascade/cascade-pass.ts` to use the registry.
8. **Render module rewrite** — new parse pass, new `BlockView` construction, dispatch through components registry.
9. **Components rewrite** — `text` deleted, `span` deleted (or repurposed as render-only), container components migrated to `BlockView` interface.
10a. **Cursor module: types + position math** — adopt new `Position`. Port grapheme-cluster logic from existing `cursor-ops.ts`.
10b. **Editor module rewrite** — every action handler in `editor/actions/*` updated. `editor-state.ts` history collapsed with state-module history. `cursor-position.ts`, `hit-test.ts`, `line-navigation.ts`, `selection-geometry.ts` updated. The largest single chunk; can be split into per-action-family commits if needed (inline-text actions, block-structure actions, selection actions, layout-coupled actions).
10c. **Cursor module: selection adaptation** — anything in cursor that depends on editor's hit-test or selection-geometry, after editor stabilizes.
11. **Layout / styles consumer updates** — anything in `layout/` and `styles/` that still references `StateNode` cleaned up.
12. **Integration tests rewrite** — the 17 integration test files updated to use the new state shape.
13. **Performance benchmarks** — add benchmarks for the perf acceptance criteria (see "Definition of done"). Run them, ensure they pass.
14. **Cleanup commit** — delete any remaining old state-module files, finalize public exports in `packages/core/src/index.ts`.
15. **Architecture docs updated** — `docs/architecture/1-core/1.1-state.md` rewritten to describe the new model. Other docs that reference the old types (overview, render, cascade) updated.
16. **Final greening pass** — typecheck (`npm run build --workspace=packages/core`), unit tests (`npm test --workspace=packages/core`), integration tests, browser smoke (`npm run dev --workspace=examples/react`, exercise editor manually), perf benchmarks. All green = migration complete.

Each numbered step lands as one commit (or a small group of commits, when the step is large enough — step 10b realistically becomes 4-5 commits grouped by action family). Total: ~25-30 commits over the migration.

## Definition of done

The migration is complete when ALL of the following are true. Any agent picking up this work mid-migration should check this list to verify direction.

### File inventory

`packages/core/src/state/` after migration contains exactly these files (and their `.test.ts` siblings):

- `block.ts` — `Block` type
- `state.ts` — `State` container type
- `inline-content.ts` — `InlineContent`, `InlineItem`, `TextItem`, `EmbedItem` types + access helpers
- `position.ts` — `Position`, `Span` types + `createPosition`, `createSpan`, `positionsEqual`
- `block-id.ts` — `BlockId` branded type, `IdAllocator` interface, `productionAllocator`, `createTestAllocator`
- `attrs.ts` — `ReadonlyAttrs` type, `attrsEqual`, deep-value-equality helper
- `persistent-map.ts` — wrapper around `Map<BlockId, Block>` with persistent-map API
- `block-traversal.ts` — Layer 2 traversal utilities
- `block-compare.ts` — Layer 2 comparison utilities
- `span-iteration.ts` — Layer 2 iteration utilities
- `extract-text.ts` — Layer 2 text extraction
- `operations.ts` — Layer 3 operation barrel
- `insert-text.ts`, `delete-range.ts`, `split-block.ts`, `merge-blocks.ts`, `apply-attrs.ts` — Layer 3 operations
- `history.ts` — single unified history with `HistoryEntry` (state + selection + dirtyIds)
- `dirty.ts` — only if any utility for working with dirty sets is needed; otherwise the type lives in `operations.ts` and this file does not exist
- `initial-state.ts` — `createEmptyDocument(allocator)`
- `index.ts` — barrel exports

These files **do NOT exist** after migration (deleted): `state-node.ts`, `create-node.ts`, `new-node.ts`, `formatting.ts`, `transformations.ts`, `text-utils.ts`, `find-path.ts`, `normalize.ts` (the structural-paragraph maintenance moves into the relevant Layer 3 operations or a new module if substantial), and the old `dirty.ts` (the dead-code post-hoc comparison version).

### Public API surface

`packages/core/src/index.ts` exports:

- All Layer 1 types: `Block`, `State`, `InlineContent`, `InlineItem`, `TextItem`, `EmbedItem`, `Position`, `Span`, `BlockId`, `IdAllocator`, `ReadonlyAttrs`.
- All Layer 1 factories: `productionAllocator`, `createTestAllocator`, `createEmptyDocument`.
- All Layer 2 utilities (alphabetically): `ancestorChain`, `attrsEqual`, `compareBlocksInDocOrder`, `comparePositions`, `extractText`, `findItemAtOffset`, `firstLeafBlock`, `inlineContentLength`, `iterateBlocksInSpan`, `iterateSpan`, `lastLeafBlock`, `nextBlockInDocOrder`, `prevBlockInDocOrder`, `selectionContextOf`.
- All Layer 3 operations: `applyAttrsToRange`, `deleteRange`, `insertBlock`, `insertText`, `mergeAdjacentBlocks`, `removeBlock`, `replaceRange`, `setBlockAttrs`, `setBlockType`, `splitBlockAtPosition`, `clonePastedSubtree`.
- History: `History`, `HistoryEntry`, `createHistory`, `pushHistoryEntry`, `undo`, `redo`.
- Operation result type: `OperationResult`.
- Cascade attribute registration: `AttrInterpreter`, `registerAttr`.

Old exports (`StateNode`, `NewNode`, `createNode`, `createTextNode`, `updateProperties`, `insertChild`, `removeChild`, `getNodeByPath`, `updateAtPath`, `findPathById`, `applyInlineStyle`, `getStyleInRange`, `remapPosition`, `findDirtyPaths`, `isDirty`) are removed.

### Architectural invariants (must hold)

- **No `StateNode` references anywhere in the codebase.** `grep -r "StateNode" packages/core/src/` returns nothing (except possibly in this spec's history-of-decisions section).
- **`Position` is `{ blockId, offset }` everywhere.** No path-based positions remain.
- **Every Layer 3 operation returns `OperationResult` (`{ state, dirtyIds }`).** Verified by type signatures.
- **`dirtyIds` is produced at write-time, never via post-hoc comparison.** Verified by code inspection of every Layer 3 operation.
- **Selection contexts validated.** Every `Span` constructed by an action handler passes through a context-validation check; cross-context spans are rejected or collapsed.
- **No orphaned blocks.** After any sequence of operations, every block in `state.blocks` is reachable from `state.rootId` via parent/child links, OR is referenced by some `EmbedItem.properties.contentBlockId` (recursively from a reachable block). Verified by an invariant test in the test suite.
- **`text` and `span` are not registered component types.** `componentRegistry.has("text") === false`, `componentRegistry.has("span") === false`.
- **Inline content normalized.** No leaf block has adjacent text items with equal `attrs` after any operation. Verified by an invariant test.
- **No file in `state/` exceeds 500 LOC.** If one does, it's a signal to split.

### Test coverage

- Every Layer 2 utility has a test file with unit tests covering the documented behavior.
- Every Layer 3 operation has a test file with unit tests covering: typical case, edge cases (empty blocks, boundary positions, cross-block effects, embed-lifecycle interactions, single-block degenerate cases).
- Property-based tests for: `attrsEqual` (reflexivity, symmetry, transitivity), `iterateSpan` (yields blocks in document order for randomized doc shapes), `compareBlocksInDocOrder` (consistent total order on randomized blocks), `clonePastedSubtree` (no ID collisions, all references rewritten correctly).
- Invariant tests: no orphaned blocks, no un-normalized inline content, no cross-context selections.
- Integration tests in `packages/core/src/integration/` rewritten to construct new-shape state and exercise editor operations end-to-end.

### Performance acceptance criteria

Measured by benchmarks in `packages/core/src/state/perf.bench.ts` (or similar):

- **Per-keystroke `insertText` at 10,000 blocks:** < 1 ms (target = "smooth").
- **Per-keystroke `insertText` at 100,000 blocks:** < 16 ms (target = "graceful degradation, sub-frame").
- **Per-cursor-move at 10,000 blocks:** < 1 ms.
- **Cross-block `compareBlocksInDocOrder` at 10,000 blocks, typical depth 5:** < 100 µs.
- **Memory usage of 100 undo snapshots at 10,000 blocks:** < 100 MB (rough — exact threshold can be tuned, but the order-of-magnitude check matters).

Benchmarks run as part of step 16 of the migration; failing benchmarks block "definition of done."

### Build / test acceptance criteria

- `npm run build --workspace=packages/core` succeeds with no TypeScript errors.
- `npm test --workspace=packages/core` passes 100% of tests.
- `npm test --workspace=packages/core/src/integration` (or equivalent integration test runner) passes 100%.
- `npm run dev --workspace=examples/react` launches the editor; a manual smoke test (insert text in multiple paragraphs, format text bold/italic, create lists, undo/redo, copy/paste a multi-paragraph selection) works without errors.
- Performance benchmarks pass per the criteria above.

### Documentation updates

- `docs/architecture/1-core/1.1-state.md` rewritten to describe the new state module.
- `docs/architecture/overview.md` updated where it references the state module.
- `docs/architecture/1-core/overview.md` updated.
- CLAUDE.md performance line revised (per "State consumers" section above).

## Decisions log

All ten open questions raised during the brainstorm have been resolved (2026-05-02). Listed in original order; each entry includes the decision and the reasoning context that led to it.

1. ~~**Order-maintenance tags for O(1) position compare.**~~ **DECIDED 2026-05-02:** **Not adopting order-maintenance tags.** Cross-block position compare uses an LCA walk: O(depth + siblings-between-the-two-branches-at-LCA). At the recalibrated target scale (≤ 10,000 blocks, typical depth 3-5), worst-case LCA walks are bounded by ~100 sibling-pointer hops — microseconds. Order tags would only be needed if we targeted the pathological 1M-flat-children case, which we explicitly don't. This matches the practice of block-tree editors at similar scale (Slate, Lexical). Decision can be revisited if real-world benchmarks show otherwise.

2. ~~**Offset units within the rope.**~~ **DECIDED 2026-05-02:** `Position.offset` is in **UTF-16 code units**, with the cursor module enforcing grapheme-cluster boundaries on user-driven movements (arrow keys, double-click word select, etc.) via `Intl.Segmenter`. This matches the universal pattern across Microsoft Word, Google Docs, Apple Pages/TextKit, LibreOffice, DOM `Range`/`Selection`, CodeMirror 6, Monaco, ProseMirror, Slate, Lexical, TipTap, and Quill — every serious editor researched. Reasons: storage stability across Unicode versions (cluster boundaries change with new emoji); O(1) random access into rope leaves; standards alignment (OT/CRDT, serialization, accessibility APIs all assume code-unit offsets); concurrency (collaborators must agree on offsets, which requires a stable unit). Two-layer architecture: storage in code units, user-facing movement in clusters. The current `getTextContentLength` returning `string.length` is correct *as a code-unit count*; the architecture doc's "code-point count" claim was wrong and gets corrected. The cursor module gains explicit cluster-aware navigation it doesn't have today.

3. ~~**Inline content storage threshold.**~~ **DECIDED 2026-05-02:** **No rope. Flat array of styled items (text runs + embed items).** Per-block edits are O(N_block) with tiny constants — sub-millisecond at any realistic block size. Matches Notion's rich-text-array and Google Docs' `ParagraphElement` array. Long-paragraph behavior accepted (open question 6 below was also resolved as "allowed, no guardrail").

4. ~~**ID generation.**~~ **DECIDED 2026-05-02:** **UUID v4 in production via `crypto.randomUUID()`, with an injectable `IdAllocator` for tests.** `BlockId` is a branded `string & { readonly __brand: "BlockId" }` for compile-time safety. Matches Notion's choice; collab-ready without coordination. Lifecycle rules are enforced by action handlers, not the data model: (1) creation always allocates fresh, (2) deletion cascades to embed-referenced blocks (footnote bodies), (3) copy/paste walks the copied subtree, allocates fresh IDs, builds a `Map<oldId, newId>`, and rewrites all `parentId`/`siblingId`/`childId`/`contentBlockId` references using the map, (4) undo/redo preserves IDs (snapshot restore). See "ID generation" section for full definition.

5. ~~**Embed mechanism for inline images, equations, footnote markers.**~~ **DECIDED 2026-05-02:** Inline embeds are **first-class items in the inline sequence** (alongside text items in `InlineContent.items`). Each embed counts as one cursor position. Primitive embeds carry data in `properties` inline (image src, mention userId, equation LaTeX, date value). Substantial-content embeds (footnote anchors) carry `properties.contentBlockId: BlockId` referencing a separate block in `state.blocks` whose subtree holds the body. Lifecycle (creation, deletion, copy-paste cloning, cross-doc re-keying) is managed by action handlers, not the data model. Matches Google Docs' particle model + `document.footnotes` reference pattern.

6. ~~**Long-paragraph guardrail.**~~ **DECIDED 2026-05-02:** No guardrail. Long blocks allowed. O(N_block) edit cost accepted; documented in the data structures section.

7. ~~**Attribute schema (open vs closed).**~~ **DECIDED 2026-05-02:** **Open schema at state level + closed schema at `ComputedStyle` (post-cascade) + registered interpreters per attribute key.** Default deep-value-equality for run-merging compare; interpreters can opt in to custom `equals`. No interning. See data structures section for full definition. Matches Notion's annotation-extensibility and ProseMirror's mark-extensibility patterns.

8. ~~**Migration strategy.**~~ **DECIDED 2026-05-02:** **Feature branch with allowed-broken-intermediates.** All work happens on `feature/dom-architecture-redesign`. Intermediate commits may not build/pass tests; each commit is logically coherent. Each old file is deleted in the same commit that introduces its replacement (no `legacy/` subdirectory, no parallel implementations). Migration ends with a single greening commit. See "Migration strategy" section above for the full work order. No external consumers of `@taleweaver/core` need to be considered (confirmed by user).

9. ~~**Public API compatibility.**~~ **DECIDED 2026-05-02:** **Clean break, no transitional shims.** `StateNode` and all old types are removed entirely from the public exports. Public `index.ts` may be temporarily inconsistent during the migration; finalized in step 14. See "Definition of done" → "Public API surface" for the post-migration export list. This is enabled by question 8's "no external consumers" finding.

10. ~~**Selection across multiple blocks.**~~ **DECIDED 2026-05-02:** **Selection contexts + Layer 2 iteration utilities** (`iterateSpan`, `iterateBlocksInSpan`, `compareBlocksInDocOrder` via LCA walk, `nextBlockInDocOrder`). All cross-block operations (extractText, applyAttrsToRange, deleteRange, computeSelectionRects, isInSelection) compose these. A `Span` always has its `anchor` and `focus` in the same selection context (main body, OR one specific footnote, etc.) — cross-context spans are not supported, matching Word, Google Docs, and Apple Pages. See "Multi-block selection" section above for the full algorithm.

## What this spec is NOT

This spec covers the **state module redesign** and its migration plan. It does NOT cover:

- The detailed implementation plan with per-commit task lists and TDD ordering — that's a separate plan doc to follow (see writing-plans). This spec defines *what* and *why*; the plan defines *how* and *when*, broken into per-task TDD-driven work.
- Collaboration / real-time editing — out of scope per CLAUDE.md, though the design choices here (open-schema attrs, ID-based positions, separate persistent map) keep the door open for future CRDT integration.
- The layout-level dirty tracking and content-addressed memoization (`LayoutCache`, incremental pagination) — that's a layout-module design discussion, separate from state. The state module's contribution to dirty tracking is the `dirtyIds` set produced by every Layer 3 operation.

## Things this redesign also fixes (incidentally)

These were issues in the existing state module flagged in a prior review, all resolved as a side-effect of the redesign:

- **`state/dirty.ts` (current dead code) goes away.** The current `findDirtyPaths` discovers dirtiness via post-hoc tree comparison and is never called by anything in the codebase. Replaced by edit-time `dirtyIds` recording — every Layer 3 operation produces `OperationResult` with the dirty set already computed.
- **Parallel `state/history.ts` and editor's `EditorHistory` collapse into one.** Today they have parallel implementations of the same idea (state-level snapshot history vs. editor-level selection-aware history). Merged into a single `History` with `HistoryEntry` carrying state + selection + dirtyIds.
- **The `formatting.ts` ↔ architecture-doc contradiction is resolved.** Inline styles are attributes on text items, full stop. No span wrapping in state; spans appear only in the render tree where they belong. The 636-line `formatting.ts` is deleted entirely, replaced by `applyAttrsToRange(state, span, attrs, allocator)` in `state/operations.ts`.
- **`getTextContentLength` UTF-16 vs code-point bug.** Resolved by question 2's offset-unit decision: UTF-16 code units throughout, with the cursor module enforcing grapheme-cluster boundaries on user-driven movements via `Intl.Segmenter` (already present in current `cursor/cursor-ops.ts`, ported to the new `Position` type).
- **Inconsistent ID-allocation patterns** (current code mixes `splitNode(state, position, newNodeId, ...)` with `applyInlineStyle(state, span, styles, newNodeIdBase)` with `normalizeDocument(state, allocateId)`). Unified into the single `IdAllocator` interface threaded through every state-construction site.
- **Non-null assertions (`!`) violating CLAUDE.md type-safety rule.** Current `transformations.ts` and `formatting.ts` have multiple `!` assertions on `getNodeByPath` results. The new operations all use proper narrowing — Layer 1 access methods return `Block | undefined` and consumers handle absence explicitly.
- **Hardcoded `BLOCK_TYPES` list in `state/extract-text.ts`.** The current code hardcodes `["paragraph", "heading", "list-item"]` to know what counts as a block boundary for newline insertion. The new `extractText` walks block boundaries via the actual block tree (`iterateSpan` yields per-block ranges naturally), so no hardcoded list is needed.

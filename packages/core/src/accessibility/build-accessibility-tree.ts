import {
  getBlock,
  resolveBlock,
  getEmbedContentIds,
  getTemplateContentIds,
  iterateBlocksInDocumentOrder,
  createPosition,
  createSpan,
  extractText,
  captionEmbedSerializer,
  coerceBlockId,
  itemVisibleInView,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  INLINE_IMAGE_EMBED_TYPE,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  PAGE_FIELD_EMBED_TYPE,
  CROSS_REFERENCE_EMBED_TYPE,
  getListDefsForState,
  classifyListDef,
  docHasLists,
  type Block,
  type BlockId,
  type InlineItem,
  type State,
  type SuggestionView,
} from "../state";
import { collectListEvents, computeCounters } from "../numbering";
import type { CounterValue } from "../numbering";
import { inlineRenderKey } from "../render/inline-render-key";
import type {
  AccessibilityNode,
  AccessibilityTextRun,
  BuildAccessibilityTreeOptions,
} from "./accessibility-node";

const DEFAULT_VIEW: SuggestionView = "suggesting";

/**
 * A function that resolves a `BlockId` to its `Block`. Two concrete instances:
 *  - `mainResolve`: delegates to `getBlock(state, id)` — looks up only the main
 *    blocks tree. Used for the root document subtree.
 *  - `anyResolve`: delegates to `resolveBlock(state, id)?.block ?? null` — looks
 *    across all three trees (main, embedContents, templateContents). Used when
 *    walking embed/template body subtrees whose blocks live in their own Y.Map.
 */
type BlockResolver = (id: BlockId) => Block | null;

/** The inline emphasis attr keys, in the fixed order they are emitted on a run. */
const EMPHASIS_KEYS = ["bold", "italic", "underline", "strikethrough"] as const;
type Emphasis = (typeof EMPHASIS_KEYS)[number];

/** A run being accumulated as the walk proceeds; flushed into an `AccessibilityTextRun`. */
interface OpenRun {
  text: string;
  start: number;
  end: number;
  link: string | undefined;
  emphasis: readonly Emphasis[] | undefined;
  suggestion: "insertion" | "deletion" | undefined;
  inComment: boolean;
}

/** `link` attr if it is a string, else `undefined`. */
function linkOf(attrs: Block["attrs"]): string | undefined {
  return typeof attrs.link === "string" ? attrs.link : undefined;
}

/**
 * Collect the truthy emphasis attrs in fixed order, or `undefined` when none are
 * set (so an unstyled run never carries an empty `emphasis: []`).
 */
function emphasisOf(attrs: Block["attrs"]): readonly Emphasis[] | undefined {
  const out: Emphasis[] = [];
  for (const key of EMPHASIS_KEYS) {
    if (attrs[key]) out.push(key);
  }
  return out.length === 0 ? undefined : out;
}

/** Two emphasis values are equal iff both undefined, or same elements in order. */
function emphasisEqual(
  a: readonly Emphasis[] | undefined,
  b: readonly Emphasis[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Materialize an `OpenRun` into an emitted run, including only present fields. */
function flush(out: AccessibilityTextRun[], run: OpenRun): void {
  const emitted: AccessibilityTextRun = {
    text: run.text,
    sourceOffsetStart: run.start,
    sourceOffsetEnd: run.end,
    ...(run.emphasis !== undefined ? { emphasis: run.emphasis } : {}),
    ...(run.link !== undefined ? { link: run.link } : {}),
    ...(run.suggestion !== undefined ? { suggestion: run.suggestion } : {}),
    ...(run.inComment ? { inComment: true } : {}),
  };
  out.push(emitted);
}

/** The page-valued-field kind of an inline item, or undefined if it is not one. */
function pageFieldKindOf(
  item: InlineItem,
): "page-number" | "page-count" | "cross-ref-page" | undefined {
  if (item.kind !== "embed") return undefined;
  if (item.embedType === PAGE_FIELD_EMBED_TYPE) {
    const k = item.properties.fieldKind;
    return k === "page-number" || k === "page-count" ? k : undefined;
  }
  if (item.embedType === CROSS_REFERENCE_EMBED_TYPE && item.properties.refMode === "page") {
    return "cross-ref-page";
  }
  return undefined;
}

/**
 * Split a block's inline content into one or more `AccessibilityTextRun`s by
 * link + emphasis, emitting footnote-anchors as standalone `noteref` runs.
 *
 * `sourceOffsetStart/End` are LITERAL block offsets: a text item contributes one
 * offset per UTF-16 code unit; an embed contributes exactly 1. `text` is the
 * display projection (through `captionEmbedSerializer` + the requested `view`),
 * so a run's `text` may be SHORTER than its literal span (an embed serializing to
 * "" still occupies its offset). Every literal offset is covered by exactly one
 * run. Adjacent items merge into one run iff their `link` and `emphasis` match;
 * a footnote-anchor always flushes the open run and emits its own.
 *
 * Returns an empty array when the block carries no inline content or it is empty.
 */
function collectRuns(
  state: State,
  block: Block,
  view: SuggestionView,
): readonly AccessibilityTextRun[] {
  if (block.inlineContent === null) return [];
  const items = block.inlineContent.items;
  const out: AccessibilityTextRun[] = [];
  let open: OpenRun | null = null;
  let offset = 0;
  let inCommentDepth = 0;

  for (const [i, item] of items.entries()) {
    const literalLen = item.kind === "text" ? item.text.length : 1;

    // An item projected AWAY by the requested view contributes no run, but still
    // occupies its literal offset span (surviving runs keep their literal offsets).
    if (!itemVisibleInView(item, view)) {
      offset += literalLen;
      continue;
    }

    // Footnote-anchor: flush the open run, then emit a standalone noteref run.
    if (item.kind === "embed" && item.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE) {
      if (open !== null) {
        flush(out, open);
        open = null;
      }
      const bodyId = coerceBlockId(item.properties.contentBlockId);
      out.push({
        text: "",
        sourceOffsetStart: offset,
        sourceOffsetEnd: offset + 1,
        ...(bodyId !== undefined ? { noteref: bodyId } : {}),
      });
      offset += 1;
      continue;
    }

    // Inline-image: an image that flows IN LINE with text. Like the footnote-anchor,
    // it flushes the open run and emits its OWN standalone run — carrying the alt
    // text (the AT-announced image label) and an empty display text "". The dom-mirror
    // host materializes this run as a role="img" element with aria-label = the alt.
    if (item.kind === "embed" && item.embedType === INLINE_IMAGE_EMBED_TYPE) {
      if (open !== null) {
        flush(out, open);
        open = null;
      }
      const alt = typeof item.properties.alt === "string" ? item.properties.alt : "";
      out.push({
        text: "",
        sourceOffsetStart: offset,
        sourceOffsetEnd: offset + 1,
        imageAlt: alt,
      });
      offset += 1;
      continue;
    }

    // Comment-start/comment-end: adjust inCommentDepth, advance offset, emit nothing.
    if (item.kind === "embed" && item.embedType === COMMENT_START_EMBED_TYPE) {
      inCommentDepth += 1;
      offset += 1;
      continue;
    }
    if (item.kind === "embed" && item.embedType === COMMENT_END_EMBED_TYPE) {
      inCommentDepth = Math.max(0, inCommentDepth - 1);
      offset += 1;
      continue;
    }

    // Page-valued field (page-number / page-count / cross-ref "page" mode): a field
    // is its OWN run — flush the open run, emit a distinct run carrying its render
    // key + a "" placeholder (geometry-free; the dom-host fills the resolved value
    // by globalFieldValues.get(fieldKey)). Keyed by the LITERAL array index `i`
    // (identical to render-core's key), NOT the literal `offset`.
    const fieldKind = pageFieldKindOf(item);
    if (fieldKind !== undefined) {
      if (open !== null) {
        flush(out, open);
        open = null;
      }
      out.push({
        text: "",
        sourceOffsetStart: offset,
        sourceOffsetEnd: offset + 1,
        fieldKind,
        fieldKey: inlineRenderKey(block.id, i),
      });
      offset += 1;
      continue;
    }

    // General path: serializes text items directly and embeds via captionEmbedSerializer.
    //
    // WHY the general path is the CORRECT default for remaining embeds — no throw needed:
    // Every embed type that requires DEDICATED handling (footnote-anchor → noteref,
    // comment-start/end → depth tracking) is already caught by the explicit branches
    // above. All remaining embeds either serialize to meaningful display text (tab →
    // "\t", hard-break → "\n", cross-reference → resolved text, page-field → page
    // number/count) or to "" (block-join/block-split suggestion markers, which are
    // structural and have zero a11y meaning — they're projected away by itemVisibleInView
    // in non-suggesting views, and serialize to "" harmlessly in suggesting view).
    // Adding a throw here would incorrectly fire on tab, hard-break, cross-reference,
    // page-field, and suggestion markers — all of which are legitimately handled by the
    // general path. The block-type guard (assertUnmappedBlockType) is the load-bearing
    // exhaustiveness guard for slice 1; a per-embed guard would require enumerating
    // every "serializable" embed type explicitly, which is a maintenance trap.
    const display = extractText(
      state,
      createSpan(
        createPosition(block.id, offset),
        createPosition(block.id, offset + literalLen),
      ),
      captionEmbedSerializer,
      view,
    );
    const link = linkOf(item.attrs);
    // Embeds (other than footnote anchors and comment markers) carry their link but no emphasis.
    const emphasis = item.kind === "text" ? emphasisOf(item.attrs) : undefined;
    // Suggestion provenance: text items only; embeds carry no suggestion.
    const suggestion: "insertion" | "deletion" | undefined =
      item.kind === "text"
        ? typeof item.attrs[INSERTION_SUGGESTION_ATTR] === "string"
          ? "insertion"
          : typeof item.attrs[DELETION_SUGGESTION_ATTR] === "string"
            ? "deletion"
            : undefined
        : undefined;
    const inComment = inCommentDepth > 0;

    if (
      open !== null &&
      open.link === link &&
      emphasisEqual(open.emphasis, emphasis) &&
      open.suggestion === suggestion &&
      open.inComment === inComment
    ) {
      open.text += display;
      open.end = offset + literalLen;
    } else {
      if (open !== null) flush(out, open);
      open = {
        text: display,
        start: offset,
        end: offset + literalLen,
        link,
        emphasis,
        suggestion,
        inComment,
      };
    }
    offset += literalLen;
  }

  if (open !== null) flush(out, open);
  return out;
}

/**
 * Resolve `listLevel` from a block's attrs defensively — must be a non-negative
 * integer; anything else coerces to 0.
 */
function listLevelOf(attrs: Block["attrs"]): number {
  const raw = attrs.listLevel;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Resolve `listId` from a block's attrs defensively. Returns the string value
 * if present, or `null` if absent or not a string.
 */
function listIdOf(attrs: Block["attrs"]): string | null {
  const raw = attrs.listId;
  return typeof raw === "string" ? raw : null;
}

/**
 * Build a bare `listitem` AccessibilityNode for a single `list-item` block with
 * no children yet. Used by both `groupListItems` (where children are injected
 * later by the nesting algorithm) and `buildBlockNode` (isolation path).
 */
function buildBareListItem(
  state: State,
  block: Block,
  view: SuggestionView,
  listOrdinal?: number,
): AccessibilityNode {
  return {
    role: "listitem",
    sourceBlockId: block.id,
    level: listLevelOf(block.attrs),
    text: collectRuns(state, block, view),
    children: [],
    // #555: the resolved ordinal of an ORDERED item, so the dom-mirror emits
    // `<li value=N>` and AT announces the true number (start-at/restart aware),
    // not the browser-native 1,2,3… of a bare `<ol>`. Omitted for bullets.
    ...(listOrdinal !== undefined ? { listOrdinal } : {}),
  };
}

/**
 * Group a contiguous run of `list-item` blocks (same parentId context, already
 * in document order) into one or more synthetic `list` nodes.
 *
 * Algorithm:
 * 1. Break the run into sub-runs by `listId` change (different listId → new
 *    sibling list node at the top level).
 * 2. Within one `listId` sub-run, nest by `listLevel` using an explicit stack.
 *    The stack tracks `{ level, listItems: AccessibilityNode[] }`. When a deeper
 *    level is encountered, we push a new stack frame and eventually attach it
 *    as a nested list child of the most-recent shallower listitem. When the
 *    level decreases, we pop and flush the accumulated nested list.
 *
 * Ordered-ness null-guard: `classifyListDef` takes a non-optional `ListDef`.
 * If the `listId` is absent from the state's defs map, we default `listOrdered`
 * to `false` (unordered) rather than calling `classifyListDef(undefined)`.
 */
function groupListItems(
  state: State,
  items: readonly Block[],
  view: SuggestionView,
): readonly AccessibilityNode[] {
  if (items.length === 0) return [];

  const listDefs = getListDefsForState(state);

  // #555: resolve every item's ordinal via the SAME numbering engine the
  // render/HTML paths use (single source of truth, never re-derived). Ordered
  // listitems carry `listOrdinal` so the dom-mirror can emit `<li value=N>` and
  // AT announces start-at/restart numbers correctly.
  //
  // GRANULARITY (deliberate v1): computed once per `groupListItems` call — i.e.
  // once per MAXIMAL CONSECUTIVE run of list-items under a parent, NOT once per
  // tree build. A document with k list runs separated by non-list blocks pays k
  // full-document `collectListEvents`+`computeCounters` walks (O(k·N)). The walk is
  // BODY-only (`collectListEvents` → `iterateBlocksInDocumentOrder`), so embed/
  // template bodies never re-trigger it. Acceptable because k is 1 for the common
  // case and the a11y mirror is opt-in. If a list-heavy interleaved document ever
  // measures as a bottleneck, hoist this to `buildAccessibilityTree` (compute once)
  // and thread the map through `buildBlockNode`/`buildChildren`/`buildTable*` to
  // here — pure mechanical threading, deferred until profiling demands it.
  const counters: ReadonlyMap<BlockId, CounterValue> = docHasLists(state)
    ? computeCounters(collectListEvents(state), listDefs)
    : new Map();

  /** Resolve ordered-ness from a listId; safe when def is absent. */
  function isOrdered(listId: string | null): boolean {
    if (listId === null) return false;
    const def = listDefs.get(listId);
    return def !== undefined ? classifyListDef(def) === "ordered" : false;
  }

  /**
   * Given a flat array of `list-item` blocks sharing the SAME `listId`,
   * produce a single synthetic `list` node with proper level-based nesting.
   *
   * Uses an explicit stack of frames. Each frame represents a list currently
   * being built at a particular nesting level:
   *   - `level`: the nesting depth this list lives at
   *   - `items`: the listitem nodes accumulated in this list so far
   *   - `parentItem`: the most-recently-appended listitem at the parent level
   *     (which will receive the nested list as a child when we pop)
   *
   * When item.level > current top level → push a new frame.
   * When item.level ≤ current top level → pop frames until depth matches, then
   * flush each popped frame as a nested list into its parent frame's last item.
   * Then append the new item to the (now-current) frame.
   */
  function buildOneList(sameIdItems: readonly Block[], listId: string | null): AccessibilityNode {
    const ordered = isOrdered(listId);

    interface StackFrame {
      level: number;
      items: AccessibilityNode[];
    }

    const stack: StackFrame[] = [{ level: 0, items: [] }];

    /**
     * Pop frames from the stack until `stack[stack.length - 1].level <= targetLevel`.
     * Each popped frame is converted into a synthetic nested `list` node and
     * appended to the `children` of the last item in the frame below it.
     */
    function popTo(targetLevel: number): void {
      while (stack.length > 1) {
        const top = stack[stack.length - 1];
        // Invariant: the `stack.length > 1` loop guard guarantees a top frame.
        if (top === undefined) {
          throw new Error(
            "build-accessibility-tree: popTo found an empty stack despite length > 1",
          );
        }
        if (top.level <= targetLevel) break;

        // Flush the top frame as a nested list into the parent frame's last item.
        const nestedList: AccessibilityNode = {
          role: "list",
          sourceBlockId: null,
          listOrdered: ordered,
          children: top.items,
        };
        stack.pop();

        // Attach to the last item in the now-current top frame (if any).
        // Invariant: we popped from a stack of length > 1, so >= 1 frame remains.
        const parent = stack[stack.length - 1];
        if (parent === undefined) {
          throw new Error(
            "build-accessibility-tree: popTo lost the parent frame after a pop (stack underflow)",
          );
        }
        if (parent.items.length > 0) {
          const lastItem = parent.items[parent.items.length - 1];
          // Invariant: items.length > 0, so the last item is present.
          if (lastItem === undefined) {
            throw new Error(
              "build-accessibility-tree: popTo found no last item despite items.length > 0",
            );
          }
          // Append to lastItem.children (which is readonly, so rebuild).
          parent.items[parent.items.length - 1] = {
            ...lastItem,
            children: [...lastItem.children, nestedList],
          };
        } else {
          // No prior item at this level to nest under — promote the nested list
          // to a direct child of the current frame instead of losing it.
          parent.items.push(nestedList);
        }
      }
    }

    for (const block of sameIdItems) {
      const itemLevel = listLevelOf(block.attrs);
      // Ordered items carry the resolved ordinal (#555); bullets carry none.
      const ordinal = ordered ? counters.get(block.id)?.value : undefined;
      const bareItem = buildBareListItem(state, block, view, ordinal);

      // Invariant: the stack is seeded with a root frame and popTo never pops
      // below it (loop guard `stack.length > 1`), so the top frame always exists.
      const topFrame = stack[stack.length - 1];
      if (topFrame === undefined) {
        throw new Error(
          "build-accessibility-tree: buildOneList found an empty stack (root frame missing)",
        );
      }
      const currentLevel = topFrame.level;

      if (itemLevel > currentLevel) {
        // Deeper level: push a new frame for this depth.
        stack.push({ level: itemLevel, items: [bareItem] });
      } else if (itemLevel < currentLevel) {
        // Shallower level: pop and flush deeper frames, then append at target level.
        popTo(itemLevel);
        // After popping, ensure the stack top is at exactly itemLevel.
        // (It might be at a level < itemLevel if there was a gap — that's fine; we
        // just append to the nearest ancestor frame.)
        const afterPop = stack[stack.length - 1];
        if (afterPop === undefined) {
          throw new Error(
            "build-accessibility-tree: buildOneList lost the root frame after popTo",
          );
        }
        afterPop.items.push(bareItem);
      } else {
        // Same level: append directly.
        topFrame.items.push(bareItem);
      }
    }

    // Flush any remaining deeper frames back into their parents.
    popTo(0);

    // The root frame (level 0) now holds all top-level items for this list.
    // Invariant: the stack is seeded with a root frame and popTo never removes it.
    const rootFrame = stack[0];
    if (rootFrame === undefined) {
      throw new Error(
        "build-accessibility-tree: buildOneList root frame missing on return",
      );
    }
    return {
      role: "list",
      sourceBlockId: null,
      listOrdered: ordered,
      children: rootFrame.items,
    };
  }

  // Break the full items array into sub-runs by listId, then build one list per run.
  const result: AccessibilityNode[] = [];
  let runStart = 0;

  for (let i = 1; i <= items.length; i++) {
    const atEnd = i === items.length;
    // When !atEnd, i < items.length and i >= 1, so items[i] and items[i-1] both exist.
    let listIdChanged = false;
    if (!atEnd) {
      const cur = items[i];
      const prev = items[i - 1];
      if (cur === undefined || prev === undefined) {
        throw new Error(
          `build-accessibility-tree: groupListItems index ${i} out of range (length ${items.length})`,
        );
      }
      listIdChanged = listIdOf(cur.attrs) !== listIdOf(prev.attrs);
    }

    if (atEnd || listIdChanged) {
      const subRun = items.slice(runStart, i);
      // runStart < i always (advances past each emitted run) and items is non-empty,
      // so the sub-run has at least one element.
      const first = subRun[0];
      if (first === undefined) {
        throw new Error(
          "build-accessibility-tree: groupListItems produced an empty sub-run",
        );
      }
      const runListId = listIdOf(first.attrs);
      result.push(buildOneList(subRun, runListId));
      runStart = i;
    }
  }

  return result;
}

/**
 * Walk `block`'s direct children (via the firstChildId linked list) and build
 * an `AccessibilityNode` for each. Consecutive `list-item` siblings are
 * consumed as a group and emitted as one or more synthetic `list` nodes (by
 * `groupListItems`); all other block types go through `buildBlockNode` directly.
 *
 * `resolve` is the block-resolver for the tree this block lives in. It is
 * threaded through to all recursive calls so that embed/template body subtrees
 * (whose blocks live in their own Y.Map) are resolved correctly — a hard-coded
 * `getBlock` would fail for siblings inside those trees.
 */
function buildChildren(
  state: State,
  block: Block,
  view: SuggestionView,
  resolve: BlockResolver,
): readonly AccessibilityNode[] {
  const out: AccessibilityNode[] = [];
  let childId: BlockId | null = block.firstChildId;

  while (childId !== null) {
    const child = resolve(childId);
    if (child === null) {
      // A non-null childId that resolves to no block = a corrupted tree (dangling
      // pointer). Fail loud rather than silently truncating the sibling list into a
      // structurally-incomplete accessibility tree — consistent with the root-missing
      // throw in buildAccessibilityTree.
      throw new Error(
        `buildAccessibilityTree: child "${childId}" of "${block.id}" not found`,
      );
    }

    if (child.type === "list-item") {
      // Consume the maximal contiguous run of list-item siblings starting here.
      const run: Block[] = [];
      let cursor: Block = child;
      while (true) {
        run.push(cursor);
        const nextId = cursor.nextSiblingId;
        if (nextId === null) break;
        const next = resolve(nextId);
        if (next === null) {
          throw new Error(
            `buildAccessibilityTree: child "${nextId}" of "${block.id}" not found`,
          );
        }
        if (next.type !== "list-item") break;
        cursor = next;
      }
      // Emit synthetic list node(s) for this run.
      for (const listNode of groupListItems(state, run, view)) {
        out.push(listNode);
      }
      // Advance past the last list-item in the run.
      childId = cursor.nextSiblingId;
    } else {
      const nodeOrFlatten = buildBlockNode(state, child, view, resolve);
      if (nodeOrFlatten === "flatten") {
        // section (display:contents / accessibility-transparent): splice its
        // children inline. Note: a section acts as a list-grouping BOUNDARY —
        // any list-item run is consumed BEFORE we process the section, so
        // items inside the section do not merge with outer items (the recursive
        // buildChildren(child) call groups them independently).
        for (const grandchild of buildChildren(state, child, view, resolve)) {
          out.push(grandchild);
        }
      } else {
        out.push(nodeOrFlatten);
      }
      childId = child.nextSiblingId;
    }
  }

  return out;
}

/**
 * Resolve the `alt` attr on an image block. Returns the string value if the
 * attr is present and is a string; otherwise returns `undefined`.
 *
 * `alt` is model-backed via the `SET_IMAGE_ALT` editor action (and HTML
 * import/export). Three meaningful states map through here: a non-empty string
 * is the accessible name (labeled); `""` is explicitly DECORATIVE (returned
 * as `""` so the projected name is empty and AT skips it); absent yields
 * `undefined` (unlabeled — the caller defaults the name to `""`).
 */
function imageAlt(attrs: Block["attrs"]): string | undefined {
  return typeof attrs.alt === "string" ? attrs.alt : undefined;
}

/**
 * Resolve the `level` attribute of a heading block to a valid heading level
 * (1–6). Mirrors `heading.ts`'s `levelFromAttrs`: levels 1–6 are taken as-is;
 * anything outside that range coerces to 1.
 */
function headingLevel(attrs: Block["attrs"]): 1 | 2 | 3 | 4 | 5 | 6 {
  const l = attrs.level;
  return l === 1 || l === 2 || l === 3 || l === 4 || l === 5 || l === 6 ? l : 1;
}

/**
 * Resolve `headerRowCount` from a table block's attrs defensively — mirrors the
 * coercion in `components/table.ts` (`isNonNegativeInteger`): must be a
 * non-negative integer; anything else (negative, float, non-number, NaN,
 * Infinity) coerces to 0.
 */
function headerRowCountOf(attrs: Block["attrs"]): number {
  const raw = attrs.headerRowCount;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Build an `AccessibilityNode` for a single `table-cell` block.
 *
 * Table cells are CONTAINER blocks — they hold block children (paragraphs,
 * nested tables, etc.) via `firstChildId`/`nextSiblingId`, NOT inline content
 * directly. Their `AccessibilityNode` is built via `buildChildren` recursion.
 *
 * The `isHeaderRow` flag drives the `role`: `"columnheader"` for cells in the
 * first `headerRowCount` rows (Google-Docs pinned-header semantics), `"cell"`
 * for all others.
 */
function buildTableCell(
  state: State,
  cellBlock: Block,
  view: SuggestionView,
  isHeaderRow: boolean,
  resolve: BlockResolver,
): AccessibilityNode {
  return {
    role: isHeaderRow ? "columnheader" : "cell",
    sourceBlockId: cellBlock.id,
    children: buildChildren(state, cellBlock, view, resolve),
  };
}

/**
 * Build an `AccessibilityNode` for a single `table-row` block. Walks the row's
 * cell children and delegates to `buildTableCell`, passing down `isHeaderRow`.
 */
function buildTableRow(
  state: State,
  rowBlock: Block,
  view: SuggestionView,
  isHeaderRow: boolean,
  resolve: BlockResolver,
): AccessibilityNode {
  const cells: AccessibilityNode[] = [];
  let cellId: BlockId | null = rowBlock.firstChildId;
  while (cellId !== null) {
    const cell = resolve(cellId);
    if (cell === null) {
      throw new Error(
        `buildAccessibilityTree: cell "${cellId}" of row "${rowBlock.id}" not found`,
      );
    }
    cells.push(buildTableCell(state, cell, view, isHeaderRow, resolve));
    cellId = cell.nextSiblingId;
  }
  return {
    role: "row",
    sourceBlockId: rowBlock.id,
    children: cells,
  };
}

/**
 * Build an `AccessibilityNode` for a `table` block. Reads `headerRowCount` from
 * the table's attrs (defensively coerced to a non-negative integer, default 0)
 * and threads the header-row flag to each row via a 0-based row index:
 * rows `[0, headerRowCount)` are header rows (cells → `"columnheader"`); all
 * others are body rows (cells → `"cell"`).
 */
function buildTable(
  state: State,
  tableBlock: Block,
  view: SuggestionView,
  resolve: BlockResolver,
): AccessibilityNode {
  const headerRowCount = headerRowCountOf(tableBlock.attrs);
  const rows: AccessibilityNode[] = [];
  let rowId: BlockId | null = tableBlock.firstChildId;
  let rowIndex = 0;
  while (rowId !== null) {
    const row = resolve(rowId);
    if (row === null) {
      throw new Error(
        `buildAccessibilityTree: row "${rowId}" of table "${tableBlock.id}" not found`,
      );
    }
    const isHeaderRow = rowIndex < headerRowCount;
    rows.push(buildTableRow(state, row, view, isHeaderRow, resolve));
    rowId = row.nextSiblingId;
    rowIndex += 1;
  }
  return {
    role: "table",
    sourceBlockId: tableBlock.id,
    children: rows,
  };
}

/**
 * Classify a `template-body` block's ARIA landmark role by scanning the main
 * tree for a block that links to it via `headerBlockId` (→ `"banner"`) or
 * `footerBlockId` (→ `"contentinfo"`). Returns `"banner"` as a safe default for
 * an unlinked body (defensive — should not normally occur).
 *
 * Performance note: this is an O(bodies × main-tree) scan — acceptable for v1
 * because the body count is tiny (one header + one footer per section). A future
 * pass can build a single bodyId→role map upfront if needed.
 */
function classifyTemplateBodyRole(
  state: State,
  bodyId: BlockId,
): "banner" | "contentinfo" {
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.attrs.headerBlockId === bodyId) return "banner";
    if (block.attrs.footerBlockId === bodyId) return "contentinfo";
  }
  // Defensive default for an unlinked body.
  return "banner";
}

/**
 * Runtime exhaustiveness guard for `buildBlockNode`'s block-type switch.
 *
 * WHY runtime, not compile-time `never`:
 * `block.type` is an OPEN `string` by design — third-party components register
 * arbitrary type strings at runtime (just like `render`'s component registry and
 * the editor's action pipeline). A compile-time `never` guard (like
 * `assertNeverWritingMode` for writing-mode's CLOSED union) cannot cover an open
 * string; the exhaustiveness invariant is a RUNTIME contract. Every new block type
 * registered with the engine MUST add a matching case here, so an unregistered
 * type fails loudly rather than silently vanishing from the accessibility tree
 * — a missing node is an invisible accessibility regression.
 */
function assertUnmappedBlockType(block: Block): never {
  throw new Error(
    `buildAccessibilityTree: no accessibility role mapped for block type "${block.type}" ` +
    `(block ${block.id}). Every registered block type must map to a role — a missing node ` +
    `is an invisible accessibility regression. Add it to the role switch in buildBlockNode.`,
  );
}

/**
 * Map a single `Block` to its `AccessibilityNode`, or return the sentinel
 * `"flatten"` for a `section` block.
 *
 * `"flatten"` means: emit this block's CHILDREN inline into the parent's
 * output — no node of its own. `section` is `display:contents` / layout-
 * transparent, so it is also accessibility-transparent. Callers that call
 * `buildBlockNode` on non-root blocks MUST handle the `"flatten"` case.
 * Currently the only call sites are `buildChildren` (which handles it via
 * splice) and `buildAccessibilityTree` (which handles it via a narrowing
 * guard — the root is always a document, so the guard fires for corrupt
 * states only).
 *
 * `resolve` is the block-resolver for the tree this block lives in (see
 * `BlockResolver`). It is threaded into `buildChildren` and `buildTable` so
 * that embed/template body subtrees are resolved through the correct Y.Map.
 */
function buildBlockNode(
  state: State,
  block: Block,
  view: SuggestionView,
  resolve: BlockResolver,
): AccessibilityNode | "flatten" {
  switch (block.type) {
    case "document":
      return {
        role: "document",
        sourceBlockId: block.id,
        children: buildChildren(state, block, view, resolve),
      };
    case "section":
      // A section is layout-transparent (display:contents) and therefore
      // accessibility-transparent: it emits NO node of its own. Its children
      // are spliced inline by the caller (buildChildren). The sentinel
      // "flatten" signals this to the caller.
      return "flatten";
    case "image":
      return {
        role: "img",
        sourceBlockId: block.id,
        // Model-backed alt attr (set via SET_IMAGE_ALT / HTML import): a
        // non-empty string is the labeled name; "" is DECORATIVE (AT skips it);
        // absent → undefined, so the ?? "" fallback yields "" for an unlabeled
        // image. See imageAlt() above for the three-state contract.
        name: imageAlt(block.attrs) ?? "",
        children: [],
      };
    case "horizontal-line":
      return {
        role: "separator",
        sourceBlockId: block.id,
        children: [],
      };
    case "table-of-contents":
      // The TOC anchor block: a navigation landmark. Generated entry links are
      // layout-derived; v1 exposes only the landmark with no children.
      return {
        role: "navigation",
        sourceBlockId: block.id,
        name: "Table of contents",
        children: [],
      };
    case "paragraph":
      return {
        role: "paragraph",
        sourceBlockId: block.id,
        text: collectRuns(state, block, view),
        children: [],
      };
    case "heading":
      return {
        role: "heading",
        sourceBlockId: block.id,
        level: headingLevel(block.attrs),
        text: collectRuns(state, block, view),
        children: [],
      };
    case "list-item":
      // A bare list-item node (used when buildBlockNode is called directly on a
      // list-item block — e.g. in isolation tests). The grouping logic in
      // buildChildren wraps these into synthetic list nodes and injects nested
      // lists into `children`; a directly-built item has no children.
      return buildBareListItem(state, block, view);
    case "table":
      // Table rows and cells are built by the dedicated table-subtree builders
      // below; they are never dispatched through `buildBlockNode` directly.
      return buildTable(state, block, view, resolve);
    case "footnote-body":
      // A footnote body: projected as a `doc-footnote` ARIA landmark so that
      // screen readers announce and navigate to footnote content separately from
      // the main document body.
      return {
        role: "doc-footnote",
        sourceBlockId: block.id,
        children: buildChildren(state, block, view, resolve),
      };
    case "template-body":
      // A header/footer template body: classified as `banner` (header) or
      // `contentinfo` (footer) by scanning the main tree for the section block
      // that links to this body via `headerBlockId` / `footerBlockId`.
      return {
        role: classifyTemplateBodyRole(state, block.id),
        sourceBlockId: block.id,
        children: buildChildren(state, block, view, resolve),
      };
    default:
      return assertUnmappedBlockType(block);
  }
}

export function buildAccessibilityTree(
  state: State,
  options?: BuildAccessibilityTreeOptions,
): AccessibilityNode {
  const root = getBlock(state, state.rootId);
  if (root === null) {
    throw new Error(`buildAccessibilityTree: root block "${state.rootId}" not found`);
  }
  const view = options?.suggestionView ?? DEFAULT_VIEW;

  // Two resolvers threaded throughout the recursive builders:
  //  - mainResolve: looks up only the main blocks tree (for the document subtree).
  //  - anyResolve: looks across all three trees (main, embedContents, templateContents)
  //    — required for embed/template body subtrees whose blocks live in their own Y.Map.
  const mainResolve: BlockResolver = (id) => getBlock(state, id);
  const anyResolve: BlockResolver = (id) => resolveBlock(state, id)?.block ?? null;

  const result = buildBlockNode(state, root, view, mainResolve);
  // The document root is always a "document" block — it never returns "flatten".
  // Guard explicitly so this function's return type stays `AccessibilityNode`
  // without resorting to a non-null assertion.
  if (result === "flatten") {
    throw new Error(
      `buildAccessibilityTree: root block "${root.id}" has type "${root.type}" which returned "flatten" — the root must not be a section`,
    );
  }

  // Append embed-content bodies (footnote bodies → doc-footnote) and template-content
  // bodies (header/footer bodies → banner/contentinfo) as trailing children of the root,
  // after the main document children. Reading order: main body first, then footnote bodies
  // (document-content), then template bodies (page-furniture).
  //
  // getEmbedContentIds / getTemplateContentIds yield ROOT ids only (#313); each root
  // heads a self-contained body subtree whose blocks live in its own Y.Map — we walk
  // them via anyResolve. Bodies that fail to resolve (should not occur in a well-formed
  // state, but be defensive) are skipped rather than thrown.
  const bodyNodes: AccessibilityNode[] = [];

  for (const rootId of getEmbedContentIds(state)) {
    const bodyRoot = anyResolve(rootId);
    if (bodyRoot === null) continue;
    const bodyResult = buildBlockNode(state, bodyRoot, view, anyResolve);
    // A body root (footnote-body) is never a section, so "flatten" should not occur.
    // Type-safely skip any unexpected "flatten" rather than asserting.
    if (bodyResult !== "flatten") {
      bodyNodes.push(bodyResult);
    }
  }

  for (const rootId of getTemplateContentIds(state)) {
    const bodyRoot = anyResolve(rootId);
    if (bodyRoot === null) continue;
    const bodyResult = buildBlockNode(state, bodyRoot, view, anyResolve);
    // A body root (template-body) is never a section, so "flatten" should not occur.
    if (bodyResult !== "flatten") {
      bodyNodes.push(bodyResult);
    }
  }

  if (bodyNodes.length === 0) {
    return result;
  }

  // result.children is readonly — rebuild the root node with the appended body nodes.
  return { ...result, children: [...result.children, ...bodyNodes] };
}

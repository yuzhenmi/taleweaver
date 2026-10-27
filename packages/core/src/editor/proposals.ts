import {
  resolveBlock,
  createSpan,
  comparePositions,
  positionsEqual,
  iterateSpan,
  selectionContextOf,
  newSuggestionId,
  markFormatting,
  markDeletion,
  mintInsertion,
  replaceWithSuggestion,
  replaceWithSuggestedFragment,
  assignSuggestionGroup,
  productionAllocator,
  createPositionMapping,
  findItemAtOffset,
  runWithTransactionOrigin,
  currentTransactionOrigin,
  UntrackedOrigin,
} from "../state";
import type {
  BlockId,
  Position,
  ReadonlyAttrs,
  State,
  SuggestionId,
  SiblingBlockInit,
  OperationResult,
} from "../state";
import { suggestionIdsOnItem } from "../state/ops/suggestion-ops";
import type { PositionMapping } from "../state/position-mapping";
import { recordSample } from "../perf/perf-trace";
import { recordChange, type EditorConfig, type EditorState } from "./editor-state";
import { replacementAttrs } from "./typing-attrs";
import { rebaseSelection } from "./foreign-change";

/**
 * Host PROPOSALS: changes offered as ONE reviewable suggestion group, independent of
 * suggesting mode and of the user's caret. See `docs/architecture/1-core/1.5-editor.md`
 * "Host proposals".
 */

/** Host metadata (opaque JSON) carried by a group / a suggestion. */
export type SuggestionMetadata = Readonly<Record<string, unknown>>;

/**
 * One edit of a proposal, in positions of the document the proposal is applied to.
 * - `replace`: `[from, to]` → `text` (a pure insertion when `from` = `to`, a pure
 *   deletion when `text` is ""; `text` may contain "\n" — new paragraphs);
 * - `format`: apply `attrs` (a formatting delta; `undefined` values remove) to `[from, to]`.
 * `metadata` extends the group's metadata on this edit's suggestion records.
 */
export type ProposedEdit =
  | {
      readonly kind: "replace";
      readonly from: Position;
      readonly to: Position;
      readonly text: string;
      readonly metadata?: SuggestionMetadata;
    }
  | {
      readonly kind: "format";
      readonly from: Position;
      readonly to: Position;
      readonly attrs: ReadonlyAttrs;
      readonly metadata?: SuggestionMetadata;
    };

export interface Proposal {
  /** The group's id (`newSuggestionGroupId()`); every edit's suggestion records carry it. */
  readonly groupId: string;
  /** Recorded as the suggestions' author (e.g. "assistant"), styled like any author. */
  readonly author: string;
  readonly metadata?: SuggestionMetadata;
  readonly edits: readonly ProposedEdit[];
}

/** A fresh, unique suggestion-group id. */
export function newSuggestionGroupId(): string {
  return newSuggestionId();
}

/** Why a proposal cannot be applied. */
export type ProposalProblem =
  | { readonly kind: "invalid"; readonly message: string }
  /** Two of the proposal's own edits overlap. */
  | { readonly kind: "overlap" }
  /** An edit overlaps text already carrying pending suggestions (their ids). */
  | { readonly kind: "conflict"; readonly suggestionIds: readonly SuggestionId[] };

/** `[from, to]` ordered, or null when the ends are not in one selection context. */
function ordered(state: State, from: Position, to: Position): [Position, Position] | null {
  const a = selectionContextOf(state, from.blockId);
  if (a === null || a !== selectionContextOf(state, to.blockId)) return null;
  return comparePositions(state, from, to) <= 0 ? [from, to] : [to, from];
}

function validPosition(state: State, p: Position): boolean {
  const content = resolveBlock(state, p.blockId)?.block.inlineContent ?? null;
  if (content === null || p.offset < 0) return false;
  let len = 0;
  for (const item of content.items) len += item.kind === "text" ? item.text.length : 1;
  return p.offset <= len;
}

/** Pending suggestion ids on the content an edit covers (or strictly around its point). */
function suggestionsUnder(state: State, from: Position, to: Position): SuggestionId[] {
  const out = new Set<SuggestionId>();
  if (positionsEqual(from, to)) {
    // An insertion point strictly inside a suggested run would split it.
    const content = resolveBlock(state, from.blockId)?.block.inlineContent ?? null;
    if (content !== null && from.offset > 0) {
      const { itemIndex, withinItem } = findItemAtOffset(content, from.offset);
      const item = content.items[itemIndex];
      if (item !== undefined && withinItem > 0) for (const id of suggestionIdsOnItem(item)) out.add(id);
    }
    return [...out];
  }
  for (const seg of iterateSpan(state, createSpan(from, to))) {
    const content = seg.block.inlineContent;
    if (content === null) continue;
    let pos = 0;
    for (const item of content.items) {
      const end = pos + (item.kind === "text" ? item.text.length : 1);
      if (end > seg.rangeStart && pos < seg.rangeEnd) for (const id of suggestionIdsOnItem(item)) out.add(id);
      if (pos >= seg.rangeEnd) break;
      pos = end;
    }
  }
  return [...out];
}

/**
 * Whether any two edits collide (ranges sharing content, a point strictly inside a range,
 * two edits at one point) — O(n log n): per editing context, sort by start (points first
 * at a tie), then sweep keeping the furthest end seen so far.
 */
function selfOverlap(state: State, ranges: ReadonlyArray<[Position, Position]>): boolean {
  const cmp = (x: Position, y: Position): number => {
    recordSample("proposal.validateCompare", 0); // deterministic perf counter (no-op unless tracing)
    return comparePositions(state, x, y);
  };
  const byContext = new Map<BlockId, Array<[Position, Position]>>();
  for (const r of ranges) {
    const ctx = selectionContextOf(state, r[0].blockId);
    if (ctx === null) continue;
    let list = byContext.get(ctx);
    if (list === undefined) byContext.set(ctx, (list = []));
    list.push(r);
  }
  for (const list of byContext.values()) {
    list.sort((a, b) => {
      const c = cmp(a[0], b[0]);
      if (c !== 0) return c;
      const ap = positionsEqual(a[0], a[1]);
      const bp = positionsEqual(b[0], b[1]);
      return ap === bp ? 0 : ap ? -1 : 1;
    });
    let furthest: Position | null = null; // the furthest end of the ranges swept so far
    let lastPoint: Position | null = null; // the previous point edit, if it was the last one
    for (const [from, to] of list) {
      const point = positionsEqual(from, to);
      if (point && lastPoint !== null && positionsEqual(lastPoint, from)) return true; // two edits at one point
      if (furthest !== null && cmp(from, furthest) < 0) return true; // starts inside an earlier range
      lastPoint = point ? from : null;
      if (furthest === null || cmp(to, furthest) > 0) furthest = to;
    }
  }
  return false;
}

/**
 * Check a proposal against `state` before applying it. Proposals never overlap pending
 * suggestions (a predictable, atomic rule: the whole proposal is refused and the
 * conflicting suggestion ids reported) and never overlap themselves. Null = OK.
 */
export function validateProposal(state: State, proposal: Proposal): ProposalProblem | null {
  if (proposal.edits.length === 0) return { kind: "invalid", message: "a proposal needs at least one edit" };
  const ranges: Array<[Position, Position]> = [];
  for (const edit of proposal.edits) {
    if (!validPosition(state, edit.from) || !validPosition(state, edit.to)) {
      return { kind: "invalid", message: "an edit position is outside the document" };
    }
    const r = ordered(state, edit.from, edit.to);
    if (r === null) return { kind: "invalid", message: "an edit spans two editing contexts" };
    if (edit.kind === "format" && positionsEqual(r[0], r[1])) {
      return { kind: "invalid", message: "a format edit needs a non-empty range" };
    }
    if (edit.kind === "replace" && edit.text === "" && positionsEqual(r[0], r[1])) {
      return { kind: "invalid", message: "an empty replace changes nothing" };
    }
    ranges.push(r);
  }
  if (selfOverlap(state, ranges)) return { kind: "overlap" };
  const ids = new Set<SuggestionId>();
  for (const [from, to] of ranges) for (const id of suggestionsUnder(state, from, to)) ids.add(id);
  return ids.size > 0 ? { kind: "conflict", suggestionIds: [...ids] } : null;
}

/**
 * Map a proposal computed against an OLDER document version through `mapping` (from
 * `basedOn` to the reducer's current state). Null when it is stale: an edit's range was edited since, or
 * cannot be mapped.
 */
export function mapProposal(proposal: Proposal, mapping: PositionMapping): Proposal | null {
  const edits: ProposedEdit[] = [];
  for (const edit of proposal.edits) {
    if (mapping.touches(edit.from, edit.to)) return null;
    const point = positionsEqual(edit.from, edit.to);
    const from = mapping.map(edit.from, 1).position;
    const to = point ? from : mapping.map(edit.to, -1).position;
    if (from === null || to === null) return null;
    edits.push({ ...edit, from, to });
  }
  return { ...proposal, edits };
}

/** The lines of a multi-paragraph replacement, shaped like the paragraph at `at`. */
function linesFor(state: State, at: Position, text: string, attrs: ReadonlyAttrs): SiblingBlockInit[] {
  const block = resolveBlock(state, at.blockId)?.block;
  const type = block?.type ?? "paragraph";
  const blockAttrs = block?.attrs ?? {};
  return text.split("\n").map((line) => ({
    type,
    attrs: blockAttrs,
    inlineContent: { items: line.length > 0 ? [{ kind: "text" as const, text: line, attrs }] : [] },
  }));
}

/**
 * The PROPOSE reducer arm — the AUTHORITATIVE check: map the edits from `basedOn` (the
 * version they were computed against) through the editor's change chain (stale when the
 * ranges changed or the version is unknown), validate, then apply every edit as a
 * suggestion (fresh, non-coalescing records, author = the proposal's), mapping each
 * later edit through the earlier ones, and tag all records with the group + metadata.
 * A proposal is another author's change, so it is NOT in the user's undo stack:
 * it runs under an {@link UntrackedOrigin} owned by the dispatching host's origin
 * (untracked; self to that host's own foreign-change subscription) and the History only advances its
 * cached state — Ctrl+Z keeps undoing the user's own last edit (accept / reject stay
 * undoable user actions). Inline storage never re-mints a character on an in-block
 * edit, and undo selections are CRDT-anchored, so the user's open entry survives.
 * EXCEPTION (structural-op limit): a proposal whose application SPLITS a block (a
 * multi-paragraph replace) re-mints the moved tail and would break the user's open
 * entry, so it stays TRACKED — one undo entry in order with the user's edits.
 * PROPOSE is an `inert` coalesce class, so a tracked entry is opened here, only when
 * something is applied; the selection is rebased and stored typing attrs kept. The
 * verdict is `lastProposal`.
 */
export function handlePropose(
  editor: EditorState,
  input: Proposal,
  basedOn: State | undefined,
  config: EditorConfig,
): EditorState {
  const outcomeOf = (verdict: Verdict): ProposalOutcome => chainOutcome(editor.lastProposal, { ...verdict, proposal: input });
  const verdict = (v: Verdict): EditorState => ({ ...editor, lastProposal: outcomeOf(v) });
  let proposal = input;
  if (basedOn !== undefined && basedOn !== editor.state) {
    const mapping = mappingSince(editor, basedOn);
    const mapped = mapping === null ? null : mapProposal(input, mapping);
    if (mapped === null) return verdict({ groupId: input.groupId, outcome: "stale" });
    proposal = mapped;
  }
  const problem = validateProposal(editor.state, proposal);
  if (problem !== null) return verdict({ groupId: proposal.groupId, outcome: "rejected", problem });
  const tracked = proposal.edits.some((e) => e.kind === "replace" && e.text.includes("\n"));
  if (tracked) {
    editor.history.beginEntry("command", (config.now ?? Date.now)(), editor.selection);
    return applyProposal(editor, proposal, config, outcomeOf, true);
  }
  // Per-instance untracked origin: wraps the dispatching host's own (ambient) origin,
  // so no History tracks it but the host's own foreign-change subscription treats it
  // as self (a second host on the same doc still sees it as foreign).
  const origin = new UntrackedOrigin(currentTransactionOrigin());
  return runWithTransactionOrigin(origin, () => applyProposal(editor, proposal, config, outcomeOf, false));
}

function applyProposal(
  editor: EditorState,
  proposal: Proposal,
  config: EditorConfig,
  outcomeOf: (verdict: Verdict) => ProposalOutcome,
  tracked: boolean,
): EditorState {
  const createdAt = (config.now ?? Date.now)();
  const registry = config.attrRegistry;
  let state = editor.state;
  let change = editor.lastChange;
  const dirty = new Set<BlockId>();
  const minted: SuggestionId[] = [];
  const perId = new Map<SuggestionId, Readonly<Record<string, unknown>>>();
  let pending = proposal.edits.map((e) => ({ ...e }));

  const step = (result: OperationResult, ids: readonly SuggestionId[], meta: Readonly<Record<string, unknown>> | undefined): void => {
    if (result.state === state) return;
    const mapping = createPositionMapping(state, result.state, result.dirtyIds);
    change = recordChange(change, state, result.dirtyIds);
    for (const id of result.dirtyIds) dirty.add(id);
    state = result.state;
    for (const id of ids) {
      minted.push(id);
      if (meta !== undefined) perId.set(id, meta);
    }
    // Later edits were expressed against the pre-edit document: carry them along.
    pending = pending.map((e) => {
      const point = positionsEqual(e.from, e.to);
      const from = mapping.map(e.from, 1).position ?? e.from;
      const to = point ? from : (mapping.map(e.to, -1).position ?? e.to);
      return { ...e, from, to };
    });
  };

  while (pending.length > 0) {
    const [edit, ...rest] = pending;
    pending = rest;
    if (edit === undefined) break;
    const range = ordered(state, edit.from, edit.to);
    if (range === null) continue;
    const [from, to] = range;
    const span = createSpan(from, to);
    if (edit.kind === "format") {
      const id = newSuggestionId();
      step(markFormatting(state, span, edit.attrs, { id, author: proposal.author, createdAt, noCoalesce: true }), [id], edit.metadata);
      continue;
    }
    const attrs = replacementAttrs(state, from, to, registry);
    const point = positionsEqual(from, to);
    if (edit.text === "") {
      const id = newSuggestionId();
      step(markDeletion(state, span, { id, author: proposal.author, createdAt, noCoalesce: true }), [id], edit.metadata);
    } else if (edit.text.includes("\n")) {
      const input = { deletionId: newSuggestionId(), insertionId: newSuggestionId(), author: proposal.author, createdAt, noCoalesce: true };
      const result = replaceWithSuggestedFragment(state, span, linesFor(state, from, edit.text, attrs), input, productionAllocator, registry);
      step(result, [input.deletionId, input.insertionId], edit.metadata);
    } else if (point) {
      const id = newSuggestionId();
      step(mintInsertion(state, from, edit.text, attrs, { id, author: proposal.author, createdAt, noCoalesce: true }), [id], edit.metadata);
    } else {
      const input = { deletionId: newSuggestionId(), insertionId: newSuggestionId(), author: proposal.author, createdAt, noCoalesce: true };
      step(replaceWithSuggestion(state, span, edit.text, attrs, input, registry), [input.deletionId, input.insertionId], edit.metadata);
    }
  }
  if (minted.length === 0) {
    return { ...editor, lastProposal: outcomeOf({ groupId: proposal.groupId, outcome: "rejected", problem: { kind: "invalid", message: "nothing to propose" } }) };
  }
  const grouped = assignSuggestionGroup(state, minted, proposal.groupId, proposal.metadata, perId);
  if (grouped.state !== state) {
    change = recordChange(change, state, grouped.dirtyIds);
    for (const id of grouped.dirtyIds) dirty.add(id);
    state = grouped.state;
  }
  const after: EditorState = {
    ...editor,
    state,
    lastDirtyIds: dirty,
    lastChange: change,
    lastProposal: outcomeOf({ groupId: proposal.groupId, outcome: "applied" }),
  };
  const selection = rebaseSelection(editor, after);
  if (tracked) editor.history.commit({ state, dirtyIds: dirty }, { before: editor.selection, after: selection });
  else editor.history.advanceState(state);
  return { ...after, selection };
}

/** What `controller.propose()` reports (see `EditorState.lastProposal` for print). */
export type ProposeResult =
  | { readonly ok: true }
  /** Computed against a version whose edited ranges have since changed (or aged out). */
  | { readonly ok: false; readonly reason: "stale" }
  /** Refused as it stands (see the problem). */
  | { readonly ok: false; readonly reason: "rejected"; readonly problem: ProposalProblem }
  /** The controller is halted on incompatible (legacy) document storage. */
  | { readonly ok: false; readonly reason: "halted" };

/**
 * The reducer's verdict on the last `PROPOSE` (`EditorState.lastProposal`). `proposal` is
 * the dispatched object; `seq` numbers the PROPOSEs of this editor (1, 2, …) — the
 * per-dispatch identity key, kept by every copy; `prior` links the verdicts of the earlier
 * PROPOSEs (newest first; `depth` = chain length, at least {@link MAX_PROPOSAL_CHAIN}
 * kept), so a host that batches several dispatches before one view update loses none.
 */
export interface ProposalOutcome {
  readonly groupId: string;
  readonly outcome: "applied" | "stale" | "rejected";
  readonly problem?: ProposalProblem;
  readonly proposal: Proposal;
  readonly seq: number;
  readonly depth: number;
  readonly prior?: ProposalOutcome;
}

type Verdict = Pick<ProposalOutcome, "groupId" | "outcome" | "problem">;

/** How many verdicts `ProposalOutcome.prior` is guaranteed to keep (the newest included). */
export const MAX_PROPOSAL_CHAIN = 32;

/**
 * `outcome` linked onto `prior`. Existing verdicts keep their identity; only once the
 * chain grows past 2 × {@link MAX_PROPOSAL_CHAIN} is it rebuilt to the newest MAX
 * (copies keep `seq`) — O(1) amortised, like `recordChange`.
 */
function chainOutcome(prior: ProposalOutcome | undefined, outcome: Omit<ProposalOutcome, "prior" | "seq" | "depth">): ProposalOutcome {
  const seq = (prior?.seq ?? 0) + 1;
  if (prior === undefined) return { ...outcome, seq, depth: 1 };
  if (prior.depth < 2 * MAX_PROPOSAL_CHAIN) return { ...outcome, seq, depth: prior.depth + 1, prior };
  const kept: ProposalOutcome[] = [];
  for (let o: ProposalOutcome | undefined = prior; o !== undefined && kept.length < MAX_PROPOSAL_CHAIN - 1; o = o.prior) kept.push(o);
  let tail: ProposalOutcome | undefined;
  for (let i = kept.length - 1; i >= 0; i--) {
    const o = kept[i];
    if (o === undefined) continue;
    const { prior: _dropped, ...rest } = o;
    tail = tail === undefined ? { ...rest, depth: 1 } : { ...rest, depth: tail.depth + 1, prior: tail };
  }
  return tail === undefined ? { ...outcome, seq, depth: 1 } : { ...outcome, seq, depth: tail.depth + 1, prior: tail };
}

/** A `ProposeResult` from the reducer's recorded outcome. */
export function proposeResultOf(outcome: ProposalOutcome | undefined): ProposeResult {
  if (outcome === undefined) return { ok: false, reason: "rejected", problem: { kind: "invalid", message: "not applied" } };
  if (outcome.outcome === "applied") return { ok: true };
  if (outcome.outcome === "stale") return { ok: false, reason: "stale" };
  return { ok: false, reason: "rejected", problem: outcome.problem ?? { kind: "invalid", message: "rejected" } };
}

/**
 * The mapping from an older document version `basedOn` to `editor.state`, walking the
 * editor's change chain (`lastChange`) — null when `basedOn` is not on it (aged out of the
 * bounded chain, or the document was replaced).
 */
function mappingSince(editor: EditorState, basedOn: State): PositionMapping | null {
  const dirty = new Set<BlockId>();
  for (let c = editor.lastChange; c !== null; c = c.prior) {
    for (const id of c.dirtyIds) dirty.add(id);
    if (c.from === basedOn) return createPositionMapping(basedOn, editor.state, dirty);
  }
  return null;
}

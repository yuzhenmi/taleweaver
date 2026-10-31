import type { BlockId, Document, TextMatch, CommentId, SuggestionId, SuggestionGroup } from "../state";
import { createPosition, buildCommentRangeIndex, buildSuggestionRangeIndex, getSuggestionGroups } from "../state";
import type { DecorationAttrs, InlineDecoration } from "./decorations";

/**
 * The engine's built-in highlights (find matches, comments, suggestions) expressed as
 * ordinary inline decorations, so every backend draws them through the ONE decoration
 * mechanism. Ids are namespaced `tw-*`; classes let a DOM host restyle them.
 */

/** Inactive / active find-match fills (Google Docs yellow / orange). */
export const FIND_HIGHLIGHT_FILL = "rgba(255, 213, 0, 0.40)";
export const ACTIVE_FIND_HIGHLIGHT_FILL = "rgba(255, 138, 0, 0.55)";
/** Inactive / active comment fills (soft / deeper amber). */
export const COMMENT_HIGHLIGHT_FILL = "rgba(255, 199, 110, 0.35)";
export const ACTIVE_COMMENT_HIGHLIGHT_FILL = "rgba(255, 167, 38, 0.55)";
/** Inactive / active suggestion fills (soft / deeper teal). */
export const SUGGESTION_HIGHLIGHT_FILL = "rgba(45, 178, 168, 0.30)";
export const ACTIVE_SUGGESTION_HIGHLIGHT_FILL = "rgba(20, 150, 140, 0.50)";

export interface CommentHighlight {
  readonly commentId: CommentId;
  readonly active: boolean;
}

export interface SuggestionHighlight {
  readonly suggestionId: SuggestionId;
  readonly active: boolean;
}

/** The decoration id of a find match: stable per occurrence (block + offset), so an edit
 *  in one block never renames another block's highlights. */
export function findDecorationId(match: TextMatch): string {
  return `tw-find:${match.blockId}:${match.start}`;
}

/**
 * Find matches → decorations; the match at `activeIndex` (if in range) is emphasized.
 * `onlyBlocks` limits the output to matches in those blocks (incremental redraw).
 */
export function findHighlightDecorations(
  matches: readonly TextMatch[],
  activeIndex: number,
  onlyBlocks?: ReadonlySet<BlockId>,
): InlineDecoration[] {
  const out: InlineDecoration[] = [];
  matches.forEach((m, i) => {
    if (onlyBlocks !== undefined && !onlyBlocks.has(m.blockId)) return;
    const active = i === activeIndex;
    out.push({
      kind: "inline",
      id: findDecorationId(m),
      from: createPosition(m.blockId, m.start),
      to: createPosition(m.blockId, m.end),
      class: active ? "tw-find tw-find-active" : "tw-find",
      style: { backgroundColor: active ? ACTIVE_FIND_HIGHLIGHT_FILL : FIND_HIGHLIGHT_FILL },
      // No list index: it would go stale for blocks a patch does not redraw. The match is
      // identified by the decoration's own `from`/`to` (and its stable id).
      data: { kind: "find" },
    });
  });
  return out;
}

/**
 * Comment ranges (resolved from live state — markers move with the text) → decorations.
 * Orphaned / unresolvable comments emit nothing.
 */
export function commentHighlightDecorations(document: Document, highlights: readonly CommentHighlight[]): InlineDecoration[] {
  const out: InlineDecoration[] = [];
  if (highlights.length === 0) return out;
  const index = buildCommentRangeIndex(document); // one document scan for all comments
  for (const { commentId, active } of highlights) {
    const range = index.get(commentId) ?? null;
    if (range === null || range.orphaned) continue;
    out.push({
      kind: "inline",
      id: `tw-comment:${commentId}`,
      from: range.start,
      to: range.end,
      // `to` is the end marker's leading edge: text typed there lands INSIDE the comment.
      inclusiveEnd: true,
      class: active ? "tw-comment tw-comment-active" : "tw-comment",
      style: { backgroundColor: active ? ACTIVE_COMMENT_HIGHLIGHT_FILL : COMMENT_HIGHLIGHT_FILL },
      data: { kind: "comment", commentId },
    });
  }
  return out;
}

/** Pending suggestion ranges (resolved from live state) → decorations. */
export function suggestionHighlightDecorations(document: Document, highlights: readonly SuggestionHighlight[]): InlineDecoration[] {
  const out: InlineDecoration[] = [];
  if (highlights.length === 0) return out;
  const index = buildSuggestionRangeIndex(document); // one document scan for all suggestions
  for (const { suggestionId, active } of highlights) {
    const range = index.get(suggestionId) ?? null;
    if (range === null) continue;
    out.push({
      kind: "inline",
      id: `tw-suggestion:${suggestionId}`,
      from: range.start,
      to: range.end,
      class: active ? "tw-suggestion tw-suggestion-active" : "tw-suggestion",
      style: { backgroundColor: active ? ACTIVE_SUGGESTION_HIGHLIGHT_FILL : SUGGESTION_HIGHLIGHT_FILL },
      data: { kind: "suggestion", suggestionId },
    });
  }
  return out;
}

/**
 * Host per-group styling of suggestions: one inline decoration over every live range
 * of every open suggestion group for which `styleOf(group)` returns a look (class /
 * style / attributes) — e.g. a colour per `metadata.source`. Ids are
 * `suggestion-group:<groupId>:<n>`; `data` is the group. The built-in suggestion visuals
 * (author colour, insertion underline / deletion strike) stay underneath as defaults.
 */
export function suggestionGroupDecorations(
  document: Document,
  styleOf: (group: SuggestionGroup) => DecorationAttrs | null,
): InlineDecoration[] {
  const out: InlineDecoration[] = [];
  for (const group of getSuggestionGroups(document)) {
    const look = styleOf(group);
    if (look === null) continue;
    group.ranges.forEach((range, n) => {
      out.push({ kind: "inline", id: `suggestion-group:${group.id}:${n}`, from: range.start, to: range.end, ...look, data: group });
    });
  }
  return out;
}

/** The suggestion ids a built-in suggestion decoration's `data` names (a highlight, or a group); `[]` for any other data. */
export function suggestionIdsOf(data: unknown): string[] {
  if (typeof data !== "object" || data === null) return [];
  if ("suggestionId" in data && typeof data.suggestionId === "string") return [data.suggestionId];
  if (!("suggestions" in data) || !Array.isArray(data.suggestions)) return [];
  const out: string[] = [];
  for (const m of data.suggestions) {
    if (typeof m === "object" && m !== null && "id" in m && typeof m.id === "string") out.push(m.id);
  }
  return out;
}

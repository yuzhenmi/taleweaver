import type { CounterStyle } from "../styles/format-counter";

/**
 * The `embedType` discriminant for a page-field — a layout-dependent reference
 * field (page-number / page-count) that displays a value derived from PAGINATED
 * layout. Modeled as a word-processor reference field (Google Docs / Word), NOT
 * CSS `target-counter()`.
 *
 * The constants live here at the STATE ROOT (not under `ops/`) so the Layer-1
 * `extract-text.ts` can import `PAGE_FIELD_EMBED_TYPE` without depending on a
 * Layer-3 op module — mirroring how `state/comments.ts` defines
 * `COMMENT_START_EMBED_TYPE`.
 */
export const PAGE_FIELD_EMBED_TYPE = "page-field";

/**
 * What a page-field displays. `page-number` is SELF-PAGE (the page THIS instance
 * materializes on — varies per page); `page-count` is DOCUMENT-GLOBAL (the final
 * total — same value everywhere).
 */
export type PageFieldKind = "page-number" | "page-count";

/**
 * The render-time placeholder is N reserved sizing glyphs at `inlineSize: auto`,
 * so its natural shrink-to-fit width IS the reserved width: line/slot layout
 * already accounts for the widest plausible value before the real value is bound
 * late (at materialize). Two glyphs reserve a 2-digit decimal value — enough for
 * essentially all real documents; the convergence loop grows it for the rare
 * >99-page-with-header-wrap-feedback case.
 */
export const PAGE_FIELD_RESERVED_GLYPHS = 2;

/**
 * The number formats valid for a page-field — {@link CounterStyle} minus the
 * BULLET glyphs (`disc`/`circle`/`square`). A bullet is never a sensible page
 * number ("page •" / "• of •"), so excluding it at the type level makes that
 * invalid state unrepresentable rather than silently rendering a glyph as a count.
 */
export type PageFieldNumberStyle = Exclude<CounterStyle, "disc" | "circle" | "square">;

/** A page-field's stored `properties` (mirrors the cross-reference `{ targetId, refMode }` shape). */
export interface PageFieldProperties {
  readonly fieldKind: PageFieldKind;
  readonly numberStyle: PageFieldNumberStyle;
}

const PAGE_FIELD_KINDS: ReadonlySet<string> = new Set<PageFieldKind>(["page-number", "page-count"]);

const PAGE_FIELD_NUMBER_STYLES: ReadonlySet<string> = new Set<PageFieldNumberStyle>([
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
]);

/**
 * Runtime type guard for {@link PageFieldNumberStyle}. Validates a value read from
 * an open-schema source (the embed's `unknown`-valued `properties`) before treating
 * it as a page-field number style — rejects bullet glyphs and any non-style value.
 * Mirrors `isCounterStyle`.
 */
export function isPageFieldNumberStyle(value: unknown): value is PageFieldNumberStyle {
  return typeof value === "string" && PAGE_FIELD_NUMBER_STYLES.has(value);
}

/**
 * Runtime type guard for {@link PageFieldKind}. Validates a value read from an
 * open-schema source (the embed's `unknown`-valued `properties`) before treating
 * it as a `PageFieldKind` — no unsafe cast, and future-proof (a new kind that is
 * not yet handled fails the guard rather than silently coercing to page-number).
 * Mirrors `isCounterStyle`.
 */
export function isPageFieldKind(value: unknown): value is PageFieldKind {
  return typeof value === "string" && PAGE_FIELD_KINDS.has(value);
}

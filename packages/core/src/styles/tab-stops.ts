/**
 * Tab-stop vocabulary (P-tabs). A tab is modelled as the existing `"tab"`
 * inline embed; the per-paragraph stop LIST and default interval are paragraph
 * STYLE (`Style.tabStops` / `Style.defaultTabStop`). These types are the shared
 * vocabulary consumed by the cascade, the IFC tab-resolution pass, and paint.
 */

/**
 * How content after a tab aligns to the stop. CSS Text 4 / Word / Google Docs.
 *
 * `content-edge` is a Taleweaver extension (used by generated Table-of-Contents
 * entries): the tab right-aligns the FOLLOWING segment to the line's content
 * edge (the inline-end / right margin), a layout-time quantity. Its `position`
 * field is IGNORED — the destination is always the line's content edge.
 */
export type TabAlignment = "left" | "center" | "right" | "decimal" | "content-edge";

/** Leader glyphs drawn across the tab gap (none = blank tab). */
export type LeaderStyle = "none" | "dot" | "dash" | "line";

export interface TabStop {
  /** Position in px from the inline-start content edge. */
  readonly position: number;
  readonly alignment: TabAlignment;
  readonly leader: LeaderStyle;
}

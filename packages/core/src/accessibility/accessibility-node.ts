import type { BlockId, SuggestionView } from "../state";

/** ARIA-aligned semantic roles produced by the accessibility projection. */
export type AccessibilityRole =
  | "document"
  | "paragraph"
  | "heading"
  | "list"
  | "listitem"
  | "table"
  | "row"
  | "cell"
  | "columnheader"
  | "img"
  | "separator"
  | "navigation"
  | "banner"
  | "contentinfo"
  | "doc-footnote";

/**
 * One run of inline text in a text-bearing leaf. `text` is DISPLAY text
 * (suggestion-view-projected, embed-serialized). `sourceOffsetStart/End` are
 * LITERAL block offsets (the editor's Position offset domain), which may differ
 * from `text.length` — an embed occupies 1 literal offset but maybe 0 display chars.
 */
export interface AccessibilityTextRun {
  readonly text: string;
  readonly sourceOffsetStart: number;
  readonly sourceOffsetEnd: number;
  /** Inline emphasis from the run's text-item format attrs. */
  readonly emphasis?: ReadonlyArray<"bold" | "italic" | "underline" | "strikethrough">;
  readonly link?: string;
  readonly suggestion?: "insertion" | "deletion";
  readonly inComment?: boolean;
  /** footnote-anchor: the footnote BODY block id this run references. */
  readonly noteref?: BlockId;
  /**
   * inline-image: this run stands in for an image that flows IN LINE with text.
   * AT announces it as an image labeled with this alt text. The run's display
   * `text` stays `""` — the alt is conveyed via the image role's accessible name,
   * not as text content.
   */
  readonly imageAlt?: string;
  /**
   * Page-valued field marker (geometry-free). The dom-mirror host fills the run's
   * text from the layout's `globalFieldValues` by `fieldKey`; page-number has no
   * global value so its run stays the `""` placeholder.
   */
  readonly fieldKind?: "page-number" | "page-count" | "cross-ref-page";
  /** The render key (`${blockId}/inline/${i}`) for the dom-host's resolved-value lookup. */
  readonly fieldKey?: string;
}

/**
 * A node in the accessibility tree. Role-discriminated: which optional fields are
 * present depends on `role`. Geometry-free. Typed fields only — NO stringly-bag.
 */
export interface AccessibilityNode {
  readonly role: AccessibilityRole;
  readonly sourceBlockId: BlockId | null;
  readonly name?: string;
  readonly level?: number;
  readonly listOrdered?: boolean;
  /**
   * The resolved numeric ordinal of an ORDERED `listitem` (from the numbering
   * engine — start-at / restart / continue already applied), so the dom-mirror
   * host can emit `<li value=N>` and an AT announces the TRUE number rather than
   * the browser-native 1,2,3… of a bare `<ol>`. Present only on ordered listitems
   * (omitted for bullets, which have no number).
   */
  readonly listOrdinal?: number;
  readonly text?: readonly AccessibilityTextRun[];
  readonly children: readonly AccessibilityNode[];
}

export interface BuildAccessibilityTreeOptions {
  /** Which change-tracking projection to read. Defaults to "suggesting". */
  readonly suggestionView?: SuggestionView;
}

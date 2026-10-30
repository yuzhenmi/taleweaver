import type { PageConfig } from "../state";
import type { HtmlParser } from "../state/serialize/html-node";
import type { ComponentRegistry } from "../components/component-registry";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { EditorExtensions } from "./extensions";

export interface EditorConfig {
  readonly componentRegistry: ComponentRegistry;
  readonly attrRegistry: AttrRegistry;
  readonly containerWidth: number;
  /**
   * Document page-setup data (size, orientation, margins, gap). DOCUMENT data,
   * NOT layout geometry: page setup round-trips with the
   * document (Google Docs File ▸ Page setup; Word per-section; .docx). The
   * geometry-free reducer reads it in `toggle-section-landscape` (the landscape
   * dimension swap consults the document's default page dimensions). The print
   * backend's `LayoutConfig` ALSO carries the SAME instance for pagination; the
   * host supplies it to both. `undefined` = an unpaginated/single-page harness.
   * (`measurer`/`hyphenator` — the genuine print-mechanics fields — left core's
   * `EditorConfig` for the backend `LayoutConfig` in this phase; `pageConfig`
   * stays because it is document data.)
   */
  readonly pageConfig?: PageConfig;
  /**
   * Injected clock for undo-coalescing timing. Defaults to `Date.now`.
   * Tests pass a controllable counter so the pause window is deterministic.
   */
  readonly now?: () => number;
  /**
   * Suggesting mode (change-tracking): when a non-null author string, every
   * mutating edit becomes a tracked SUGGESTION attributed to that author (timestamped
   * via `now`), instead of a direct edit. `null`/undefined = direct editing. The HOST
   * owns "who is suggesting" (this is configuration, not session state).
   */
  readonly suggestingAuthor?: string | null;
  /**
   * Injected DOM-free HTML parser; host passes browserHtmlParser; absent →
   * HTML paste falls back to plain.
   */
  readonly htmlParser?: HtmlParser;
  /** Host extensions: commands, keymap, input rules, triggers. */
  readonly extensions?: EditorExtensions;
}

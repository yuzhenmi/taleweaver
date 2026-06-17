import type {
  TextShaper,
  TextMeasurer,
  Hyphenator,
  PageConfig,
  ComponentRegistry,
  AttrRegistry,
} from "@taleweaver/core";

/**
 * The config the print backend's layout-driver needs to run the
 * render → cascade → layout pipeline it owns (Phase 0b).
 *
 * `measurer` / `hyphenator` are the GEOMETRY-only (print text-shaping) fields
 * that LEAVE core's `EditorConfig` in Phase 0b — core's reducer never sees them.
 * `pageConfig` is DOCUMENT page-setup data: it STAYS on core's `EditorConfig`
 * (read by `toggle-section-landscape`) AND lives here for pagination — the host
 * supplies the SAME instance to both (Resolution B). `componentRegistry` /
 * `attrRegistry` likewise REMAIN on core's `EditorConfig` (the reducer's editing
 * ops still consult them) AND are needed here (the render/cascade passes the
 * driver now owns are parameterized by them); the host supplies the SAME instances
 * to both.
 */
export interface LayoutConfig {
  readonly measurer: TextShaper | TextMeasurer;
  readonly hyphenator?: Hyphenator;
  readonly pageConfig?: PageConfig;
  readonly componentRegistry: ComponentRegistry;
  readonly attrRegistry: AttrRegistry;
}

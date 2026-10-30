import type { TextShaper, TextMeasurer, Hyphenator } from "@taleweaver/core";

/**
 * The print-only capabilities the backend's layout-driver needs to run the
 * render → cascade → layout pipeline it owns: the GEOMETRY (print text-shaping)
 * fields that are not part of core's `EditorConfig` — core's reducer never sees them.
 * Everything document-side (component / attr registries, page setup) the driver reads
 * from the `EditorState` it rebuilds (`editor.config`), the single source the reducer
 * also runs with.
 */
export interface LayoutConfig {
  readonly measurer: TextShaper | TextMeasurer;
  readonly hyphenator?: Hyphenator;
}

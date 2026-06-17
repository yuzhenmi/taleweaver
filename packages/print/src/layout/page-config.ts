// packages/core/src/layout/page-config.ts
//
// Back-compat re-export. The `PageConfig` / `PageMargins` TYPES relocated to
// `state/page-config.ts` (Phase 0b Resolution B): page setup is DOCUMENT data,
// not layout geometry, so it must live geometry-free where both core's
// `EditorConfig` and the print backend's `LayoutConfig` can import it without a
// core→`layout/` edge. Existing `import { PageConfig } from "./page-config"`
// sites keep working via this re-export.

export type { PageConfig, PageMargins } from "@taleweaver/core";

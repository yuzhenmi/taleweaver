// packages/core/src/layout/positioned-tree.ts
//
// The `materializeAll()` bridge (virtualized-layout Phase 3, Task 1).
//
// `EditorState.layoutTree` is now `LayoutBox | VirtualLayoutTree`. A
// `VirtualLayoutTree` (paginated mode) holds a `PagePlan` and positions pages
// lazily; a legacy positioned `LayoutBox` (unpaginated / unsupported-feature
// fallback) is already fully positioned. Every CURRENT consumer that expects a
// fully-positioned `LayoutBox` calls `resolvePositionedTree` at its entry: for a
// virtual tree it materializes the whole positioned `BlockBox` (Phase-2 proved
// `materializeAll() ≡ paginateRoot`), so behavior is identical. Later phases
// migrate individual consumers off the bridge to the plan / `getPage`.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase3.md

import type { LayoutBox } from "./layout-box-v2";
import type { VirtualLayoutTree } from "./virtual-layout-tree";

/**
 * Resolve a layout tree to a fully-positioned `LayoutBox`. A
 * `VirtualLayoutTree` (discriminated by `type === "virtual-root"`) materializes
 * its whole positioned `BlockBox` via `materializeAll()`; a legacy positioned
 * `LayoutBox` is returned as-is. The bridge un-migrated consumers ride until
 * they are moved onto the plan / `getPage` API in a later phase.
 */
export function resolvePositionedTree(lt: LayoutBox | VirtualLayoutTree): LayoutBox {
  return lt.type === "virtual-root" ? lt.materializeAll() : lt;
}

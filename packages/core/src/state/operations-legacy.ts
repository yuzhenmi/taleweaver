/**
 * Legacy tree operations barrel (pre-Phase 4a path-based API).
 *
 * Re-exports the StateNode-era path-based mutation helpers used by the
 * legacy editor path. Will be removed at the P11.4 cutover when the
 * editor is fully on the Y.Doc-backed BlockId model.
 */

export {
  updateProperties,
  insertChild,
  removeChild,
  getNodeByPath,
  updateAtPath,
} from "./node-operations-legacy";

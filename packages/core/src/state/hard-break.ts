/**
 * The `embedType` discriminant for a hard line break — the inline embed a
 * `<br>` decodes to (HTML decode is the only producer; there is no editor
 * action / Layer-3 op that inserts one, so this constant has no `ops/` home).
 * It forces a line break within a block WITHOUT splitting the block, distinct
 * from a paragraph boundary.
 *
 * The constant lives here at the STATE ROOT (not under `ops/`) so the Layer-1
 * `extract-text.ts` can import `HARD_BREAK_EMBED_TYPE` without depending on a
 * Layer-3 op module — mirroring how `state/page-field.ts` defines
 * `PAGE_FIELD_EMBED_TYPE` and `state/comments.ts` defines
 * `COMMENT_START_EMBED_TYPE`.
 */
export const HARD_BREAK_EMBED_TYPE = "hard-break";

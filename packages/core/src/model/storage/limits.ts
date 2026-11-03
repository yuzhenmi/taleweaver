/** No write inserts into a piece holding this many structs (incl. tombstones / formats). */
export const PIECE_SOFT_MAX = 1024;
/** Sub-flow nesting cap: past it, writes enter the full piece. */
export const SUBFLOW_DEPTH_CAP = 4;
/** Table nesting cap: a `⟦` at this depth or deeper is inert, and so are its marks. */
export const TABLE_DEPTH_CAP = 4;

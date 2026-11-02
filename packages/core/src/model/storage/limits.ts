/** No write inserts into a piece holding this many structs (incl. tombstones / formats). */
export const PIECE_SOFT_MAX = 1024;
/** Sub-flow nesting cap: past it, writes enter the full piece. */
export const SUBFLOW_DEPTH_CAP = 4;

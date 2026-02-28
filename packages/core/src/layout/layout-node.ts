export {
  type BlockLayoutBox,
  createBlockLayoutBox,
} from "./block-layout-box";
export {
  type LineLayoutBox,
  createLineLayoutBox,
} from "./line-layout-box";
export {
  type TextLayoutBox,
  createTextLayoutBox,
} from "./text-layout-box";

/** Discriminated union of all layout box types. */
export type LayoutBox = BlockLayoutBox | LineLayoutBox | TextLayoutBox;

import type { BlockLayoutBox } from "./block-layout-box";
import type { LineLayoutBox } from "./line-layout-box";
import type { TextLayoutBox } from "./text-layout-box";

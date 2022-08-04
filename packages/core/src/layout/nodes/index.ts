import { BlockLayoutNode } from './block';
import { DocLayoutNode } from './doc';
import { InlineLayoutNode } from './inline';
import { LineLayoutNode } from './line';
import { PageLayoutNode } from './page';
import { TextLayoutNode } from './text';
import { WordLayoutNode } from './word';

export type LayoutNode =
    | DocLayoutNode
    | PageLayoutNode
    | BlockLayoutNode
    | LineLayoutNode
    | InlineLayoutNode
    | TextLayoutNode
    | WordLayoutNode;

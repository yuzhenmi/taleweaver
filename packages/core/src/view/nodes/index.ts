import { BlockViewNode } from './block';
import { DocViewNode } from './doc';
import { InlineViewNode } from './inline';
import { LineViewNode } from './line';
import { PageViewNode } from './page';
import { TextViewNode } from './text';

export type ViewNode = DocViewNode | PageViewNode | BlockViewNode | LineViewNode | TextViewNode | InlineViewNode;

import { AtomicLayoutNode } from './atomic-node';
import { BlockLayoutNode } from './block-node';
import { DocLayoutNode } from './doc-node';
import { InlineLayoutNode } from './inline-node';
import { LineLayoutNode } from './line-node';
import { ILayoutNode } from './node';
import { PageLayoutNode } from './page-node';

export function identifyLayoutNodeType(node: ILayoutNode) {
    if (node instanceof DocLayoutNode) {
        return 'Doc';
    }
    if (node instanceof PageLayoutNode) {
        return 'Page';
    }
    if (node instanceof BlockLayoutNode) {
        return 'Block';
    }
    if (node instanceof LineLayoutNode) {
        return 'Line';
    }
    if (node instanceof InlineLayoutNode) {
        return 'Inline';
    }
    if (node instanceof AtomicLayoutNode) {
        return 'Atomic';
    }
    throw new Error('Unknown layout node type.');
}

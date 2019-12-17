import { AtomicLayoutNode } from 'tw/layout/atomic-node';
import { BlockLayoutNode } from 'tw/layout/block-node';
import { DocLayoutNode } from 'tw/layout/doc-node';
import { InlineLayoutNode } from 'tw/layout/inline-node';
import { LineLayoutNode } from 'tw/layout/line-node';
import { ILayoutNode } from 'tw/layout/node';
import { PageLayoutNode } from 'tw/layout/page-node';

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

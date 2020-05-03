import { LayoutAtom } from './atom';
import { LayoutBlock } from './block';
import { LayoutDoc } from './doc';
import { LayoutInline } from './inline';
import { LayoutLine } from './line';
import { ILayoutNode } from './node';
import { LayoutPage } from './page';

export function identifyLayoutNodeType(node: ILayoutNode) {
    if (node instanceof LayoutDoc) {
        return 'Doc';
    }
    if (node instanceof LayoutPage) {
        return 'Page';
    }
    if (node instanceof LayoutBlock) {
        return 'Block';
    }
    if (node instanceof LayoutLine) {
        return 'Line';
    }
    if (node instanceof LayoutInline) {
        return 'Inline';
    }
    if (node instanceof LayoutAtom) {
        return 'Atomic';
    }
    throw new Error('Unknown layout node type.');
}

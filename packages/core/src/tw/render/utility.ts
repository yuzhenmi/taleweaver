import { AtomicRenderNode } from './atomic-node';
import { BlockRenderNode } from './block-node';
import { DocRenderNode } from './doc-node';
import { InlineRenderNode } from './inline-node';
import { IRenderNode } from './node';

export function identifyRenderNodeType(node: IRenderNode) {
    if (node instanceof DocRenderNode) {
        return 'doc';
    }
    if (node instanceof BlockRenderNode) {
        return 'block';
    }
    if (node instanceof InlineRenderNode) {
        return 'inline';
    }
    if (node instanceof AtomicRenderNode) {
        return 'atomic';
    }
    throw new Error('Unknown render node type.');
}

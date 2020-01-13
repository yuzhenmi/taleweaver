import { BlockModelNode } from './block-node';
import { DocModelNode } from './doc-node';
import { InlineModelNode } from './inline-node';
import { IModelNode } from './node';

export function identifyModelNodeType(node: IModelNode) {
    if (node instanceof DocModelNode) {
        return 'doc';
    }
    if (node instanceof BlockModelNode) {
        return 'block';
    }
    if (node instanceof InlineModelNode) {
        return 'inline';
    }
    throw new Error('Unknown model node type.');
}

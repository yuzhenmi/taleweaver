import { BlockModelNode } from './branch';
import { InlineModelNode } from './leaf';
import { IModelNode } from './node';
import { DocModelNode } from './root';

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

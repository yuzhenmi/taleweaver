import { DocModelNode } from './doc';
import { BlockModelNode } from './block';
import { InlineModelNode } from './inline';

export type ModelNode = DocModelNode<any> | BlockModelNode<any> | InlineModelNode<any>;

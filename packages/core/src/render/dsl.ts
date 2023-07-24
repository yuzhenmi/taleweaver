import { RenderNode } from './nodes';
import { BlockRenderNode, BlockStyle } from './nodes/block';
import { DocRenderNode, DocStyle } from './nodes/doc';

export function doc(id: string, style: DocStyle, children: RenderNode[]) {
    return new DocRenderNode(id, style, children);
}

export function block(id: string, style: BlockStyle, children: RenderNode[]) {
    return new BlockRenderNode(id, style, children);
}
